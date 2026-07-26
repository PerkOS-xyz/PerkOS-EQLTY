import type { AgentRole } from "./fleet-types";

export type CandidateStatus = "recommended" | "eligible" | "rejected";

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
  role: "scout" | "risk";
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
};

export type OpportunityAnalysis = {
  id: string;
  goal: string;
  amountIn: string;
  mode: "analysis";
  policy: GoalPolicy;
  evaluatedAt: string;
  recommendedTicker?: string;
  candidates: OpportunityCandidate[];
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

export type AutonomousGoal = {
  id: string;
  goal: string;
  amountIn: string;
  status: "active" | "completed" | "blocked";
  startedAt: string;
  endsAt: string;
  nextEvaluationAt?: string;
  cadenceSeconds: number;
  cyclesCompleted: number;
  gates: GoalGates;
  latest?: OpportunityAnalysis;
  history: GoalHistoryItem[];
  error?: string;
};

export type StartGoalInput = {
  goal: string;
  amountIn: string;
  windowMinutes: number;
  cadenceSeconds?: number;
  maxCandidates?: number;
  candidateTickers?: string[];
};
