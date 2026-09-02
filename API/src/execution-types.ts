import type { EvmAddress } from "./market-types.js";
import type { OneClawGate } from "./oneclaw-policy.js";
import type {
  DecisionReceipt,
  GoalExecutionAuthorization,
} from "./goal-types.js";

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
  owner: EvmAddress;
  agent: EvmAddress;
  inputToken: EvmAddress;
  outputToken: EvmAddress;
  router: EvmAddress;
  maxAmountPerTrade: string;
  maxTotalSpend: string;
  spent: string;
  maxSlippageBps: number;
  expiresAt: string;
  status: "active" | "paused" | "revoked" | "expired";
  humanProof: {
    provider: "owner-wallet-session";
    status: "verified";
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
    | "decision-receipt"
    | "policy-revalidation"
    | "fleet-policy"
    | "paid-signal"
    | "risk-decision"
    | "execution-intent"
    | "audit-bundle";
  mode: ProofMode;
  status: "sealed";
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
  oneclaw: OneClawGate;
  decisionReceipt?: DecisionReceipt;
  proofBundleRoot?: `0x${string}`;
  rejectionReason?: string;
  transactionHash?: `0x${string}`;
  signal?: {
    goalId: string;
    decisionProofRoot: `0x${string}`;
    decisionReceiptRoot: `0x${string}`;
    agentResponseHashes: Partial<
      Record<"scout" | "risk" | "trader" | "auditor", `0x${string}`>
    >;
    policyManifestHash: `0x${string}`;
    sourceAgent: string;
    side: string;
    confidence: number;
    rationale: string;
    payment: GoalExecutionAuthorization["payment"];
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
    poolAddress: EvmAddress;
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

export type NewStrategy = Omit<
  ExecutionStrategy,
  "humanProof" | "id" | "spent" | "status"
>;
