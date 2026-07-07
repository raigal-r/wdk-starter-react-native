import { AssetTicker, useWallet } from '@tetherto/wdk-react-native-provider';
import { Transaction, TransactionList } from '@tetherto/wdk-uikit-react-native';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { assetConfig } from '../config/assets';
import { FiatCurrency, pricingService } from '../services/pricing-service';
import formatTokenAmount from '@/utils/format-token-amount';
import formatUSDValue from '@/utils/format-usd-value';
import { getSwapHistory } from '@/utils/swap-history';
import Header from '@/components/header';
import { colors } from '@/constants/colors';

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const { transactions: walletTransactions, addresses } = useWallet();
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // Transform wallet transactions to display format with fiat values
  const getTransactionsWithFiatValues = async () => {
    // Get the wallet's own addresses for comparison
    const walletAddresses = addresses
      ? Object.values(addresses).map((addr) => addr.toLowerCase())
      : [];

    // Indexer transactions with their timestamps, for merge-sorting below
    const indexerRows = await Promise.all(
      (walletTransactions.list ?? []).map(async (tx, index) => {
        const fromAddress = tx.from?.toLowerCase();
        const isSent = walletAddresses.includes(fromAddress);
        const amount = parseFloat(tx.amount);
        const config = assetConfig[tx.token as keyof typeof assetConfig];

        // Calculate fiat amount using pricing service
        const fiatAmount = await pricingService.getFiatValue(
          amount,
          tx.token as AssetTicker,
          FiatCurrency.USD
        );

        return {
          // Normalize to milliseconds (indexer timestamps are in seconds)
          timestamp: tx.timestamp < 1e12 ? tx.timestamp * 1000 : tx.timestamp,
          row: {
            id: `${tx.transactionHash}-${index}`,
            type: isSent ? ('sent' as const) : ('received' as const),
            token: config?.name || tx.token.toUpperCase(),
            amount: `${formatTokenAmount(amount, tx.token as AssetTicker)}`,
            fiatAmount: formatUSDValue(fiatAmount, false),
            fiatCurrency: FiatCurrency.USD,
            network: tx.blockchain,
          },
        };
      })
    );

    // In-app swaps aren't indexed (ERC-4337 internal transfers), so merge
    // the locally recorded ones in as a sent + received pair.
    const swapRows = (await getSwapHistory()).flatMap((swap) => [
      {
        timestamp: swap.timestamp,
        row: {
          id: `${swap.hash}-out`,
          type: 'sent' as const,
          token: `${swap.tokenInSymbol} (swap)`,
          amount: swap.tokenInAmount,
          fiatAmount: swap.tokenInFiat !== undefined ? formatUSDValue(swap.tokenInFiat, false) : '',
          fiatCurrency: FiatCurrency.USD,
          network: swap.network,
        },
      },
      {
        timestamp: swap.timestamp,
        row: {
          id: `${swap.hash}-in`,
          type: 'received' as const,
          token: `${swap.tokenOutSymbol} (swap)`,
          amount: swap.tokenOutAmount,
          fiatAmount:
            swap.tokenOutFiat !== undefined ? formatUSDValue(swap.tokenOutFiat, false) : '',
          fiatCurrency: FiatCurrency.USD,
          network: swap.network,
        },
      },
    ]);

    return [...indexerRows, ...swapRows]
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((entry) => entry.row);
  };

  useEffect(() => {
    getTransactionsWithFiatValues().then(setTransactions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletTransactions.list, addresses]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Header isLoading={walletTransactions.isLoading} title="Activity" />
      <TransactionList transactions={transactions} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
