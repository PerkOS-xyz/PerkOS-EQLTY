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
const traderCheck = z.enum([
  "riskApproved",
  "uniswapRoutePresent",
  "requestIdPresent",
  "ensTickerAllowed",
]);
const auditorCheck = z.enum([
  "ensManifestPresent",
  "scoutVerified",
  "riskVerified",
  "traderVerified",
]);
const evidenceReasoning = z
  .string()
  .trim()
  .min(20)
  .max(500)
  .refine((value) => /\d/.test(value));
const scoutReply = z
  .object({
    recommendedTicker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/),
    thesis: evidenceReasoning,
    evidence: z
      .array(evidenceKey)
      .min(2)
      .max(4)
      .refine((items) => new Set(items).size === items.length),
  });
const riskReply = z
  .object({
    decision: z.enum(["approve", "reject"]),
    ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/),
    summary: evidenceReasoning,
    checks: z
      .array(riskCheck)
      .length(4)
      .refine((items) => new Set(items).size === items.length),
  });
const traderReply = z.object({
  decision: z.enum(["prepare", "reject"]),
  ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/),
  summary: z.string().trim().min(20).max(500),
  checks: z
    .array(traderCheck)
    .length(4)
    .refine((items) => new Set(items).size === items.length),
});
const auditorReply = z.object({
  decision: z.enum(["seal", "reject"]),
  ticker: z.string().regex(/^[A-Z][A-Z0-9.-]{0,11}$/),
  summary: evidenceReasoning,
  checks: z
    .array(auditorCheck)
    .length(4)
    .refine((items) => new Set(items).size === items.length),
});

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
  if (!citesSealedMarketValues(parsed.data.thesis, candidate)) {
    return invalid(
      agent,
      task.reply,
      "Scout reasoning did not cite the sealed block and route deviation",
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

export function verifyTrader(
  agent: ReadyFleetAgent,
  task: ConsultationTaskResponse,
  candidate: OpportunityCandidate,
  manifest: EnsOrchestrationManifest,
  risk: ConsultationStep,
): ConsultationStep {
  if (!task.ok || !task.reply) {
    return unavailable(agent, task.detail ?? "Trader did not answer");
  }
  const parsed = traderReply.safeParse(parseReply(task.reply));
  if (!parsed.success || parsed.data.ticker !== candidate.ticker) {
    return invalid(agent, task.reply, "Trader returned an invalid handoff");
  }
  const checks = parsed.data.checks.map((key) =>
    traderFact(key, candidate, manifest, risk),
  );
  const eligible = checks.every((check) => check.passed);
  if (
    (parsed.data.decision === "prepare" && !eligible) ||
    (parsed.data.decision === "reject" && eligible)
  ) {
    return invalid(
      agent,
      task.reply,
      "Trader decision conflicts with the sealed route gates",
    );
  }
  if (
    eligible &&
    (!candidate.uniswapRequestId ||
      !candidate.uniswapRouting ||
      !parsed.data.summary.includes(candidate.uniswapRequestId) ||
      !parsed.data.summary.includes(candidate.uniswapRouting))
  ) {
    return invalid(
      agent,
      task.reply,
      "Trader reasoning did not cite the sealed Uniswap route and request",
    );
  }
  return {
    role: "trader",
    agentId: agent.agentId,
    agentName: agent.name,
    status: "verified",
    ticker: candidate.ticker,
    summary: parsed.data.summary,
    responseHash: hashReply(task.reply),
    facts: checks.map(({ passed: _passed, ...fact }) => fact),
    detail: parsed.data.decision === "prepare" ? "prepared" : "rejected",
  };
}

export function verifyAuditor(
  agent: ReadyFleetAgent,
  task: ConsultationTaskResponse,
  candidate: OpportunityCandidate,
  manifest: EnsOrchestrationManifest,
  manifestHash: `0x${string}`,
  scout: ConsultationStep,
  risk: ConsultationStep,
  trader: ConsultationStep,
): ConsultationStep {
  if (!task.ok || !task.reply) {
    return unavailable(agent, task.detail ?? "Auditor did not answer");
  }
  const parsed = auditorReply.safeParse(parseReply(task.reply));
  if (!parsed.success || parsed.data.ticker !== candidate.ticker) {
    return invalid(agent, task.reply, "Auditor returned an invalid handoff");
  }
  const checks = parsed.data.checks.map((key) =>
    auditorFact(key, manifestHash, scout, risk, trader),
  );
  const sealable = checks.every((check) => check.passed);
  if (
    (parsed.data.decision === "seal" && !sealable) ||
    (parsed.data.decision === "reject" && sealable)
  ) {
    return invalid(
      agent,
      task.reply,
      "Auditor decision conflicts with the verified handoff chain",
    );
  }
  if (
    sealable &&
    (!parsed.data.summary.includes(String(manifest.version)) ||
      !parsed.data.summary.includes(candidate.ticker))
  ) {
    return invalid(
      agent,
      task.reply,
      "Auditor reasoning did not cite the ticker and ENS policy version",
    );
  }
  return {
    role: "auditor",
    agentId: agent.agentId,
    agentName: agent.name,
    status: "verified",
    ticker: candidate.ticker,
    summary: parsed.data.summary,
    responseHash: hashReply(task.reply),
    facts: checks.map(({ passed: _passed, ...fact }) => fact),
    detail: parsed.data.decision === "seal" ? "sealed" : "rejected",
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
    'Use exactly this shape: {"recommendedTicker":"TICKER","thesis":"reason with exact numbers","evidence":["graphLiquidity","graphBlock","routeDeviation","uniswapRouting"]}.',
    "In thesis, cite the selected candidate's exact graph blockNumber and exact deviationBps without rounding.",
    "evidence must contain two to four of:",
    "graphLiquidity, graphBlock, routeDeviation, uniswapRouting.",
    JSON.stringify({
      goal: input.goal,
      ensPolicy: input.manifest.policy,
      candidates: input.candidates.map((candidate) => ({
        ticker: candidate.ticker,
        status: candidate.status,
        deviationBps: candidate.deviationBps,
        uniswapRouting: candidate.uniswapRouting,
        graphBlockNumber: candidate.graphEvidence?.blockNumber,
        graphLiquidityUsd: candidate.graphEvidence?.liquidityUsd,
      })),
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
    'Use exactly this shape: {"decision":"approve","ticker":"TICKER","summary":"reason with exact numbers","checks":["ensAllowed","deviationWithinLimit","liquidityAboveMinimum","graphEvidencePresent"]}.',
    "In summary, cite exact candidate and ENS limit values from the sealed JSON.",
    "checks must contain all four of:",
    "ensAllowed, deviationWithinLimit, liquidityAboveMinimum, graphEvidencePresent.",
    JSON.stringify({
      goal,
      scout: {
        ticker: scout.ticker,
        summary: scout.summary,
        responseHash: scout.responseHash,
      },
      ensPolicy: {
        allowedTickers: manifest.policy.allowedTickers,
        maxDeviationBps: manifest.policy.maxDeviationBps,
        minLiquidityUsd: manifest.policy.minLiquidityUsd,
      },
      candidate: {
        ticker: candidate.ticker,
        status: candidate.status,
        deviationBps: candidate.deviationBps,
        graphBlockNumber: candidate.graphEvidence?.blockNumber,
        graphLiquidityUsd: candidate.graphEvidence?.liquidityUsd,
      },
    }),
  ].join("\n");
}

export function traderPrompt(
  goal: string,
  candidate: OpportunityCandidate,
  manifest: EnsOrchestrationManifest,
  risk: ConsultationStep,
): string {
  return [
    "You are the Trader in an EQLTY Hermes fleet.",
    "Prepare, but do not submit, the route approved by Risk.",
    "Reason only over the sealed JSON. Never invent a route or request id.",
    "Return only JSON with decision, ticker, summary and checks.",
    'Use exactly this shape: {"decision":"prepare","ticker":"TICKER","summary":"reason citing the exact route and request id","checks":["riskApproved","uniswapRoutePresent","requestIdPresent","ensTickerAllowed"]}.',
    "In summary, cite the exact uniswapRouting and uniswapRequestId.",
    "checks must contain all four of:",
    "riskApproved, uniswapRoutePresent, requestIdPresent, ensTickerAllowed.",
    JSON.stringify({
      goal,
      risk: {
        ticker: risk.ticker,
        decision: risk.detail,
        responseHash: risk.responseHash,
      },
      ensPolicy: {
        allowedTickers: manifest.policy.allowedTickers,
      },
      candidate: {
        ticker: candidate.ticker,
        status: candidate.status,
        uniswapRouting: candidate.uniswapRouting,
        uniswapRequestId: candidate.uniswapRequestId,
      },
    }),
  ].join("\n");
}

export function auditorPrompt(
  goal: string,
  candidate: OpportunityCandidate,
  manifest: EnsOrchestrationManifest,
  manifestHash: `0x${string}`,
  scout: ConsultationStep,
  risk: ConsultationStep,
  trader: ConsultationStep,
): string {
  return [
    "You are the Auditor in an EQLTY Hermes fleet.",
    "Verify the complete handoff chain without changing its decision.",
    "Return only JSON with decision, ticker, summary and checks.",
    'Use exactly this shape: {"decision":"seal","ticker":"TICKER","summary":"reason citing ticker and ENS policy version","checks":["ensManifestPresent","scoutVerified","riskVerified","traderVerified"]}.',
    "In summary, cite the exact ticker and ENS policy version.",
    "checks must contain all four of:",
    "ensManifestPresent, scoutVerified, riskVerified, traderVerified.",
    JSON.stringify({
      goal,
      ticker: candidate.ticker,
      ensPolicyVersion: manifest.version,
      ensManifestHash: manifestHash,
      handoffs: {
        scout: {
          status: scout.status,
          responseHash: scout.responseHash,
        },
        risk: {
          status: risk.status,
          responseHash: risk.responseHash,
        },
        trader: {
          status: trader.status,
          responseHash: trader.responseHash,
        },
      },
    }),
  ].join("\n");
}

function evidenceFact(
  key: z.infer<typeof evidenceKey>,
  candidate: OpportunityCandidate,
): ConsultationFact | undefined {
  if (key === "graphLiquidity" && candidate.graphEvidence) {
    return {
      source: evidenceFactSource(candidate),
      label: "Onchain liquidity",
      value: `$${candidate.graphEvidence.liquidityUsd.toLocaleString("en-US")}`,
    };
  }
  if (key === "graphBlock" && candidate.graphEvidence) {
    return {
      source: evidenceFactSource(candidate),
      label: "Onchain block",
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
    source: evidenceFactSource(candidate),
    label: "Onchain evidence",
    value: candidate.graphEvidence
      ? `block ${candidate.graphEvidence.blockNumber}`
      : "missing",
    passed: Boolean(candidate.graphEvidence),
  };
}

function evidenceFactSource(
  candidate: OpportunityCandidate,
): "the-graph" | "onchain" {
  return candidate.graphEvidence?.source === "the-graph-substreams"
    || !candidate.graphEvidence?.source
    ? "the-graph"
    : "onchain";
}

function traderFact(
  key: z.infer<typeof traderCheck>,
  candidate: OpportunityCandidate,
  manifest: EnsOrchestrationManifest,
  risk: ConsultationStep,
): ConsultationFact & { passed: boolean } {
  if (key === "riskApproved") {
    return {
      source: "ens",
      label: "Risk handoff",
      value: risk.detail ?? "missing",
      passed: risk.status === "verified" && risk.detail === "approved",
    };
  }
  if (key === "uniswapRoutePresent") {
    return {
      source: "uniswap",
      label: "Route",
      value: candidate.uniswapRouting ?? "missing",
      passed: Boolean(candidate.uniswapRouting),
    };
  }
  if (key === "requestIdPresent") {
    return {
      source: "uniswap",
      label: "Request",
      value: candidate.uniswapRequestId ?? "missing",
      passed: Boolean(candidate.uniswapRequestId),
    };
  }
  return {
    source: "ens",
    label: "Ticker permission",
    value: candidate.ticker,
    passed: manifest.policy.allowedTickers.includes(candidate.ticker),
  };
}

function auditorFact(
  key: z.infer<typeof auditorCheck>,
  manifestHash: `0x${string}`,
  scout: ConsultationStep,
  risk: ConsultationStep,
  trader: ConsultationStep,
): ConsultationFact & { passed: boolean } {
  if (key === "ensManifestPresent") {
    return {
      source: "ens",
      label: "Manifest",
      value: manifestHash,
      passed: /^0x[0-9a-fA-F]{64}$/.test(manifestHash),
    };
  }
  const step = { scout, risk, trader }[key.replace("Verified", "") as
    | "scout"
    | "risk"
    | "trader"];
  return {
    source:
      step.role === "trader"
        ? "uniswap"
        : step.role === "scout"
          ? "the-graph"
          : "ens",
    label: `${step.role} handoff`,
    value: step.responseHash ?? "missing",
    passed: step.status === "verified" && Boolean(step.responseHash),
  };
}

function unavailable(
  agent: ReadyFleetAgent,
  detail: string,
): ConsultationStep {
  return {
    role: agent.role,
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
    role: agent.role,
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
    const parsed = JSON.parse(reply.slice(first, last + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return parsed;
    }
    const record = parsed as Record<string, unknown>;
    return record.result ?? record.handoff ?? record.response ?? parsed;
  } catch {
    return undefined;
  }
}

function citesSealedMarketValues(
  thesis: string,
  candidate: OpportunityCandidate,
): boolean {
  return Boolean(
    candidate.graphEvidence?.blockNumber &&
      candidate.deviationBps !== undefined &&
      thesis.includes(candidate.graphEvidence.blockNumber) &&
      thesis.includes(String(candidate.deviationBps)),
  );
}

function hashReply(reply: string): `0x${string}` {
  return keccak256(stringToHex(reply));
}
