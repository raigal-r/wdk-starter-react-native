import { AssetTicker, NetworkType, useWallet } from '@tetherto/wdk-react-native-provider';
import { ArrowDown } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toast } from 'sonner-native';

import Header from '@/components/header';
import { colors } from '@/constants/colors';
import { networkConfigs } from '@/config/networks';
import {
  getSwapTargets,
  getUsdtToken,
  SWAP_NETWORKS,
  SwapNetwork,
  SwapToken,
} from '@/config/swap-tokens';
import { pricingService } from '@/services/pricing-service';
import { swapService, SwapQuote, SwapStatus } from '@/services/swap-service';
import getErrorMessage from '@/utils/get-error-message';
import { formatTokenBaseUnits, parseTokenAmount } from '@/utils/token-base-units';

const QUOTE_DEBOUNCE_MS = 800;

const STATUS_LABELS: Record<SwapStatus, string> = {
  preparing: 'Preparing swap…',
  approving: 'Approving USD₮…',
  swapping: 'Swapping…',
};

export default function SwapScreen() {
  const insets = useSafeAreaInsets();
  const { balances, refreshWalletBalance } = useWallet();

  const [network, setNetwork] = useState<SwapNetwork>(NetworkType.ETHEREUM);
  const [tokenOut, setTokenOut] = useState<SwapToken>(getSwapTargets(NetworkType.ETHEREUM)[0]);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [swapStatus, setSwapStatus] = useState<SwapStatus | null>(null);
  const [swapResult, setSwapResult] = useState<{ hash: string } | null>(null);
  const [tokenOutUsdPrice, setTokenOutUsdPrice] = useState<number | undefined>(undefined);

  const tokenIn = getUsdtToken(network);

  // USD₮ balance on the selected network
  const usdtBalance = useMemo(() => {
    const entry = balances?.list?.find(
      (b) => b.denomination === AssetTicker.USDT && b.networkType === network
    );
    return entry ? parseFloat(entry.value) : 0;
  }, [balances, network]);

  const amountIn = parseTokenAmount(amount, tokenIn.decimals);
  const insufficientBalance = amountIn !== null && parseFloat(amount) > usdtBalance;

  const handleSelectNetwork = useCallback((next: SwapNetwork) => {
    setNetwork(next);
    setTokenOut(getSwapTargets(next)[0]);
    setQuote(null);
    setQuoteError(null);
    setSwapResult(null);
  }, []);

  // USD spot price of the target token (Bitfinex primary, CoinGecko fallback)
  useEffect(() => {
    let cancelled = false;
    pricingService.getSpotPrice(tokenOut.pricingSymbol).then((price) => {
      if (!cancelled) setTokenOutUsdPrice(price);
    });
    return () => {
      cancelled = true;
    };
  }, [tokenOut.pricingSymbol]);

  // Live quote, debounced
  useEffect(() => {
    if (!amountIn || insufficientBalance) {
      setQuote(null);
      setQuoteError(null);
      return;
    }

    let cancelled = false;
    setIsQuoting(true);
    setQuoteError(null);

    const timer = setTimeout(async () => {
      try {
        const result = await swapService.quote(network, tokenIn, tokenOut, amountIn);
        if (!cancelled) setQuote(result);
      } catch (error) {
        console.error('Failed to fetch swap quote:', error);
        if (!cancelled) {
          setQuote(null);
          setQuoteError(getErrorMessage(error, 'Could not fetch a quote. Try again.'));
        }
      } finally {
        if (!cancelled) setIsQuoting(false);
      }
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountIn?.toString(), network, tokenOut.address, insufficientBalance]);

  const handleSwap = useCallback(async () => {
    if (!amountIn) return;

    Keyboard.dismiss();
    setSwapResult(null);

    try {
      const result = await swapService.executeSwap(
        network,
        tokenIn,
        tokenOut,
        amountIn,
        setSwapStatus
      );

      setSwapResult({ hash: result.hash });
      toast.success('Swap submitted', {
        description: `Received ≈ ${formatTokenBaseUnits(result.tokenOutAmount, tokenOut.decimals)} ${tokenOut.symbol}`,
      });
      setAmount('');
      setQuote(null);
      refreshWalletBalance();
    } catch (error) {
      console.error('Swap failed:', error);
      toast.error('Swap failed', {
        description: getErrorMessage(error, 'Please try again.'),
      });
    } finally {
      setSwapStatus(null);
    }
  }, [amountIn, network, tokenIn, tokenOut, refreshWalletBalance]);

  const canSwap = !!amountIn && !!quote && !insufficientBalance && !swapStatus && !isQuoting;

  const rate =
    quote && quote.tokenInAmount > 0n
      ? Number(formatTokenBaseUnits(quote.tokenOutAmount, tokenOut.decimals, 8)) /
        Number(formatTokenBaseUnits(quote.tokenInAmount, tokenIn.decimals, 8))
      : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Header title="Swap" isLoading={isQuoting} />

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Network selection */}
        <Text style={styles.label}>Network</Text>
        <View style={styles.chipRow}>
          {SWAP_NETWORKS.map((n) => {
            const config = networkConfigs[n];
            const selected = n === network;
            return (
              <TouchableOpacity
                key={n}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => handleSelectNetwork(n)}
              >
                <Image source={config.icon} style={styles.chipIcon} />
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {config.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* From */}
        <View style={styles.swapBox}>
          <View style={styles.swapBoxHeader}>
            <Text style={styles.label}>You pay</Text>
            <Text style={styles.balanceText}>
              Balance: {usdtBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })}{' '}
              {tokenIn.symbol}
            </Text>
          </View>
          <View style={styles.swapBoxRow}>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.tokenBadge}>
              <Image source={tokenIn.icon} style={styles.tokenBadgeIcon} />
              <Text style={styles.tokenBadgeText}>{tokenIn.symbol}</Text>
            </View>
          </View>
          {insufficientBalance ? (
            <Text style={styles.errorInline}>Insufficient balance</Text>
          ) : null}
        </View>

        <View style={styles.arrowContainer}>
          <View style={styles.arrowCircle}>
            <ArrowDown size={18} color={colors.primary} />
          </View>
        </View>

        {/* To */}
        <View style={styles.swapBox}>
          <View style={styles.swapBoxHeader}>
            <Text style={styles.label}>You receive (estimated)</Text>
          </View>
          <View style={styles.swapBoxRow}>
            <Text style={[styles.amountInput, !quote && { color: colors.textTertiary }]}>
              {quote ? formatTokenBaseUnits(quote.tokenOutAmount, tokenOut.decimals) : '0'}
            </Text>
            <View style={styles.tokenBadge}>
              <Image source={tokenOut.icon} style={styles.tokenBadgeIcon} />
              <Text style={styles.tokenBadgeText}>{tokenOut.symbol}</Text>
            </View>
          </View>
          {quote && tokenOutUsdPrice ? (
            <Text style={styles.usdEstimate}>
              ≈ $
              {(
                Number(formatTokenBaseUnits(quote.tokenOutAmount, tokenOut.decimals, 8)) *
                tokenOutUsdPrice
              ).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          ) : null}
          {/* Target token choices */}
          <View style={styles.targetRow}>
            {getSwapTargets(network).map((token) => {
              const selected = token.address === tokenOut.address;
              return (
                <TouchableOpacity
                  key={token.address}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => {
                    setTokenOut(token);
                    setQuote(null);
                  }}
                >
                  <Image source={token.icon} style={styles.chipIcon} />
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {token.symbol}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Quote details */}
        {quoteError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{quoteError}</Text>
          </View>
        ) : quote ? (
          <View style={styles.quoteBox}>
            {rate ? (
              <View style={styles.quoteRow}>
                <Text style={styles.quoteLabel}>Rate</Text>
                <Text style={styles.quoteValue}>
                  1 {tokenIn.symbol} ≈{' '}
                  {rate.toLocaleString('en-US', { maximumSignificantDigits: 6 })} {tokenOut.symbol}
                </Text>
              </View>
            ) : null}
            <View style={styles.quoteRow}>
              <Text style={styles.quoteLabel}>Network fee (paid in USD₮)</Text>
              <Text style={styles.quoteValue}>
                {quote.fee !== null
                  ? `${formatTokenBaseUnits(quote.fee, tokenIn.decimals)} ${tokenIn.symbol}`
                  : 'Estimated at execution'}
              </Text>
            </View>
            <View style={styles.quoteRow}>
              <Text style={styles.quoteLabel}>Aggregator</Text>
              <Text style={styles.quoteValue}>Velora</Text>
            </View>
          </View>
        ) : null}

        {/* Result */}
        {swapResult ? (
          <View style={styles.successBox}>
            <Text style={styles.successTitle}>Swap submitted 🎉</Text>
            <Text style={styles.successHash} numberOfLines={1} ellipsizeMode="middle">
              {swapResult.hash}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* CTA */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.swapButton, !canSwap && styles.swapButtonDisabled]}
          onPress={handleSwap}
          disabled={!canSwap}
        >
          {swapStatus ? (
            <>
              <ActivityIndicator size="small" color={colors.black} />
              <Text style={styles.swapButtonText}>{STATUS_LABELS[swapStatus]}</Text>
            </>
          ) : (
            <Text style={styles.swapButtonText}>Swap</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.disclaimer}>
          Swaps are routed through the Velora DEX aggregator. Gas is paid in USD₮.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  label: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.card,
    marginRight: 10,
  },
  chipSelected: {
    backgroundColor: colors.primary,
  },
  chipIcon: {
    width: 18,
    height: 18,
    marginRight: 6,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chipTextSelected: {
    color: colors.black,
  },
  swapBox: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
  },
  swapBoxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  swapBoxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '600',
    color: colors.text,
    padding: 0,
    marginRight: 12,
  },
  tokenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardDark,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tokenBadgeIcon: {
    width: 20,
    height: 20,
    marginRight: 6,
  },
  tokenBadgeText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  targetRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  usdEstimate: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  arrowContainer: {
    alignItems: 'center',
    marginVertical: 8,
  },
  arrowCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 3,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorInline: {
    color: colors.error,
    fontSize: 13,
    marginTop: 8,
  },
  quoteBox: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  quoteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  quoteLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  quoteValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  errorBox: {
    backgroundColor: colors.dangerBackground,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
  },
  successBox: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
  },
  successTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  successHash: {
    fontSize: 13,
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
  footer: {
    paddingHorizontal: 20,
  },
  swapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 28,
    paddingVertical: 16,
    gap: 8,
  },
  swapButtonDisabled: {
    opacity: 0.5,
  },
  swapButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.black,
  },
  disclaimer: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: 12,
  },
});
