import { NetworkType, useWallet } from '@tetherto/wdk-react-native-provider';
import * as WebBrowser from 'expo-web-browser';
import { CreditCard } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toast } from 'sonner-native';

import Header from '@/components/header';
import { colors } from '@/constants/colors';
import { fiatService, BuyQuote } from '@/services/fiat-service';
import getErrorMessage from '@/utils/get-error-message';

const PRESET_AMOUNTS = [50, 100, 200];
const QUOTE_DEBOUNCE_MS = 600;

const usdtIcon = require('../../../assets/images/tokens/tether-usdt-logo.png');

function formatUsdt(baseUnits: bigint): string {
  return (Number(baseUnits) / 1e6).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCents(cents: bigint): string {
  return (Number(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function BuyScreen() {
  const insets = useSafeAreaInsets();
  const { addresses, refreshWalletBalance } = useWallet();

  const [amount, setAmount] = useState('100');
  const [quote, setQuote] = useState<BuyQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isOpeningWidget, setIsOpeningWidget] = useState(false);

  // MoonPay delivers USD₮ as an ERC-20; the wallet's Ethereum address
  // receives it.
  const recipient = addresses?.[NetworkType.ETHEREUM];

  const amountCents = (() => {
    const parsed = parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return BigInt(Math.round(parsed * 100));
  })();

  // Fetch a live quote whenever the amount settles
  useEffect(() => {
    if (!amountCents) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    if (!fiatService.isConfigured()) {
      setQuoteError('MoonPay is not configured. Add EXPO_PUBLIC_MOONPAY_API_KEY to .env.');
      return;
    }

    let cancelled = false;
    setIsQuoting(true);
    setQuoteError(null);

    const timer = setTimeout(async () => {
      try {
        const result = await fiatService.quoteBuyUsdt(amountCents);
        if (!cancelled) setQuote(result);
      } catch (error) {
        console.error('Failed to fetch MoonPay quote:', error);
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
  }, [amountCents?.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBuy = useCallback(async () => {
    if (!amountCents || !recipient) return;

    setIsOpeningWidget(true);
    try {
      const buyUrl = await fiatService.getBuyUrl(amountCents, recipient);

      // MoonPay's widget handles card entry, KYC, and 3DS in the in-app
      // browser. When the user comes back, the purchase settles on-chain.
      await WebBrowser.openBrowserAsync(buyUrl);

      toast.info('Purchase processing', {
        description: 'Your USD₮ balance will update once MoonPay completes the transfer.',
      });
      refreshWalletBalance();
    } catch (error) {
      console.error('Failed to open MoonPay widget:', error);
      toast.error('Could not start purchase', {
        description: getErrorMessage(error, 'Please try again.'),
      });
    } finally {
      setIsOpeningWidget(false);
    }
  }, [amountCents, recipient, refreshWalletBalance]);

  const canBuy = !!amountCents && !!recipient && !isOpeningWidget && !quoteError;

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Header title="Buy USD₮" isLoading={isQuoting} />

        <View style={styles.content}>
          {/* Token being purchased */}
          <View style={styles.tokenRow}>
            <Image source={usdtIcon} style={styles.tokenIcon} />
            <View>
              <Text style={styles.tokenName}>Tether USD</Text>
              <Text style={styles.tokenSubtitle}>Delivered on Ethereum</Text>
            </View>
          </View>

          {/* Amount input */}
          <Text style={styles.label}>You pay (USD)</Text>
          <View style={styles.amountRow}>
            <Text style={styles.currencySymbol}>$</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textTertiary}
            />
          </View>

          {/* Preset amounts */}
          <View style={styles.presetRow}>
            {PRESET_AMOUNTS.map((preset) => (
              <TouchableOpacity
                key={preset}
                style={[styles.presetButton, amount === String(preset) && styles.presetSelected]}
                onPress={() => setAmount(String(preset))}
              >
                <Text
                  style={[
                    styles.presetText,
                    amount === String(preset) && styles.presetTextSelected,
                  ]}
                >
                  ${preset}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Quote */}
          {quoteError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{quoteError}</Text>
            </View>
          ) : quote ? (
            <View style={styles.quoteBox}>
              <View style={styles.quoteRow}>
                <Text style={styles.quoteLabel}>You receive</Text>
                <Text style={styles.quoteValue}>≈ {formatUsdt(quote.cryptoAmount)} USD₮</Text>
              </View>
              <View style={styles.quoteRow}>
                <Text style={styles.quoteLabel}>MoonPay fees</Text>
                <Text style={styles.quoteValue}>${formatCents(quote.fee)}</Text>
              </View>
              <View style={styles.quoteRow}>
                <Text style={styles.quoteLabel}>Payment method</Text>
                <Text style={styles.quoteValue}>Card</Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* CTA */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity
            style={[styles.buyButton, !canBuy && styles.buyButtonDisabled]}
            onPress={handleBuy}
            disabled={!canBuy}
          >
            {isOpeningWidget ? (
              <ActivityIndicator size="small" color={colors.black} />
            ) : (
              <>
                <CreditCard size={20} color={colors.black} />
                <Text style={styles.buyButtonText}>Buy with MoonPay</Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.disclaimer}>
            Card payments, KYC, and delivery are handled securely by MoonPay.
          </Text>
        </View>
      </View>
    </TouchableWithoutFeedback>
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
    paddingTop: 24,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 32,
  },
  tokenIcon: {
    width: 40,
    height: 40,
    marginRight: 12,
  },
  tokenName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  tokenSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  label: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 8,
    marginBottom: 16,
  },
  currencySymbol: {
    fontSize: 36,
    fontWeight: '600',
    color: colors.text,
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    fontSize: 36,
    fontWeight: '600',
    color: colors.text,
    padding: 0,
  },
  presetRow: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  presetButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.card,
    marginRight: 12,
  },
  presetSelected: {
    backgroundColor: colors.primary,
  },
  presetText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  presetTextSelected: {
    color: colors.black,
  },
  quoteBox: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
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
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
  },
  footer: {
    paddingHorizontal: 20,
  },
  buyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 28,
    paddingVertical: 16,
    gap: 8,
  },
  buyButtonDisabled: {
    opacity: 0.5,
  },
  buyButtonText: {
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
