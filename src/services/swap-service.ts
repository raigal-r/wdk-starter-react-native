import VeloraProtocolEvm from '@tetherto/wdk-protocol-swap-velora-evm';
import { WalletAccountEvmErc4337 } from '@tetherto/wdk-wallet-evm-erc-4337';
import { WDKService } from '@tetherto/wdk-react-native-provider';
import { constructSimpleSDK } from '@velora-dex/sdk';
import { getUniqueId } from 'react-native-device-info';

import getChainsConfig from '@/config/get-chains-config';
import { SwapNetwork, SwapToken } from '@/config/swap-tokens';
import { pricingService } from '@/services/pricing-service';
import { recordSwap } from '@/utils/swap-history';
import { formatTokenBaseUnits } from '@/utils/token-base-units';

/**
 * In-app swap service backed by the WDK Velora (DEX aggregator) module.
 *
 * The starter's EVM addresses are ERC-4337 smart accounts living inside the
 * WDK worklet. The published RN provider does not yet expose swap operations,
 * so for this PoC we rebuild the same smart account on the JS thread from the
 * wallet seed (same derivation path + chain config → same address) and hand
 * it to the Velora protocol. Gas is paid in USD₮ via the chain's paymaster,
 * so users fresh off the fiat on-ramp never need the native coin.
 *
 * NOTE: this briefly materializes the seed outside the worklet. Acceptable
 * for a PoC; the long-term home for this logic is the worklet itself (pear-
 * wrk-wdk already routes `protocolType: 'swap'` calls in newer betas).
 */

export interface SwapQuote {
  /**
   * Gas fee, denominated in the paymaster token (USD₮ base units).
   * `null` when the fee could not be simulated yet — ERC-4337 gas estimation
   * executes the real swap calldata, which reverts until the account holds
   * tokenIn and has approved the Velora router. The fee is enforced at
   * execution time regardless.
   */
  fee: bigint | null;
  /** Exact input amount, in tokenIn base units */
  tokenInAmount: bigint;
  /** Expected output amount, in tokenOut base units */
  tokenOutAmount: bigint;
}

export interface SwapExecutionResult {
  hash: string;
  fee: bigint;
  tokenInAmount: bigint;
  tokenOutAmount: bigint;
}

export type SwapStatus = 'preparing' | 'approving' | 'swapping';

/**
 * Unwrap AbstractionKit/bundler errors into something actionable. ERC-4337
 * gas is paid in USD₮ via the paymaster, so the most common failure is the
 * account not holding enough USD₮ to cover amount + network fee.
 */
function toFriendlySwapError(error: unknown): Error {
  const err = error as { message?: string; code?: string; context?: unknown; aaCode?: string };
  const contextStr =
    typeof err?.context === 'string'
      ? err.context
      : err?.context
        ? JSON.stringify(err.context)
        : '';
  const details = [err?.code, err?.aaCode, contextStr].filter(Boolean).join(' | ');

  if (err?.aaCode === 'AA25' || /nonce|already known|replacement/i.test(details)) {
    return new Error(
      'A previous operation from this account is still pending. Wait a few seconds and try again.'
    );
  }

  if (
    err?.aaCode === 'AA21' ||
    /insufficient|prefund|balance|transfer amount exceeds/i.test(String(details) + err?.message)
  ) {
    return new Error(
      'Not enough USD₮ on this network to cover the swap plus its network fee (gas is paid in USD₮). Top up the account or try a cheaper network like Polygon or Arbitrum.'
    );
  }

  return new Error(details ? `${err?.message} (${details})` : String(err?.message ?? error));
}

class SwapService {
  private static instance: SwapService;
  private accounts: Partial<Record<SwapNetwork, WalletAccountEvmErc4337>> = {};
  private protocols: Partial<Record<SwapNetwork, VeloraProtocolEvm>> = {};

  private constructor() {}

  static getInstance(): SwapService {
    if (!SwapService.instance) {
      SwapService.instance = new SwapService();
    }
    return SwapService.instance;
  }

  /** Drop cached accounts (e.g. when the wallet is cleared or locked). */
  reset(): void {
    this.accounts = {};
    this.protocols = {};
  }

  private async getAccount(network: SwapNetwork): Promise<WalletAccountEvmErc4337> {
    const cached = this.accounts[network];
    if (cached) return cached;

    const prf = await getUniqueId();
    const seed = await WDKService.retrieveSeed(prf);
    if (!seed) {
      throw new Error('Could not unlock the wallet seed. Is the wallet set up?');
    }

    const chainConfig = getChainsConfig()[network] as any;
    // Same derivation path the worklet uses for account index 0, and the
    // same ERC-4337 config → the smart-account address matches the wallet's.
    // safeModulesVersion is required by @tetherto/wdk-wallet-evm-erc-4337 and
    // '0.3.0' is the only supported value (same Safe 4337 module the worklet
    // deploys with); the starter's config only sets it for Polygon.
    const account = new WalletAccountEvmErc4337(seed, "0'/0/0", {
      ...chainConfig,
      safeModulesVersion: chainConfig.safeModulesVersion ?? '0.3.0',
    });

    this.accounts[network] = account;
    return account;
  }

  private async getProtocol(network: SwapNetwork): Promise<VeloraProtocolEvm> {
    const cached = this.protocols[network];
    if (cached) return cached;

    const account = await this.getAccount(network);
    const chainConfig = getChainsConfig()[network];
    const protocol = new VeloraProtocolEvm(account, {
      swapMaxFee: BigInt(chainConfig.swapMaxFee),
    });

    this.protocols[network] = protocol;
    return protocol;
  }

  /** The smart-account address used for swaps on the given network. */
  async getSwapAddress(network: SwapNetwork): Promise<string> {
    const account = await this.getAccount(network);
    return await account.getAddress();
  }

  /**
   * Quote a swap of an exact input amount.
   * @param amountIn - Exact input, in tokenIn base units.
   */
  async quote(
    network: SwapNetwork,
    tokenIn: SwapToken,
    tokenOut: SwapToken,
    amountIn: bigint
  ): Promise<SwapQuote> {
    const protocol = await this.getProtocol(network);

    try {
      const quote = await protocol.quoteSwap({
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        tokenInAmount: amountIn,
      });

      return {
        fee: quote.fee,
        tokenInAmount: quote.tokenInAmount,
        tokenOutAmount: quote.tokenOutAmount,
      };
    } catch (error) {
      // Fee simulation reverts while the account is unfunded/unapproved;
      // fall back to a rate-only quote straight from the Velora API.
      console.log('Fee simulation unavailable, falling back to rate-only quote:', String(error));

      const chainConfig = getChainsConfig()[network];
      const veloraSdk = constructSimpleSDK({
        chainId: chainConfig.chainId,
        fetch: fetch as any,
      });

      try {
        const rate = await veloraSdk.swap.getRate({
          srcToken: tokenIn.address,
          destToken: tokenOut.address,
          amount: amountIn.toString(),
          side: 'SELL' as any,
          srcDecimals: tokenIn.decimals,
          destDecimals: tokenOut.decimals,
        });

        return {
          fee: null,
          tokenInAmount: amountIn,
          tokenOutAmount: BigInt(rate.destAmount),
        };
      } catch (rateError) {
        // Velora returns "Internal Error while computing the price" when it
        // can't route the amount — typically dust (e.g. 0.1 USD₮ → XAU₮).
        if (/computing the price|no route/i.test(String((rateError as Error)?.message))) {
          throw new Error(
            `Velora could not price this amount. Try a larger amount (e.g. 1+ ${tokenIn.symbol}).`
          );
        }
        throw rateError;
      }
    }
  }

  /**
   * Execute a swap of an exact input amount, approving the Velora router
   * first when the current allowance is insufficient (the beta Velora module
   * does not bundle approvals). Ethereum-mainnet USD₮ requires resetting the
   * allowance to 0 before setting a new value.
   */
  async executeSwap(
    network: SwapNetwork,
    tokenIn: SwapToken,
    tokenOut: SwapToken,
    amountIn: bigint,
    onStatus?: (status: SwapStatus) => void
  ): Promise<SwapExecutionResult> {
    onStatus?.('preparing');

    const account = await this.getAccount(network);
    const protocol = await this.getProtocol(network);
    const chainConfig = getChainsConfig()[network];

    // The Velora router pulls tokenIn via the TokenTransferProxy ("spender").
    const veloraSdk = constructSimpleSDK({
      chainId: chainConfig.chainId,
      fetch: fetch as any,
    });
    const spender = await veloraSdk.swap.getSpender();

    const allowance = await account.getAllowance(tokenIn.address, spender);

    // approve() returns once the user operation is submitted, not mined —
    // poll until the on-chain allowance reflects it before the next step.
    const waitForAllowance = async (
      predicate: (current: bigint) => boolean,
      label: string
    ): Promise<void> => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const current = await account.getAllowance(tokenIn.address, spender);
        if (predicate(current)) return;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      throw new Error(`Timed out waiting for the ${label} approval to confirm. Try again shortly.`);
    };

    if (allowance < amountIn) {
      onStatus?.('approving');

      try {
        if (allowance > 0n) {
          // USD₮ mainnet pattern: reset to 0 before setting a new allowance.
          await account.approve({ token: tokenIn.address, spender, amount: 0n });
          await waitForAllowance((current) => current === 0n, 'allowance reset');
        }

        // Unlimited allowance: each ERC-4337 approve costs gas (paid in
        // USD₮), so approving per-swap burns budget and re-triggers the
        // USD₮ reset dance. One-time max approval is the usual pattern.
        const MAX_UINT256 = 2n ** 256n - 1n;
        await account.approve({ token: tokenIn.address, spender, amount: MAX_UINT256 });
        await waitForAllowance((current) => current >= amountIn, 'router');
      } catch (error) {
        throw toFriendlySwapError(error);
      }
    }

    onStatus?.('swapping');

    try {
      const result = await protocol.swap({
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        tokenInAmount: amountIn,
      });

      // The indexer doesn't surface ERC-4337 swaps, so persist a local
      // record for the activity feed.
      const inAmount = formatTokenBaseUnits(result.tokenInAmount, tokenIn.decimals);
      const outAmount = formatTokenBaseUnits(result.tokenOutAmount, tokenOut.decimals);
      const [inPrice, outPrice] = await Promise.all([
        pricingService.getSpotPrice(tokenIn.pricingSymbol),
        pricingService.getSpotPrice(tokenOut.pricingSymbol),
      ]);
      await recordSwap({
        hash: result.hash,
        network,
        tokenInSymbol: tokenIn.symbol,
        tokenOutSymbol: tokenOut.symbol,
        tokenInAmount: inAmount,
        tokenOutAmount: outAmount,
        tokenInFiat: inPrice ? Number(inAmount) * inPrice : undefined,
        tokenOutFiat: outPrice ? Number(outAmount) * outPrice : undefined,
        timestamp: Date.now(),
      });

      return {
        hash: result.hash,
        fee: result.fee,
        tokenInAmount: result.tokenInAmount,
        tokenOutAmount: result.tokenOutAmount,
      };
    } catch (error) {
      throw toFriendlySwapError(error);
    }
  }
}

export const swapService = SwapService.getInstance();
