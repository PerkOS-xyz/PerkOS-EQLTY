export type EvmAddress = `0x${string}`;

export type RobinhoodAsset = {
  tokenSymbol: string;
  tokenName: string;
  deployments: Array<{
    contractAddress: string;
    chainId: number;
  }>;
  currentMultiplier: string;
  logoUrl?: string;
  status: string;
  tradingCapabilities?: {
    fractionalTradability?: string;
    market?: {
      fractional?: string;
    };
  };
};

export type RobinhoodQuote = {
  tokenSymbol: string;
  ask: string;
  bid?: string;
  generatedAt: string;
  isTradingHalt: boolean;
};

export type StockAvailability = "available" | "caution" | "blocked";

export type StockCatalogAsset = {
  ticker: string;
  name: string;
  tokenAddress: EvmAddress;
  logoUrl?: string;
  multiplier: string;
  robinhoodStatus: string;
  tradability: string;
  explorerUrl?: string;
  priceSource: "robinhood-price-api";
  referencePrice?: number;
  referenceUpdatedAt?: string;
  uniswapRoutable: boolean;
  uniswapRouting?: string;
  uniswapRouteVerifiedAt?: string;
  uniswapRequestId?: string;
  quotedAmountIn: string;
  quotedAmountOut?: string;
  uniswapImpliedPrice?: number;
  deviationBps?: number;
  status: StockAvailability;
  reasons: string[];
  orchestrationReady: boolean;
};

export type StockCatalog = {
  chainId: 4663;
  quoteToken: "USDG";
  quoteAmount: string;
  observedAt: string;
  thresholds: {
    availableDeviationBps: number;
    maxDeviationBps: number;
    maxReferenceAgeSeconds: number;
  };
  summary: {
    total: number;
    available: number;
    caution: number;
    blocked: number;
    routed: number;
    orchestrationReady: number;
  };
  assets: StockCatalogAsset[];
};

export type UniswapQuote = {
  amountOut: string;
  requestId?: string;
  routing: string;
};
