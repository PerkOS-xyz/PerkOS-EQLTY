import type { FleetAgent, FleetRole } from "./fleet-types.js";
import type { EvmAddress } from "./market-types.js";
import type { AgentConsultation } from "./consultation-types.js";
import type {
  DecisionFee,
  DecisionFeePaymentPayload,
} from "./decision-fee-types.js";
import type {
  FinancialGoalProfile,
  GoalReadiness,
} from "./financial-goal.js";

export type DecisionOutcome = {
  kind: "primary" | "alternative" | "no_action";
  ticker?: string;
  title: string;
  summary: string;
  reasons: string[];
};

export type DecisionReceipt = {
  schema: "urn:eqlty:decision-receipt:v1";
  id: string;
  analysisId: string;
  issuedAt: string;
  goal: string;
  profile?: FinancialGoalProfile;
  amountIn: string;
  decisionStatus:
    | "agent_verified"
    | "rules_only"
    | "insufficient_evidence";
  readiness: GoalReadiness;
  selection?: {
    ticker: string;
    tokenAddress?: EvmAddress;
    score: number;
    rationale: string;
  };
  policy: {
    rootName: string;
    version: number;
    manifestHash: `0x${string}`;
  };
  evidence?: {
    graph?: {
      blockNumber: string;
      transactionHash: `0x${string}`;
      poolIdentifier: string;
      poolAddress: EvmAddress;
      capturedAt: string;
      liquidityUsd: number;
    };
    uniswap?: {
      requestId: string;
      routing: string;
      quotedAmountOut?: string;
      deviationBps?: number;
    };
  };
  agents: Record<
    FleetRole,
    {
      role: FleetRole;
      agentId?: string;
      agentName?: string;
      status: "verified" | "invalid" | "unavailable" | "skipped";
      ticker?: string;
      summary?: string;
      responseHash?: `0x${string}`;
      facts: Array<{
        source: "ens" | "the-graph" | "uniswap";
        label: string;
        value: string;
      }>;
      detail?: string;
    }
  >;
  candidates: OpportunityCandidate[];
  outcomes: DecisionOutcome[];
  root: `0x${string}`;
};

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
  decisionStatus:
    | "agent_verified"
    | "rules_only"
    | "insufficient_evidence";
  readiness: GoalReadiness;
  recommendedTicker?: string;
  candidates: OpportunityCandidate[];
  outcomes: DecisionOutcome[];
  consultation: AgentConsultation;
  receipt: DecisionReceipt;
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
  status: "active" | "payment-required" | "completed" | "blocked";
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
    decisionReceiptId: string;
    proofRoot: `0x${string}`;
    policyManifestHash?: `0x${string}`;
  }>;
  decisionFee?: DecisionFee;
  error?: string;
};

export type GoalIdentity = {
  userId: string;
  owner: EvmAddress;
  perkosIdToken?: string;
};

export type GoalInput = GoalIdentity & {
  goal: string;
  profile?: FinancialGoalProfile;
  amountIn: string;
  windowMinutes: number;
  cadenceSeconds: number;
  maxCandidates: number;
  candidateTickers?: string[];
  linkedRoles: readonly FleetRole[];
  fleetAgents?: FleetAgent[];
  perkosIdToken?: string;
};

export type SettleGoalDecisionFeeInput = GoalIdentity & {
  payment: DecisionFeePaymentPayload;
};

export type GoalExecutionAuthorization = {
  goalId: string;
  amountIn: string;
  ticker: string;
  proofRoot: `0x${string}`;
  decisionReceipt: DecisionReceipt;
  policyManifestHash: `0x${string}`;
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
