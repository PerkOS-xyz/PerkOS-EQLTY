export type StockAvailability = "available" | "caution" | "blocked";

export type GraphEvidenceSummary = {
  source: "the-graph-substreams";
  healthy: boolean;
  protocol: "v3" | "v4";
  blockNumber: string;
  liquidityUsd: number;
  lastSwapPrice: number;
  priceDeviationBps?: number;
  poolAddress: `0x${string}`;
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
  tokenAddress: `0x${string}`;
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
