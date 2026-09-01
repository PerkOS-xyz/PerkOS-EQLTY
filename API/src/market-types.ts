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
export type UniswapCoverageStatus =
  | "unavailable"
  | "not_observed"
  | "market_observed"
  | "quote_verified";

export type GraphEvidenceSummary = {
  source: "the-graph-substreams";
  healthy: boolean;
  protocol: "v3" | "v4";
  blockNumber: string;
  liquidityUsd: number;
  lastSwapPrice: number;
  priceDeviationBps?: number;
  poolAddress: EvmAddress;
  poolIdentifier: string;
  transactionHash: `0x${string}`;
  topic: `0x${string}`;
  capturedAt: string;
  processedBlock: string;
  providerHeadBlock: string;
  lagBlocks: number;
  provider?: string;
  package?: string;
  module?: "map_pool_events";
  startedAt?: string;
  updatedAt?: string;
  checkpointBlock?: string;
  reasons: string[];
};

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
  uniswapCoverage?: UniswapCoverageStatus;
  uniswapMarketObservedAt?: string;
  uniswapRouting?: string;
  uniswapRouteVerifiedAt?: string;
  uniswapRequestId?: string;
  quotedAmountIn: string;
  quotedAmountOut?: string;
  uniswapImpliedPrice?: number;
  deviationBps?: number;
  graphEvidence?: GraphEvidenceSummary;
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

export type PreparedUniswapSwap = {
  amountOut: string;
  requestId: string;
  routing: string;
  rawQuote: Record<string, unknown>;
  transaction: {
    to: EvmAddress;
    from: EvmAddress;
    data: `0x${string}`;
    value: string;
    chainId: number;
  };
};

export type UniswapTransaction = PreparedUniswapSwap["transaction"];

export type WalletSwapQuote = {
  chainId: 4663;
  direction: "sell";
  ticker: string;
  tokenIn: EvmAddress;
  tokenOut: EvmAddress;
  amountIn: string;
  amountOut: string;
  requestId: string;
  routing: string;
  quotedAt: string;
  approval?: UniswapTransaction;
  permitData?: Record<string, unknown>;
  rawQuote: Record<string, unknown>;
};
