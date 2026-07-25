export type PurchaseHistoryEntry = {
  id: string;
  status: "executed";
  strategyId: string;
  nonce: string;
  ticker?: string;
  inputToken: `0x${string}`;
  outputToken: `0x${string}`;
  outputDecimals?: number;
  amountIn: string;
  amountOut: string;
  router: `0x${string}`;
  signalHash: `0x${string}`;
  quoteHash: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: string;
  executedAt: string;
};

export type PurchaseHistory = {
  source: "robinhood-chain";
  status: "ready" | "pending";
  vault?: `0x${string}`;
  entries: PurchaseHistoryEntry[];
};

export type PortfolioHolding = {
  ticker: string;
  name: string;
  tokenAddress: `0x${string}`;
  logoUrl?: string;
  balance: string;
  decimals: number;
  currentPriceUsd?: number;
  priceUpdatedAt?: string;
  marketValueUsd?: number;
  averageCostUsd?: number;
  costBasisUsd?: number;
  unrealizedGainUsd?: number;
  unrealizedGainPercent?: number;
  purchaseCount: number;
  costStatus: "verified" | "partial" | "unavailable";
};

export type Portfolio = {
  source: "robinhood-chain";
  status: "ready" | "pending";
  owner: `0x${string}`;
  observedAt: string;
  coverage: {
    checkedTokens: number;
    unreadableTokens: number;
    pricedPositions: number;
    verifiedCostPositions: number;
  };
  summary: {
    positions: number;
    marketValueUsd: number;
    costBasisUsd: number;
    unrealizedGainUsd: number;
  };
  holdings: PortfolioHolding[];
};
