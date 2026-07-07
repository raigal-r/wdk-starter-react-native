import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local record of in-app swaps. The WDK Indexer only tracks plain token
 * transfers, so swaps executed as ERC-4337 user operations don't show up in
 * the activity feed — we persist them locally and merge them in.
 */
export interface SwapHistoryEntry {
  hash: string;
  network: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  /** Human-readable decimal amounts (already divided by token decimals) */
  tokenInAmount: string;
  tokenOutAmount: string;
  /** USD estimates captured at execution time (best effort) */
  tokenInFiat?: number;
  tokenOutFiat?: number;
  timestamp: number;
}

const STORAGE_KEY = 'wdk-swap-history';
const MAX_ENTRIES = 100;

export async function recordSwap(entry: SwapHistoryEntry): Promise<void> {
  try {
    const history = await getSwapHistory();
    history.unshift(entry);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_ENTRIES)));
  } catch (error) {
    console.error('Failed to record swap in history:', error);
  }
}

export async function getSwapHistory(): Promise<SwapHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SwapHistoryEntry[]) : [];
  } catch (error) {
    console.error('Failed to read swap history:', error);
    return [];
  }
}

export async function clearSwapHistory(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
