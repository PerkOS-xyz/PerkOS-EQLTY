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
  sales: SaleAuditBundle[];
};

export type SaleAuditBundle = {
  schema: "urn:eqlty:sale-audit:v1";
  bundleHash: `0x${string}`;
  recordedAt: string;
  owner: `0x${string}`;
  ticker: string;
  transactionHash: `0x${string}`;
  approvalTransactionHash?: `0x${string}`;
  trade: {
    chainId: 4663;
    direction: "sell";
    tokenIn: `0x${string}`;
    tokenInDecimals: number;
    tokenOut: `0x${string}`;
    amountIn: string;
    quotedAmountOut: string;
    actualAmountOut: string;
    requestId: string;
    routing: string;
    router: `0x${string}`;
  };
  graph: {
    request: {
      method: "POST" | "eth_getLogs";
      endpoint: string;
      authorization: "Bearer [server credential]" | "Server managed";
      body: { ticker: string; chainId: "eip155:4663" };
    };
    response: {
      status: "observed" | "indexed-nearby" | "unavailable";
      source: "the-graph-substreams" | "robinhood-rpc";
      provider?: string;
      package?: string;
      module?: "map_pool_events" | "eth_getLogs";
      evidenceTransaction?: `0x${string}`;
      saleTransaction: `0x${string}`;
      saleObserved: boolean;
      evidenceBlock?: string;
      processedBlock?: string;
      headBlock?: string;
      lagBlocks?: number;
      poolManager?: `0x${string}`;
      poolId?: string;
      salePoolManager: `0x${string}`;
      salePoolId: string;
      poolMatched: boolean;
      capturedAt?: string;
      error?: string;
    };
  };
  receipt: {
    chainId: 4663;
    status: "success";
    blockNumber: string;
    blockHash: `0x${string}`;
    from: `0x${string}`;
    to: `0x${string}`;
    gasUsed: string;
    effectiveGasPrice: string;
    swapLogIndex: number;
  };
  transfers: Array<{
    token: `0x${string}`;
    symbol: string;
    from: `0x${string}`;
    to: `0x${string}`;
    amount: string;
    logIndex: number;
  }>;
};

export type PurchaseAuditBundle = {
  schema: "urn:eqlty:purchase-audit:v1";
  bundleHash: `0x${string}`;
  recordedAt: string;
  owner: `0x${string}`;
  ticker: string;
  transactionHash: `0x${string}`;
  strategy: {
    appId: string;
    onchainId: string;
    agent: `0x${string}`;
    vault: `0x${string}`;
    inputToken: `0x${string}`;
    outputToken: `0x${string}`;
    router: `0x${string}`;
    amountIn: string;
    maxSlippageBps: number;
    expiresAt: string;
    setupTransactions: {
      creation: `0x${string}`;
      approval: `0x${string}`;
      funding: `0x${string}`;
    };
  };
  ens: {
    status: "verified";
    manifestHash?: string;
    detail?: string;
  };
  graph: {
    request: {
      method: "POST" | "eth_getLogs";
      endpoint: string;
      authorization: "Bearer [server credential]" | "Server managed";
      body: { ticker: string; chainId: "eip155:4663" };
    };
    response: {
      source: "the-graph-substreams" | "robinhood-rpc";
      evidenceScope?: "pre-trade-market";
      provider?: string;
      package?: string;
      module?: "map_pool_events" | "eth_getLogs";
      evidenceTransaction?: `0x${string}`;
      evidenceBlock: string;
      checkpointBlock?: string;
      processedBlock?: string;
      headBlock?: string;
      lagBlocks?: number;
      poolManager: `0x${string}`;
      poolId: string;
      eventTopic: `0x${string}`;
      capturedAt: string;
    };
  };
  uniswap: {
    routing: string;
    requestId: string;
    quotedAmountOut: string;
    router: `0x${string}`;
    poolManager: `0x${string}`;
    poolId: string;
    poolMatchedGraphEvidence: boolean;
    graphPoolRelationship?: "same-pool" | "independent-market-pool";
  };
  proofs: {
    decisionReceipt?: import("./goal-types").DecisionReceipt;
    proofBundleRoot?: `0x${string}`;
    signalHash: `0x${string}`;
    quoteHash: `0x${string}`;
    handoffs: Array<{
      from: string;
      to: string;
      kind: string;
      outputHash: `0x${string}`;
    }>;
  };
  receipt: {
    chainId: 4663;
    status: "success";
    blockNumber: string;
    blockHash: `0x${string}`;
    from: `0x${string}`;
    to?: `0x${string}`;
    gasUsed: string;
    effectiveGasPrice: string;
    tradeLogIndex: number;
    swapLogIndex: number;
  };
  transfers: Array<{
    token: `0x${string}`;
    symbol: string;
    from: `0x${string}`;
    to: `0x${string}`;
    amount: string;
    logIndex: number;
  }>;
  workflow: {
    steps: Array<{
      id: string;
      label: string;
      status: string;
      mode: string;
      detail: string;
      evidence?: string;
      at: string;
    }>;
    handoffs: Array<{
      id: string;
      from: string;
      to: string;
      kind: string;
      mode: string;
      status: string;
      outputHash: `0x${string}`;
      at: string;
    }>;
    oneclaw: {
      required: boolean;
      linked: boolean;
      minimumAmount: string;
      executionAuthorized: boolean;
    };
  };
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
