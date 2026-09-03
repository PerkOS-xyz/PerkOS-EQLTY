import type { ApiConfig } from "./config.js";
import type {
  FleetAgent,
  FleetRole,
  FleetRoleDefinition,
  FleetRuntime,
} from "./fleet-types.js";
import { fleetRoles } from "./fleet-types.js";
import type { EvmAddress } from "./market-types.js";

type ApiAgent = {
  id: string;
  name: string;
  runtime: "Hermes" | "OpenClaw";
  status: "provisioning" | "ready" | "failed" | "unknown";
  integrations?: {
    oneclaw?: {
      configured?: boolean;
    };
  };
};

type LaunchResponse = {
  launchId: string;
  result?: {
    status?: string;
    jobId?: string | null;
    agent?: ApiAgent;
  };
};

type Dependencies = {
  fetchFn?: typeof fetch;
};

export class PerkosApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

export class PerkosFleetService {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.fetchFn = dependencies.fetchFn ?? fetch;
  }

  async activate(input: {
    owner: EvmAddress;
    userId: string;
    idToken?: string;
    linkedAgentIds?: Set<string>;
  }): Promise<FleetRuntime> {
    const planned = fleetRoles.map((definition) =>
      plannedAgent(input.userId, definition),
    );
    if (this.config.PERKOS_FLEET_MODE === "disabled") {
      return {
        provider: "perkos",
        mode: "disabled",
        status: "disabled",
        agents: planned,
      };
    }
    if (this.config.PERKOS_FLEET_MODE === "preview") {
      return {
        provider: "perkos",
        mode: "preview",
        status: "planned",
        agents: planned,
      };
    }
    if (!input.idToken) {
      throw new Error(
        "PerkOS wallet authentication is required for live Hermes agents",
      );
    }
    const idToken = input.idToken;

    const imageTag =
      this.config.PERKOS_HERMES_IMAGE_TAG ??
      (await this.latestHermesImage());
    const existing = await this.request<{ agents: ApiAgent[] }>(
      "/agents",
      idToken,
    );
    const byName = new Map(
      existing.agents.map((agent) => [agent.name, agent]),
    );
    const agents = await Promise.all(
      fleetRoles.map(async (definition) => {
        const plan = plannedAgent(input.userId, definition);
        const current = byName.get(plan.name);
        if (current) {
          return this.activateExisting(
            plan,
            current,
            idToken,
            input.linkedAgentIds,
          );
        }
        return this.launchAgent(
          plan,
          definition,
          input.owner,
          input.userId,
          imageTag,
          idToken,
        );
      }),
    );

    return {
      provider: "perkos",
      mode: "live",
      status: fleetStatus(agents),
      imageTag,
      agents,
    };
  }

  private async activateExisting(
    plan: FleetAgent,
    current: ApiAgent,
    idToken: string,
    linkedAgentIds?: Set<string>,
  ): Promise<FleetAgent> {
    const oneclaw =
      current.integrations?.oneclaw?.configured ||
      linkedAgentIds?.has(current.id)
        ? "linked"
        : "pending-agent-credential";
    if (current.runtime !== "Hermes") {
      return {
        ...plan,
        agentId: current.id,
        state: "failed",
        oneclaw,
      };
    }
    if (current.status !== "ready") {
      return {
        ...plan,
        agentId: current.id,
        state: current.status === "failed" ? "failed" : "provisioning",
        oneclaw,
      };
    }

    const awake = await this.request<{ state?: string; woke?: boolean }>(
      `/agents/${encodeURIComponent(current.id)}/ensure-awake`,
      idToken,
      {
        method: "POST",
        body: "{}",
      },
      90_000,
    );
    return {
      ...plan,
      agentId: current.id,
      state:
        awake.woke || awake.state === "waking" ? "waking" : "ready",
      oneclaw,
    };
  }

  private async launchAgent(
    plan: FleetAgent,
    definition: FleetRoleDefinition,
    owner: EvmAddress,
    userId: string,
    imageTag: string,
    idToken: string,
  ): Promise<FleetAgent> {
    const launch = await this.request<LaunchResponse>(
      "/agents/launch",
      idToken,
      {
        method: "POST",
        body: JSON.stringify({
          walletAddress: owner,
          runtime: "Hermes",
          name: plan.name,
          plugins: definition.plugins,
          skills: definition.skillIds,
          deployMode: "perkos-managed",
          imageTag,
          soul: roleSoul(definition.role, userId),
          disabledTools: ["code-execution"],
        }),
      },
    );
    return {
      ...plan,
      agentId: launch.result?.agent?.id,
      state:
        launch.result?.status === "ready" ? "ready" : "provisioning",
      jobId: launch.result?.jobId ?? launch.launchId,
    };
  }

  private async latestHermesImage(): Promise<string> {
    const response = await this.request<{
      runtimes: Array<{
        runtime: string;
        primaryTag?: string;
        channel?: string;
      }>;
    }>("/runtimes");
    const image = response.runtimes.find(
      (candidate) =>
        candidate.runtime === "Hermes" &&
        candidate.channel === "public" &&
        candidate.primaryTag,
    );
    if (!image?.primaryTag) {
      throw new Error("PerkOS has no public Hermes runtime image");
    }
    return image.primaryTag;
  }

  private async request<T>(
    path: string,
    idToken?: string,
    init: RequestInit = {},
    timeoutMs = 20_000,
  ): Promise<T> {
    const response = await this.fetchFn(
      new URL(
        path.replace(/^\//, ""),
        `${this.config.PERKOS_API_URL.replace(/\/$/, "")}/`,
      ),
      {
        ...init,
        headers: {
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const nestedError =
        isRecord(body) && isRecord(body.error) ? body.error : undefined;
      const detail =
        isRecord(body) && typeof body.message === "string"
          ? body.message
          : isRecord(body) && typeof body.error === "string"
            ? body.error
            : nestedError && typeof nestedError.message === "string"
              ? nestedError.message
            : `PerkOS API request failed with status ${response.status}`;
      const code =
        nestedError && typeof nestedError.code === "string"
          ? nestedError.code
          : undefined;
      throw new PerkosApiError(response.status, code, detail);
    }
    return body as T;
  }
}

function plannedAgent(
  userId: string,
  definition: FleetRoleDefinition,
): FleetAgent {
  const suffix = userId.replace(/^u-/, "").slice(0, 8);
  return {
    role: definition.role,
    name: `eqlty-${definition.role}-${suffix}`,
    runtime: "Hermes",
    state: "planned",
    plugins: definition.plugins,
    oneclaw: "pending-agent-credential",
  };
}

function roleSoul(role: FleetRole, userId: string): string {
  const duty: Record<FleetRole, string> = {
    scout:
      "Discover stock tokens and collect Uniswap and The Graph evidence.",
    risk:
      "Evaluate freshness, liquidity and policy before approving a candidate.",
    trader:
      "Request guarded Uniswap quotes and execute only after every gate passes.",
    auditor:
      "Reconcile ENS policy, indexed evidence and the transaction receipt.",
  };
  return [
    `# EQLTY ${role}`,
    "",
    `You are the ${role} member of the EQLTY Hermes fleet for ${userId}.`,
    "",
    duty[role],
    "",
    "ENS is the source of truth for behavior. 1Claw controls secrets and",
    "spending. Never broaden either policy or claim evidence a tool did not",
    "return. Produce a structured handoff for the next fleet role.",
  ].join("\n");
}

function fleetStatus(agents: FleetAgent[]): FleetRuntime["status"] {
  if (agents.every((agent) => agent.state === "ready")) return "ready";
  if (agents.some((agent) => agent.state === "failed")) return "partial";
  return "provisioning";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
