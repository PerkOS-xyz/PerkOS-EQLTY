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
  orchestrationReady: boolean;
};

export type GoalPolicy = {
  source: "ens" | "durin" | "local";
  version?: number | string;
  manifestHash?: `0x${string}`;
  allowedTickers: string[];
  paused: boolean;
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
  proofRoot: `0x${string}`;
};

export type GoalGates = {
  ens: "resolve-every-cycle";
  oneclaw: "enforced" | "preview";
  linkedRoles: AgentRole[];
  requiredRoles: AgentRole[];
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
