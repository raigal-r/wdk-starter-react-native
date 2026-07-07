import MoonPayProtocol from '@tetherto/wdk-protocol-fiat-moonpay';

/**
 * Fiat on-ramp service backed by the WDK MoonPay module.
 *
 * The module generates MoonPay widget URLs and quotes. The widget itself
 * handles card entry, KYC, and payment — we open it in an in-app browser.
 *
 * Amounts use MoonPay base units: fiat in minor units (e.g. cents),
 * crypto in on-chain base units (e.g. 6 decimals for USD₮).
 */

export interface BuyQuote {
  /** USD₮ received, in base units (6 decimals) */
  cryptoAmount: bigint;
  /** Fiat paid, in minor units (cents) */
  fiatAmount: bigint;
  /** Total fees, in fiat minor units */
  fee: bigint;
  /** Exchange rate as reported by MoonPay */
  rate: string;
}

class FiatService {
  private static instance: FiatService;
  private protocol: MoonPayProtocol | null = null;

  private constructor() {}

  static getInstance(): FiatService {
    if (!FiatService.instance) {
      FiatService.instance = new FiatService();
    }
    return FiatService.instance;
  }

  isConfigured(): boolean {
    const key = process.env.EXPO_PUBLIC_MOONPAY_API_KEY;
    return !!key && !key.includes('PUT_HERE');
  }

  private getProtocol(): MoonPayProtocol {
    if (this.protocol) return this.protocol;

    const apiKey = process.env.EXPO_PUBLIC_MOONPAY_API_KEY;
    if (!apiKey) {
      throw new Error(
        'MoonPay is not configured. Set EXPO_PUBLIC_MOONPAY_API_KEY in your .env file.'
      );
    }

    const environment =
      process.env.EXPO_PUBLIC_MOONPAY_ENVIRONMENT === 'production' ? 'production' : 'sandbox';

    // Optional backend endpoint that signs widget URLs with the MoonPay
    // secret key. MoonPay requires signed URLs in production whenever a
    // wallet address is pre-filled; sandbox accepts unsigned URLs.
    const signEndpoint = process.env.EXPO_PUBLIC_MOONPAY_SIGN_URL;

    // No wallet account is passed: the recipient address is provided
    // explicitly per call, so keys never touch this service.
    this.protocol = new MoonPayProtocol(undefined, {
      apiKey,
      environment,
      ...(signEndpoint
        ? {
            signUrl: async (urlForSignature: string) => {
              const response = await fetch(signEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urlForSignature }),
              });
              if (!response.ok) {
                throw new Error(`Failed to sign MoonPay URL: ${response.status}`);
              }
              const { signedUrl } = await response.json();
              return signedUrl;
            },
          }
        : {}),
    });

    return this.protocol;
  }

  /**
   * Quote buying USD₮ with a card.
   * @param fiatAmountCents - Amount of USD to spend, in cents (e.g. 10000 = $100).
   */
  async quoteBuyUsdt(fiatAmountCents: bigint): Promise<BuyQuote> {
    const quote = await this.getProtocol().quoteBuy({
      cryptoAsset: 'usdt',
      fiatCurrency: 'usd',
      fiatAmount: fiatAmountCents,
      config: { paymentMethod: 'credit_debit_card' },
    });

    return {
      cryptoAmount: quote.cryptoAmount,
      fiatAmount: quote.fiatAmount,
      fee: quote.fee,
      rate: quote.rate,
    };
  }

  /**
   * Build the MoonPay buy-widget URL for purchasing USD₮ with a card.
   * @param fiatAmountCents - Amount of USD to spend, in cents.
   * @param recipient - Wallet address that receives the USD₮ (ERC-20).
   */
  async getBuyUrl(fiatAmountCents: bigint, recipient: string): Promise<string> {
    const { buyUrl } = await this.getProtocol().buy({
      cryptoAsset: 'usdt',
      fiatCurrency: 'usd',
      fiatAmount: fiatAmountCents,
      recipient,
      config: {
        theme: 'dark',
        paymentMethod: 'credit_debit_card',
      },
    });

    return buyUrl;
  }

  /**
   * Check the status of a MoonPay buy transaction.
   * @returns 'completed' | 'failed' | 'in_progress'
   */
  async getBuyStatus(moonpayTransactionId: string): Promise<string> {
    const detail = await this.getProtocol().getTransactionDetail(moonpayTransactionId, 'buy');
    return detail.status;
  }
}

export const fiatService = FiatService.getInstance();
