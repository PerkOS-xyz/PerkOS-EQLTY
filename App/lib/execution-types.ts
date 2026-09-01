export type ProofMode = "preview" | "live";

export type OnchainStrategy = {
  chainId: 4663;
  strategyId: string;
  creationTransactionHash: `0x${string}`;
  approvalTransactionHash: `0x${string}`;
  fundingTransactionHash: `0x${string}`;
};

export type ExecutionStrategy = {
  id: string;
  ticker: string;
  owner: `0x${string}`;
  agent: `0x${string}`;
  inputToken: `0x${string}`;
  outputToken: `0x${string}`;
  router: `0x${string}`;
  maxAmountPerTrade: string;
  maxTotalSpend: string;
  spent: string;
  maxSlippageBps: number;
  expiresAt: string;
  status: "active" | "paused" | "revoked" | "expired";
  humanProof: {
    provider: string;
    status: "verified" | "unverified";
    proofHash: `0x${string}`;
  };
  executionMode: "analysis" | "full";
  onchain?: OnchainStrategy;
};

export type RunStep = {
  id: string;
  label: string;
  status: "pending" | "running" | "passed" | "blocked" | "failed";
  mode: ProofMode;
  detail: string;
  evidence?: string;
  at: string;
};

export type AgentHandoff = {
  id: string;
  from: "ens" | "scout" | "risk" | "trader" | "auditor";
  to: "scout" | "risk" | "trader" | "auditor";
  kind:
    | "fleet-policy"
    | "paid-signal"
    | "risk-decision"
    | "execution-intent"
    | "audit-bundle";
  mode: ProofMode;
  status: "sealed" | "signed";
  outputHash: `0x${string}`;
  at: string;
};

export type TradeRun = {
  id: string;
  strategyId: string;
  ticker: string;
  amountIn: string;
  executeRequested: boolean;
  status: "running" | "approved" | "rejected" | "executed" | "failed";
  createdAt: string;
  steps: RunStep[];
  handoffs: AgentHandoff[];
  oneclaw: {
    required: boolean;
    linked: boolean;
    minimumAmount: string;
    executionAuthorized: boolean;
  };
  proofBundleRoot?: `0x${string}`;
  rejectionReason?: string;
  transactionHash?: `0x${string}`;
  signal?: {
    goalId: string;
    decisionProofRoot: `0x${string}`;
    policyManifestHash: `0x${string}`;
    sourceAgent: string;
    side: string;
    confidence: number;
    rationale: string;
    payment:
      | {
          mode: "live";
          status: "settled";
          authorizationNonce: `0x${string}`;
          transaction?: `0x${string}`;
        }
      | {
          mode: "preview";
          status: "preview";
        };
  };
  market?: {
    liquidityUsd: number;
    lastSwapPrice: number;
    oraclePrice: number;
    graphMode: ProofMode;
    blockNumber: string;
    graphProvider?: string;
    graphLagBlocks?: number;
    graphPackage?: string;
    graphModule?: "map_pool_events";
    graphCheckpointBlock?: string;
    graphProcessedBlock?: string;
    graphHeadBlock?: string;
    graphStartedAt?: string;
    graphUpdatedAt?: string;
    poolAddress: `0x${string}`;
    poolIdentifier: string;
    transactionHash?: `0x${string}`;
    eventTopic: `0x${string}`;
    capturedAt: string;
  };
  quote?: {
    routing: string;
    quotedAmountOut: string;
    requestId: string;
    mode: ProofMode;
  };
  audit?: {
    status: "stored" | "failed";
    documentId?: string;
    bundleHash?: `0x${string}`;
    error?: string;
  };
};

export type CreateStrategyInput = {
  owner: `0x${string}`;
  agent: `0x${string}`;
  ticker: string;
  inputToken: `0x${string}`;
  outputToken: `0x${string}`;
  router: `0x${string}`;
  maxAmountPerTrade: string;
  maxTotalSpend: string;
  maxSlippageBps: number;
  expiresAt: string;
  humanVerified: boolean;
};
