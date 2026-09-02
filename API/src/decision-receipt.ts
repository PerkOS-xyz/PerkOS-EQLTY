import type { AgentConsultation } from "./consultation-types.js";
import type {
  DecisionOutcome,
  DecisionReceipt,
  OpportunityCandidate,
} from "./goal-types.js";
import type {
  FinancialGoalProfile,
  GoalReadiness,
} from "./financial-goal.js";
import { hashPayload } from "./proof-handoff.js";

type ReceiptInput = {
  analysisId: string;
  issuedAt: string;
  goal: string;
  profile?: FinancialGoalProfile;
  amountIn: string;
  decisionStatus: DecisionReceipt["decisionStatus"];
  readiness: GoalReadiness;
  selection?: OpportunityCandidate;
  policy: DecisionReceipt["policy"];
  consultation: AgentConsultation;
  candidates: OpportunityCandidate[];
  outcomes: DecisionOutcome[];
};

export function buildDecisionReceipt(input: ReceiptInput): DecisionReceipt {
  const selection = input.selection;
  const evidence = selection
    ? {
        ...(selection.graphEvidence
          ? { graph: structuredClone(selection.graphEvidence) }
          : {}),
        ...(selection.uniswapRequestId && selection.uniswapRouting
          ? {
              uniswap: {
                requestId: selection.uniswapRequestId,
                routing: selection.uniswapRouting,
                ...(selection.quotedAmountOut
                  ? { quotedAmountOut: selection.quotedAmountOut }
                  : {}),
                ...(selection.deviationBps !== undefined
                  ? { deviationBps: selection.deviationBps }
                  : {}),
              },
            }
          : {}),
      }
    : undefined;
  const body = {
    schema: "urn:eqlty:decision-receipt:v1" as const,
    id: `decision:${input.analysisId}`,
    analysisId: input.analysisId,
    issuedAt: input.issuedAt,
    goal: input.goal,
    ...(input.profile ? { profile: structuredClone(input.profile) } : {}),
    amountIn: input.amountIn,
    decisionStatus: input.decisionStatus,
    readiness: structuredClone(input.readiness),
    ...(selection
      ? {
          selection: {
            ticker: selection.ticker,
            ...(selection.tokenAddress
              ? { tokenAddress: selection.tokenAddress }
              : {}),
            score: selection.score,
            rationale: selection.reason,
          },
        }
      : {}),
    policy: structuredClone(input.policy),
    ...(evidence && Object.keys(evidence).length > 0 ? { evidence } : {}),
    agents: {
      scout: receiptStep(input.consultation.scout),
      risk: receiptStep(input.consultation.risk),
      trader: receiptStep(input.consultation.trader),
      auditor: receiptStep(input.consultation.auditor),
    },
    candidates: structuredClone(input.candidates),
    outcomes: structuredClone(input.outcomes),
  };
  return { ...body, root: hashPayload(body) };
}

export function verifyDecisionReceipt(
  receipt: DecisionReceipt | undefined,
): receipt is DecisionReceipt {
  if (!receipt || typeof receipt !== "object") return false;
  const { root, ...body } = receipt;
  return receipt.schema === "urn:eqlty:decision-receipt:v1" &&
    hashPayload(body) === root;
}

function receiptStep(
  step: AgentConsultation["scout"],
): DecisionReceipt["agents"]["scout"] {
  return {
    role: step.role,
    ...(step.agentId ? { agentId: step.agentId } : {}),
    ...(step.agentName ? { agentName: step.agentName } : {}),
    status: step.status,
    ...(step.ticker ? { ticker: step.ticker } : {}),
    ...(step.summary ? { summary: step.summary } : {}),
    ...(step.responseHash ? { responseHash: step.responseHash } : {}),
    facts: structuredClone(step.facts),
    ...(step.detail ? { detail: step.detail } : {}),
  };
}
