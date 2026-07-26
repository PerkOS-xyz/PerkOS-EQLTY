import { keccak256, stringToHex } from "viem";
import { z } from "zod";
import type { EnsOrchestrationManifest } from "./ens-types.js";
import type { FleetAgent } from "./fleet-types.js";
import type {
  ConsultationFact,
  ConsultationStep,
} from "./consultation-types.js";
import type {
  OpportunityCandidate,
} from "./goal-types.js";

const evidenceKey = z.enum([
  "graphLiquidity",
  "graphBlock",
  "routeDeviation",
  "uniswapRouting",
]);
const riskCheck = z.enum([
  "ensAllowed",
  "deviationWithinLimit",
  "liquidityAboveMinimum",
  "graphEvidencePresent",
]);
const textWithoutNumbers = z
  .string()
  .trim()
  .min(20)
  .max(320)
  .refine((value) => !/\d/.test(value));
const scoutReply = z
  .object({
    recommendedTicker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/),
    thesis: textWithoutNumbers,
    evidence: z
      .array(evidenceKey)
      .min(2)
      .max(4)
      .refine((items) => new Set(items).size === items.length),
  })
  .strict();
const riskReply = z
  .object({
    decision: z.enum(["approve", "reject"]),
    ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/),
    summary: textWithoutNumbers,
    checks: z
      .array(riskCheck)
      .length(4)
      .refine((items) => new Set(items).size === items.length),
  })
  .strict();

export type ConsultationTaskResponse = {
  ok?: boolean;
  reply?: string;
  detail?: string;
  agentId?: string;
  agentName?: string;
};

export type ReadyFleetAgent = FleetAgent & { agentId: string };

export function verifyScout(
  agent: ReadyFleetAgent,
  task: ConsultationTaskResponse,
  candidates: OpportunityCandidate[],
): ConsultationStep {
  if (!task.ok || !task.reply) {
    return unavailable(agent, task.detail ?? "Scout did not answer");
  }
  const parsed = scoutReply.safeParse(parseReply(task.reply));
  if (!parsed.success) {
    return invalid(agent, task.reply, "Scout returned an invalid handoff");
  }
  const candidate = candidates.find(
    (item) =>
      item.ticker === parsed.data.recommendedTicker &&
      item.status === "eligible",
  );
  if (!candidate) {
    return invalid(
      agent,
      task.reply,
      "Scout selected a candidate rejected by the deterministic gates",
    );
  }
  const facts = parsed.data.evidence
    .map((key) => evidenceFact(key, candidate))
    .filter((fact): fact is ConsultationFact => Boolean(fact));
  if (facts.length !== parsed.data.evidence.length) {
    return invalid(
      agent,
      task.reply,
      "Scout cited evidence absent from the sealed candidate",
    );
  }
  return {
    role: "scout",
    agentId: agent.agentId,
    agentName: agent.name,
    status: "verified",
    ticker: candidate.ticker,
    summary: parsed.data.thesis,
    responseHash: hashReply(task.reply),
    facts,
  };
}

export function verifyRisk(
  agent: ReadyFleetAgent,
  task: ConsultationTaskResponse,
  candidate: OpportunityCandidate,
  manifest: EnsOrchestrationManifest,
): ConsultationStep {
  if (!task.ok || !task.reply) {
    return unavailable(agent, task.detail ?? "Risk did not answer");
  }
  const parsed = riskReply.safeParse(parseReply(task.reply));
  if (!parsed.success || parsed.data.ticker !== candidate.ticker) {
    return invalid(agent, task.reply, "Risk returned an invalid handoff");
  }
  const checks = parsed.data.checks.map((key) =>
    policyFact(key, candidate, manifest),
  );
  const eligible = checks.every((check) => check.passed);
  if (
    (parsed.data.decision === "approve" && !eligible) ||
    (parsed.data.decision === "reject" && eligible)
  ) {
    return invalid(
      agent,
      task.reply,
      "Risk decision conflicts with the deterministic policy gates",
    );
  }
  return {
    role: "risk",
    agentId: agent.agentId,
    agentName: agent.name,
    status: "verified",
    ticker: candidate.ticker,
    summary: parsed.data.summary,
    responseHash: hashReply(task.reply),
    facts: checks.map(({ passed: _passed, ...fact }) => fact),
    detail: parsed.data.decision === "approve" ? "approved" : "rejected",
  };
}

export function scoutPrompt(input: {
  goal: string;
  candidates: OpportunityCandidate[];
  manifest: EnsOrchestrationManifest;
}): string {
  return [
    "You are the Scout in an EQLTY Hermes fleet.",
    "Reason only over the sealed JSON below. Do not invent or fetch values.",
    "Select one candidate whose status is eligible.",
    "Return only JSON with recommendedTicker, thesis and evidence.",
    "thesis must contain no digits. evidence must contain two to four of:",
    "graphLiquidity, graphBlock, routeDeviation, uniswapRouting.",
    JSON.stringify({
      goal: input.goal,
      ensPolicy: input.manifest.policy,
      candidates: input.candidates,
    }),
  ].join("\n");
}

export function riskPrompt(
  goal: string,
  candidate: OpportunityCandidate,
  manifest: EnsOrchestrationManifest,
  scout: ConsultationStep,
): string {
  return [
    "You are the Risk member of an EQLTY Hermes fleet.",
    "Check the Scout handoff against the sealed ENS policy and evidence.",
    "Return only JSON with decision, ticker, summary and checks.",
    "summary must contain no digits. checks must contain all four of:",
    "ensAllowed, deviationWithinLimit, liquidityAboveMinimum, graphEvidencePresent.",
    JSON.stringify({
      goal,
      scout: {
        ticker: scout.ticker,
        summary: scout.summary,
        responseHash: scout.responseHash,
      },
      ensPolicy: manifest.policy,
      candidate,
    }),
  ].join("\n");
}

function evidenceFact(
  key: z.infer<typeof evidenceKey>,
  candidate: OpportunityCandidate,
): ConsultationFact | undefined {
  if (key === "graphLiquidity" && candidate.graphEvidence) {
    return {
      source: "the-graph",
      label: "Indexed liquidity",
      value: `$${candidate.graphEvidence.liquidityUsd.toLocaleString("en-US")}`,
    };
  }
  if (key === "graphBlock" && candidate.graphEvidence) {
    return {
      source: "the-graph",
      label: "Indexed block",
      value: candidate.graphEvidence.blockNumber,
    };
  }
  if (key === "routeDeviation" && candidate.deviationBps !== undefined) {
    return {
      source: "uniswap",
      label: "Route deviation",
      value: `${candidate.deviationBps} bps`,
    };
  }
  if (key === "uniswapRouting" && candidate.uniswapRouting) {
    return {
      source: "uniswap",
      label: "Route",
      value: candidate.uniswapRouting,
    };
  }
  return undefined;
}

function policyFact(
  key: z.infer<typeof riskCheck>,
  candidate: OpportunityCandidate,
  manifest: EnsOrchestrationManifest,
): ConsultationFact & { passed: boolean } {
  if (key === "ensAllowed") {
    return {
      source: "ens",
      label: "Allowed ticker",
      value: candidate.ticker,
      passed: manifest.policy.allowedTickers.includes(candidate.ticker),
    };
  }
  if (key === "deviationWithinLimit") {
    return {
      source: "ens",
      label: "Deviation limit",
      value: `${candidate.deviationBps ?? "missing"} / ${manifest.policy.maxDeviationBps} bps`,
      passed:
        candidate.deviationBps !== undefined &&
        candidate.deviationBps <= manifest.policy.maxDeviationBps,
    };
  }
  if (key === "liquidityAboveMinimum") {
    return {
      source: "ens",
      label: "Liquidity threshold",
      value: `$${candidate.graphEvidence?.liquidityUsd ?? 0} / $${manifest.policy.minLiquidityUsd}`,
      passed:
        Boolean(candidate.graphEvidence) &&
        candidate.graphEvidence!.liquidityUsd >=
          manifest.policy.minLiquidityUsd,
    };
  }
  return {
    source: "the-graph",
    label: "Graph evidence",
    value: candidate.graphEvidence
      ? `block ${candidate.graphEvidence.blockNumber}`
      : "missing",
    passed: Boolean(candidate.graphEvidence),
  };
}

function unavailable(
  agent: ReadyFleetAgent,
  detail: string,
): ConsultationStep {
  return {
    role: agent.role === "risk" ? "risk" : "scout",
    agentId: agent.agentId,
    agentName: agent.name,
    status: "unavailable",
    facts: [],
    detail,
  };
}

function invalid(
  agent: ReadyFleetAgent,
  reply: string,
  detail: string,
): ConsultationStep {
  return {
    role: agent.role === "risk" ? "risk" : "scout",
    agentId: agent.agentId,
    agentName: agent.name,
    status: "invalid",
    responseHash: hashReply(reply),
    facts: [],
    detail,
  };
}

function parseReply(reply: string): unknown {
  const first = reply.indexOf("{");
  const last = reply.lastIndexOf("}");
  if (first < 0 || last <= first) return undefined;
  try {
    return JSON.parse(reply.slice(first, last + 1));
  } catch {
    return undefined;
  }
}

function hashReply(reply: string): `0x${string}` {
  return keccak256(stringToHex(reply));
}
