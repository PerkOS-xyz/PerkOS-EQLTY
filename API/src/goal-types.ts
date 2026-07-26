import type { FleetRole } from "./fleet-types.js";
import type { EvmAddress } from "./market-types.js";

export type OpportunityCandidate = {
  ticker: string;
  name: string;
  tokenAddress?: EvmAddress;
  status: "recommended" | "eligible" | "rejected";
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
    poolAddress: EvmAddress;
    capturedAt: string;
    liquidityUsd: number;
  };
  orchestrationReady: boolean;
};

export type OpportunityAnalysis = {
  id: string;
  goal: string;
  amountIn: string;
  mode: "analysis";
  policy: {
    source: "durin";
    rootName: string;
    version: number;
    manifestHash: `0x${string}`;
    allowedTickers: string[];
    paused: boolean;
  };
  evaluatedAt: string;
  recommendedTicker?: string;
  candidates: OpportunityCandidate[];
  proofRoot: `0x${string}`;
};

export type GoalGates = {
  ens: "resolve-every-cycle";
  oneclaw: "enforced";
  linkedRoles: FleetRole[];
  requiredRoles: FleetRole[];
  oneclawRequired: boolean;
  oneclawLinked: boolean;
  oneclawMinimumAmount: string;
  executionAuthorized: boolean;
  detail: string;
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
  history: Array<{
    cycle: number;
    evaluatedAt: string;
    recommendedTicker?: string;
    proofRoot: `0x${string}`;
    policyManifestHash?: `0x${string}`;
  }>;
  error?: string;
};

export type GoalIdentity = {
  userId: string;
  owner: EvmAddress;
};

export type GoalInput = GoalIdentity & {
  goal: string;
  amountIn: string;
  windowMinutes: number;
  cadenceSeconds: number;
  maxCandidates: number;
  candidateTickers?: string[];
  linkedRoles: readonly FleetRole[];
};
