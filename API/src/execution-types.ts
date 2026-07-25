import type { EvmAddress } from "./market-types.js";

export type ProofMode = "preview" | "live";

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
  proofBundleRoot?: `0x${string}`;
  rejectionReason?: string;
  transactionHash?: `0x${string}`;
  signal?: {
    sourceAgent: string;
    side: string;
    confidence: number;
    rationale: string;
    payment: { mode: ProofMode };
  };
  market?: {
    liquidityUsd: number;
    lastSwapPrice: number;
    oraclePrice: number;
    graphMode: ProofMode;
    blockNumber: string;
    graphProvider?: string;
    graphLagBlocks?: number;
  };
  quote?: {
    routing: string;
    quotedAmountOut: string;
    requestId: string;
    mode: ProofMode;
  };
};

export type NewStrategy = Omit<
  ExecutionStrategy,
  "humanProof" | "id" | "spent" | "status"
>;
