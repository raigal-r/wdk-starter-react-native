import { BitfinexPricingClient } from '@tetherto/wdk-pricing-bitfinex-http';
import { CoingeckoPricingClient } from '@tetherto/wdk-pricing-coingecko-http';
import { PricingProvider } from '@tetherto/wdk-pricing-provider';
import { AssetTicker } from '@tetherto/wdk-react-native-provider';
import DecimalJS from 'decimal.js';

export enum FiatCurrency {
  USD = 'USD',
}

/**
 * Pricing with two WDK pricing clients:
 * - Bitfinex (primary): low-latency exchange prices
 * - CoinGecko (fallback): used when Bitfinex has no pair or errors
 */
class PricingService {
  private static instance: PricingService;
  private provider: PricingProvider | null = null;
  private fallbackProvider: PricingProvider | null = null;
  private fiatExchangeRateCache: Record<FiatCurrency, Record<AssetTicker, number>> | undefined;
  private spotPriceCache: Record<string, number> = {};
  private isInitialized: boolean = false;

  private constructor() {}

  static getInstance(): PricingService {
    if (!PricingService.instance) {
      PricingService.instance = new PricingService();
    }
    return PricingService.instance;
  }

  async initialize(): Promise<void> {
    if (this.provider) return;

    try {
      this.provider = new PricingProvider({
        client: new BitfinexPricingClient(),
        priceCacheDurationMs: 1000 * 60 * 60, // 1 hour
      });

      this.fallbackProvider = new PricingProvider({
        client: new CoingeckoPricingClient(),
        priceCacheDurationMs: 1000 * 60 * 60, // 1 hour
      });

      // Fetch and update exchange rate cache
      this.fiatExchangeRateCache = {
        [FiatCurrency.USD]: {
          [AssetTicker.BTC]: await this.getLastPriceWithFallback(AssetTicker.BTC, FiatCurrency.USD),
          [AssetTicker.USDT]: 1,
          [AssetTicker.XAUT]: await this.getLastPriceWithFallback(
            AssetTicker.XAUT,
            FiatCurrency.USD
          ),
        },
      };

      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize pricing service:', error);
      throw error;
    }
  }

  /**
   * Query the primary (Bitfinex) client, falling back to CoinGecko when the
   * pair is unavailable or the request fails.
   */
  private async getLastPriceWithFallback(base: string, quote: string): Promise<number> {
    if (!this.provider || !this.fallbackProvider) {
      throw new Error('Pricing service not initialized');
    }

    try {
      const price = await this.provider.getLastPrice(base, quote);
      if (price) return price;
    } catch (error) {
      console.warn(`Bitfinex price for ${base}/${quote} unavailable, trying CoinGecko:`, error);
    }

    return await this.fallbackProvider.getLastPrice(base, quote);
  }

  /**
   * USD spot price for an arbitrary symbol (e.g. 'ETH' for WETH swap
   * targets), cached in memory for the session.
   */
  async getSpotPrice(symbol: string): Promise<number | undefined> {
    if (symbol === 'USDT') return 1;

    if (this.spotPriceCache[symbol] !== undefined) {
      return this.spotPriceCache[symbol];
    }

    try {
      const price = await this.getLastPriceWithFallback(symbol, FiatCurrency.USD);
      if (price) this.spotPriceCache[symbol] = price;
      return price ?? undefined;
    } catch (error) {
      console.error(`Failed to get spot price for ${symbol}:`, error);
      return undefined;
    }
  }

  async getFiatValue(value: number, asset: AssetTicker, currency: FiatCurrency): Promise<number> {
    if (!this.isInitialized || !this.fiatExchangeRateCache) {
      throw new Error('Pricing service not initialized. Call initialize() first.');
    }

    return new DecimalJS(value).mul(this.fiatExchangeRateCache[currency][asset]).toNumber();
  }

  async refreshExchangeRates(): Promise<void> {
    if (!this.provider) {
      throw new Error('Pricing service not initialized');
    }

    try {
      this.fiatExchangeRateCache = {
        [FiatCurrency.USD]: {
          [AssetTicker.BTC]: await this.getLastPriceWithFallback(AssetTicker.BTC, FiatCurrency.USD),
          [AssetTicker.USDT]: 1,
          [AssetTicker.XAUT]: await this.getLastPriceWithFallback(
            AssetTicker.XAUT,
            FiatCurrency.USD
          ),
        },
      };
      this.spotPriceCache = {};

      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to refresh exchange rates:', error);
      throw error;
    }
  }

  getExchangeRate(asset: AssetTicker, currency: FiatCurrency): number | undefined {
    return this.fiatExchangeRateCache?.[currency]?.[asset];
  }

  isReady(): boolean {
    return this.isInitialized;
  }
}

export const pricingService = PricingService.getInstance();
