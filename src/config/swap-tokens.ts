import { NetworkType } from '@tetherto/wdk-react-native-provider';

export interface SwapToken {
  /** Ticker used for display and pricing lookups */
  symbol: string;
  /** Human readable name */
  name: string;
  /** ERC-20 contract address on the given network */
  address: string;
  /** On-chain decimals */
  decimals: number;
  icon: any;
  /** Base symbol used by the pricing service (e.g. XAUT, ETH) */
  pricingSymbol: string;
}

export type SwapNetwork = NetworkType.ETHEREUM | NetworkType.ARBITRUM | NetworkType.POLYGON;

/**
 * ERC-20 tokens available in the in-app swap, per EVM network.
 * The first entry of each list is USD₮, which is the default "from" token.
 */
export const swapTokens: Record<SwapNetwork, SwapToken[]> = {
  [NetworkType.ETHEREUM]: [
    {
      symbol: 'USD₮',
      name: 'Tether USD',
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      decimals: 6,
      icon: require('../../assets/images/tokens/tether-usdt-logo.png'),
      pricingSymbol: 'USDT',
    },
    {
      symbol: 'XAU₮',
      name: 'Tether Gold',
      address: '0x68749665FF8D2d112Fa859AA293F07A622782F38',
      decimals: 6,
      icon: require('../../assets/images/tokens/tether-xaut-logo.png'),
      pricingSymbol: 'XAUT',
    },
  ],
  [NetworkType.ARBITRUM]: [
    {
      symbol: 'USD₮',
      name: 'Tether USD',
      address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      decimals: 6,
      icon: require('../../assets/images/tokens/tether-usdt-logo.png'),
      pricingSymbol: 'USDT',
    },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      decimals: 18,
      icon: require('../../assets/images/chains/ethereum-eth-logo.png'),
      pricingSymbol: 'ETH',
    },
  ],
  [NetworkType.POLYGON]: [
    {
      symbol: 'USD₮',
      name: 'Tether USD',
      address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      decimals: 6,
      icon: require('../../assets/images/tokens/tether-usdt-logo.png'),
      pricingSymbol: 'USDT',
    },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      decimals: 18,
      icon: require('../../assets/images/chains/ethereum-eth-logo.png'),
      pricingSymbol: 'ETH',
    },
  ],
};

export const SWAP_NETWORKS: SwapNetwork[] = [
  NetworkType.ETHEREUM,
  NetworkType.ARBITRUM,
  NetworkType.POLYGON,
];

export function getUsdtToken(network: SwapNetwork): SwapToken {
  return swapTokens[network][0];
}

export function getSwapTargets(network: SwapNetwork): SwapToken[] {
  return swapTokens[network].slice(1);
}
