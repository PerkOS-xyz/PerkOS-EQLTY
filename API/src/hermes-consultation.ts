import type { ApiConfig } from "./config.js";
import type { EnsOrchestrationManifest } from "./ens-types.js";
import type { FleetAgent } from "./fleet-types.js";
import type {
  AgentConsultation,
  ConsultationStep,
} from "./consultation-types.js";
import type { OpportunityCandidate } from "./goal-types.js";
import {
  type ConsultationTaskResponse,
  type ReadyFleetAgent,
  riskPrompt,
  scoutPrompt,
  verifyRisk,
  verifyScout,
} from "./hermes-consultation-verifier.js";

type Dependencies = {
  fetchFn?: typeof fetch;
};

export class HermesConsultationService {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.fetchFn = dependencies.fetchFn ?? fetch;
  }

  async consult(input: {
    goal: string;
    candidates: OpportunityCandidate[];
    manifest: EnsOrchestrationManifest;
    agents?: FleetAgent[];
    idToken?: string;
  }): Promise<AgentConsultation> {
    const scoutAgent = readyAgent(input.agents, "scout");
    const riskAgent = readyAgent(input.agents, "risk");
    if (!input.idToken || !scoutAgent || !riskAgent) {
      return fallback(
        scoutAgent,
        riskAgent,
        "Live Scout and Risk credentials are unavailable",
      );
    }

    let scoutTask = await this.task(
      scoutAgent,
      input.idToken,
      scoutPrompt(input),
    );
    let scout = verifyScout(
      scoutAgent,
      scoutTask,
      input.candidates,
    );
    if (scout.status === "invalid") {
      scoutTask = await this.task(
        scoutAgent,
        input.idToken,
        repairPrompt("scout", scoutPrompt(input)),
      );
      scout = verifyScout(
        scoutAgent,
        scoutTask,
        input.candidates,
      );
    }
    if (scout.status !== "verified" || !scout.ticker) {
      return {
        mode: "deterministic-fallback",
        status:
          scout.status === "invalid" ? "invalid" : "unavailable",
        scout,
        risk: skipped(riskAgent, "Scout produced no verified handoff"),
      };
    }

    const candidate = input.candidates.find(
      (item) => item.ticker === scout.ticker,
    )!;
    let riskTask = await this.task(
      riskAgent,
      input.idToken,
      riskPrompt(input.goal, candidate, input.manifest, scout),
    );
    let risk = verifyRisk(
      riskAgent,
      riskTask,
      candidate,
      input.manifest,
    );
    if (risk.status === "invalid") {
      riskTask = await this.task(
        riskAgent,
        input.idToken,
        repairPrompt(
          "risk",
          riskPrompt(input.goal, candidate, input.manifest, scout),
        ),
      );
      risk = verifyRisk(
        riskAgent,
        riskTask,
        candidate,
        input.manifest,
      );
    }
    if (risk.status !== "verified") {
      return {
        mode: "deterministic-fallback",
        status:
          risk.status === "invalid" ? "invalid" : "unavailable",
        scout,
        risk,
      };
    }

    return {
      mode: "hermes-a2a",
      status: "verified",
      selectedTicker:
        risk.detail === "approved" ? candidate.ticker : undefined,
      scout,
      risk,
    };
  }

  private async task(
    agent: ReadyFleetAgent,
    idToken: string,
    prompt: string,
  ): Promise<ConsultationTaskResponse> {
    try {
      const response = await this.fetchFn(
        new URL(
          `agents/${encodeURIComponent(agent.agentId)}/task`,
          `${this.config.PERKOS_API_URL.replace(/\/$/, "")}/`,
        ),
        {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            prompt,
            timeoutMs: this.config.PERKOS_AGENT_TASK_TIMEOUT_MS,
          }),
          signal: AbortSignal.timeout(
            this.config.PERKOS_AGENT_TASK_TIMEOUT_MS + 2_000,
          ),
        },
      );
      const body =
        (await response.json().catch(() => ({}))) as ConsultationTaskResponse;
      if (!response.ok) {
        return {
          ok: false,
          detail:
            body.detail ??
            `PerkOS agent task failed with status ${response.status}`,
        };
      }
      return body;
    } catch (error) {
      return {
        ok: false,
        detail:
          error instanceof Error ? error.message : "Agent task failed",
      };
    }
  }
}

function repairPrompt(
  role: "scout" | "risk",
  originalPrompt: string,
): string {
  const shape =
    role === "scout"
      ? '{"recommendedTicker":"TICKER","thesis":"reason with the exact block and deviation numbers","evidence":["graphLiquidity","graphBlock","routeDeviation","uniswapRouting"]}'
      : '{"decision":"approve","ticker":"TICKER","summary":"reason with exact candidate and ENS limit numbers","checks":["ensAllowed","deviationWithinLimit","liquidityAboveMinimum","graphEvidencePresent"]}';
  return [
    `Your previous ${role} handoff failed schema verification.`,
    "Retry once using the same sealed evidence below.",
    "Return exactly one raw JSON object with no markdown or commentary.",
    `Required shape: ${shape}`,
    originalPrompt,
  ].join("\n");
}

function readyAgent(
  agents: FleetAgent[] | undefined,
  role: "scout" | "risk",
): ReadyFleetAgent | undefined {
  const agent = agents?.find(
    (candidate) =>
      candidate.role === role &&
      candidate.state === "ready" &&
      candidate.agentId,
  );
  return agent?.agentId
    ? (agent as ReadyFleetAgent)
    : undefined;
}

function fallback(
  scout: ReadyFleetAgent | undefined,
  risk: ReadyFleetAgent | undefined,
  detail: string,
): AgentConsultation {
  return {
    mode: "deterministic-fallback",
    status: "unavailable",
    scout: unavailable(scout, "scout", detail),
    risk: unavailable(risk, "risk", detail),
  };
}

function skipped(
  agent: ReadyFleetAgent | undefined,
  detail: string,
): ConsultationStep {
  return {
    role: "risk",
    agentId: agent?.agentId,
    agentName: agent?.name,
    status: "skipped",
    facts: [],
    detail,
  };
}

function unavailable(
  agent: ReadyFleetAgent | undefined,
  role: "scout" | "risk",
  detail: string,
): ConsultationStep {
  return {
    role,
    agentId: agent?.agentId,
    agentName: agent?.name,
    status: "unavailable",
    facts: [],
    detail,
  };
}
