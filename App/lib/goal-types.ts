import type { AgentRole } from "./fleet-types";

export type CandidateStatus = "recommended" | "eligible" | "rejected";

export type FinancialGoalProfile = {
  purpose: "learn" | "long-term-growth" | "planned-purchase";
  horizonMonths: number;
  liquidityNeed: "may-need" | "can-commit";
  riskComfort: "low" | "medium" | "high";
};

export type GoalReadiness = {
  status:
    | "explore_only"
    | "limited_position"
    | "ready_to_compare"
    | "no_action";
  summary: string;
  reasons: string[];
};

export type DecisionOutcome = {
  kind: "primary" | "alternative" | "no_action";
  ticker?: string;
  title: string;
  summary: string;
  reasons: string[];
};

export type OpportunityCandidate = {
  ticker: string;
  name: string;
  tokenAddress?: `0x${string}`;
  status: CandidateStatus;
  score: number;
  reason: string;
  referencePrice?: string;
  uniswapImpliedPrice?: string;
  deviationBps?: number;
  quotedAmountOut?: string;
  uniswapRequestId?: string;
  uniswapRouting?: string;
  graphEvidence?: {
    blockNumber: string;
    transactionHash: `0x${string}`;
    poolIdentifier: string;
    poolAddress: `0x${string}`;
    capturedAt: string;
    liquidityUsd: number;
  };
  orchestrationReady: boolean;
};

export type GoalPolicy = {
  source: "ens" | "durin" | "local";
  rootName?: string;
  version?: number | string;
  manifestHash?: `0x${string}`;
  allowedTickers: string[];
  paused: boolean;
};

export type ConsultationFact = {
  source: "ens" | "the-graph" | "uniswap";
  label: string;
  value: string;
};

export type ConsultationStep = {
  role: AgentRole;
  agentId?: string;
  agentName?: string;
  status: "verified" | "invalid" | "unavailable" | "skipped";
  ticker?: string;
  summary?: string;
  responseHash?: `0x${string}`;
  facts: ConsultationFact[];
  detail?: string;
};

export type AgentConsultation = {
  mode: "hermes-a2a" | "deterministic-fallback";
  status: "verified" | "invalid" | "unavailable";
  selectedTicker?: string;
  scout: ConsultationStep;
  risk: ConsultationStep;
  trader: ConsultationStep;
  auditor: ConsultationStep;
};

export type OpportunityAnalysis = {
  id: string;
  goal: string;
  amountIn: string;
  mode: "analysis";
  policy: GoalPolicy;
  evaluatedAt: string;
  decisionStatus:
    | "agent_verified"
    | "rules_only"
    | "insufficient_evidence";
  readiness: GoalReadiness;
  recommendedTicker?: string;
  candidates: OpportunityCandidate[];
  outcomes: DecisionOutcome[];
  consultation: AgentConsultation;
  proofRoot: `0x${string}`;
};

export type GoalGates = {
  ens: "resolve-every-cycle";
  oneclaw: "enforced" | "preview";
  linkedRoles: AgentRole[];
  requiredRoles: AgentRole[];
  oneclawRequired: boolean;
  oneclawLinked: boolean;
  oneclawMinimumAmount: string;
  executionAuthorized: boolean;
  detail: string;
};

export type GoalHistoryItem = {
  cycle: number;
  evaluatedAt: string;
  recommendedTicker?: string;
  proofRoot: `0x${string}`;
  policyManifestHash?: `0x${string}`;
};

export type DecisionFeeRequirements = {
  scheme: "exact";
  network: "eip155:4663";
  amount: string;
  asset: `0x${string}`;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  extra: {
    name: "Global Dollar";
    version: "1";
  };
};

export type DecisionFeePaymentPayload = {
  x402Version: 2;
  resource: {
    url: string;
    description: string;
    mimeType: "application/json";
  };
  accepted: DecisionFeeRequirements;
  payload: {
    signature: `0x${string}`;
    authorization: {
      from: `0x${string}`;
      to: `0x${string}`;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: `0x${string}`;
    };
  };
  extensions: Record<string, unknown>;
};

export type DecisionFee = {
  mode: "preview" | "live";
  status:
    | "preview"
    | "payment-required"
    | "settled"
    | "waived"
    | "failed";
  scheme: "exact";
  amount: string;
  maximumAmount: string;
  decimals: 6;
  symbol: "USDG";
  reason: string;
  requirements?: DecisionFeeRequirements;
  receipt?: {
    payer: `0x${string}`;
    amount: string;
    asset: `0x${string}`;
    network: "eip155:4663";
    authorizationNonce: `0x${string}`;
    transaction?: `0x${string}`;
    explorerUrl?: string;
    requestId?: string;
    settledAt: string;
  };
  error?: string;
};

export type AutonomousGoal = {
  id: string;
  goal: string;
  amountIn: string;
  status: "active" | "payment-required" | "completed" | "blocked";
  startedAt: string;
  endsAt: string;
  nextEvaluationAt?: string;
  cadenceSeconds: number;
  cyclesCompleted: number;
  gates: GoalGates;
  latest?: OpportunityAnalysis;
  history: GoalHistoryItem[];
  decisionFee?: DecisionFee;
  error?: string;
};

export type StartGoalInput = {
  goal: string;
  profile?: FinancialGoalProfile;
  amountIn: string;
  windowMinutes: number;
  cadenceSeconds?: number;
  maxCandidates?: number;
  candidateTickers?: string[];
};
