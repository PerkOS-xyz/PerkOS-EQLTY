import type { ApiConfig } from "./config.js";
import type { FleetAgent } from "./fleet-types.js";
import { fleetRoles } from "./fleet-types.js";

type PlatformTemplate = {
  id: string;
  name: string;
  is_active: boolean;
};

type ConnectedUser = {
  connection_id: string;
  external_subject: string;
  status: string;
  claimed_at?: string | null;
  agent_ids: string[];
  vault_ids: string[];
};

type LinkRequired = {
  status: "link_required";
  authorize_url: string;
};

type PlatformUser = {
  connection_id?: string;
  link_required?: LinkRequired;
};

type BootstrapResponse = {
  claim_url: string;
  connection_id: string;
  expires_in: number;
  summary: {
    agent_id?: string | null;
    agent_api_key?: string | null;
    vault_id?: string | null;
    signing_keys?: Array<{
      address?: string | null;
      chain: string;
    }>;
  };
};

type ClaimResponse = {
  claim_url: string;
  connection_id: string;
  expires_in: number;
};

type Dependencies = {
  fetchFn?: typeof fetch;
};

export type OneClawIntegrationStatus = {
  configured: boolean;
  status: "ready" | "degraded" | "pending";
  checkedAt: string;
  platformApi: boolean;
  reason?:
    | "not-configured"
    | "unreachable"
    | "unauthorized"
    | "provider-error";
};

export type OneClawUserConnection = {
  status: "not_connected" | "claim_pending" | "active";
  connectionId?: string;
  oneclawAgentId?: string;
  vaultId?: string;
  claimedAt?: string;
};

type ExecutionAgent = {
  role: "trader";
  perkosAgentId: string;
  oneclawAgentId: string;
  walletAddress?: string;
  reprovisionJobId: string;
};

export type OneClawFleetSecurity =
  | {
      status: "link_required";
      authorizeUrl: string;
    }
  | {
      status: "claim_required";
      connectionId: string;
      claimUrl: string;
      expiresIn: number;
      vaultId: string;
      executionAgent: ExecutionAgent;
      eip712Restrictions: "disabled";
    }
  | {
      status: "linked";
      connectionId: string;
      vaultId?: string;
      executionAgent: Omit<ExecutionAgent, "reprovisionJobId">;
      eip712Restrictions: "disabled";
    };

export class OneClawFleetProvisioner {
  private readonly fetchFn: typeof fetch;
  private healthCache?: {
    expiresAt: number;
    value: OneClawIntegrationStatus;
  };

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.fetchFn = dependencies.fetchFn ?? fetch;
  }

  get ready(): boolean {
    return Boolean(
      this.config.ONECLAW_PLATFORM_APP_ID &&
        this.config.ONECLAW_PLATFORM_API_KEY,
    );
  }

  async status(): Promise<OneClawIntegrationStatus> {
    const checkedAt = new Date().toISOString();
    if (!this.ready) {
      return {
        configured: false,
        status: "pending",
        checkedAt,
        platformApi: false,
        reason: "not-configured",
      };
    }
    if (this.healthCache && this.healthCache.expiresAt > Date.now()) {
      return this.healthCache.value;
    }

    let value: OneClawIntegrationStatus;
    try {
      const appId = this.config.ONECLAW_PLATFORM_APP_ID!;
      const result = await this.platformResponse<unknown>(
        `/v1/platform/apps/${encodeURIComponent(appId)}/users`,
        { signal: AbortSignal.timeout(5_000) },
      );
      value = result.ok
        ? {
            configured: true,
            status: "ready",
            checkedAt,
            platformApi: true,
          }
        : {
            configured: true,
            status: "degraded",
            checkedAt,
            platformApi: false,
            reason:
              result.status === 401 || result.status === 403
                ? "unauthorized"
                : "provider-error",
          };
    } catch {
      value = {
        configured: true,
        status: "degraded",
        checkedAt,
        platformApi: false,
        reason: "unreachable",
      };
    }
    this.healthCache = {
      expiresAt: Date.now() + 30_000,
      value,
    };
    return value;
  }

  async authorization(
    externalSubject: string,
  ): Promise<OneClawUserConnection> {
    this.assertReady();
    const connected = await this.connectedUser(externalSubject);
    if (!connected) return { status: "not_connected" };

    const connection = {
      connectionId: connected.connection_id,
      oneclawAgentId: connected.agent_ids[0],
      vaultId: connected.vault_ids[0],
    };
    if (
      !connected.claimed_at ||
      !connection.oneclawAgentId ||
      !connection.vaultId
    ) {
      return { status: "claim_pending", ...connection };
    }
    return {
      status: "active",
      ...connection,
      claimedAt: connected.claimed_at,
    };
  }

  async provision(input: {
    userId: string;
    externalSubject: string;
    email: string;
    perkosIdToken: string;
    agents: FleetAgent[];
  }): Promise<OneClawFleetSecurity> {
    this.assertReady();
    const trader = this.executionAgent(input.agents);
    const connected = await this.connectedUser(input.externalSubject);

    if (connected?.agent_ids.length) {
      if (trader.oneclaw !== "linked") {
        throw new Error(
          "The 1Claw execution agent exists but its PerkOS credential is unavailable",
        );
      }
      if (connected.claimed_at) {
        return this.linkedResult(connected, trader);
      }
      const claim = await this.platform<ClaimResponse>(
        `/v1/platform/connections/${encodeURIComponent(connected.connection_id)}/reissue-claim`,
        {
          method: "POST",
          body: "{}",
        },
      );
      return {
        status: "claim_required",
        connectionId: connected.connection_id,
        claimUrl: claim.claim_url,
        expiresIn: claim.expires_in,
        vaultId: connected.vault_ids[0] ?? "",
        executionAgent: {
          role: "trader",
          perkosAgentId: trader.agentId,
          oneclawAgentId: connected.agent_ids[0]!,
          reprovisionJobId: "already-linked",
        },
        eip712Restrictions: "disabled",
      };
    }

    const connectionId =
      connected?.connection_id ?? (await this.upsertUser(input));
    if (typeof connectionId !== "string") {
      return connectionId;
    }

    const templateId =
      this.config.ONECLAW_PLATFORM_TEMPLATE_ID ??
      (await this.ensureTemplate());
    const bootstrap = await this.platform<BootstrapResponse>(
      `/v1/platform/connections/${encodeURIComponent(connectionId)}/bootstrap`,
      {
        method: "POST",
        body: JSON.stringify({
          template_id: templateId,
          return_to: this.returnUrl(),
        }),
      },
    );
    const agentId = bootstrap.summary.agent_id;
    const apiKey = bootstrap.summary.agent_api_key;
    const vaultId = bootstrap.summary.vault_id;
    if (
      !agentId ||
      !apiKey?.startsWith("ocv_") ||
      !vaultId
    ) {
      throw new Error(
        "1Claw bootstrap did not return the execution credential",
      );
    }
    const walletAddress = bootstrap.summary.signing_keys?.find(
      (key) => key.chain === "ethereum",
    )?.address;
    const perkos = await this.perkos<{ reprovisionJobId: string }>(
      `/agents/${encodeURIComponent(trader.agentId)}/integrations/oneclaw`,
      input.perkosIdToken,
      {
        method: "POST",
        body: JSON.stringify({
          apiKey,
          oneclawAgentId: agentId,
          vaultId,
          apiBase: this.config.ONECLAW_API_BASE,
          skillIds: ["eqlty-uniswap", "eqlty-ens"],
        }),
      },
    );

    return {
      status: "claim_required",
      connectionId: bootstrap.connection_id,
      claimUrl: bootstrap.claim_url,
      expiresIn: bootstrap.expires_in,
      vaultId,
      executionAgent: {
        role: "trader",
        perkosAgentId: trader.agentId,
        oneclawAgentId: agentId,
        walletAddress: walletAddress ?? undefined,
        reprovisionJobId: perkos.reprovisionJobId,
      },
      eip712Restrictions: "disabled",
    };
  }

  private async upsertUser(input: {
    userId: string;
    externalSubject: string;
    email: string;
  }): Promise<string | OneClawFleetSecurity> {
    const result = await this.platformResponse<PlatformUser>(
      "/v1/platform/users/upsert",
      {
        method: "POST",
        body: JSON.stringify({
          email: input.email,
          display_name: `EQLTY ${input.userId.replace(/^u-/, "").slice(0, 8)}`,
          external_subject: input.externalSubject,
          return_to: this.returnUrl(),
        }),
      },
    );
    const link = result.body.link_required;
    if (result.status === 409 && link?.authorize_url) {
      return {
        status: "link_required",
        authorizeUrl: link.authorize_url,
      };
    }
    if (!result.ok || !result.body.connection_id) {
      throw new Error(
        this.errorMessage(result.body, "1Claw user provisioning failed"),
      );
    }
    return result.body.connection_id;
  }

  private async connectedUser(
    externalSubject: string,
  ): Promise<ConnectedUser | undefined> {
    const appId = this.config.ONECLAW_PLATFORM_APP_ID!;
    const response = await this.platform<
      ConnectedUser[] | { users: ConnectedUser[] }
    >(
      `/v1/platform/apps/${encodeURIComponent(appId)}/users`,
    );
    const users = Array.isArray(response) ? response : response.users;
    if (!Array.isArray(users)) {
      throw new Error("1Claw returned an invalid connected user list");
    }
    return users.find(
      (user) => user.external_subject === externalSubject,
    );
  }

  private async ensureTemplate(): Promise<string> {
    const appId = this.config.ONECLAW_PLATFORM_APP_ID!;
    const path =
      `/v1/platform/apps/${encodeURIComponent(appId)}/templates`;
    const templates = await this.platform<PlatformTemplate[]>(path);
    const current = templates.find(
      (template) =>
        template.name === "EQLTY execution rail" &&
        template.is_active,
    );
    if (current) return current.id;

    const created = await this.platform<PlatformTemplate>(path, {
      method: "POST",
      body: JSON.stringify({
        name: "EQLTY execution rail",
        description: "User-owned execution controls for EQLTY",
        spec: {
          vault: {
            name: "EQLTY Trading Vault",
            description: "Private controls for the user's execution agent",
          },
          agents: [
            {
              name: "EQLTY Trader",
              description: "Executes approved stock-token swaps",
              intents: { enabled: true },
              shroud_enabled: false,
            },
          ],
          signing_keys: [{ chain: "ethereum" }],
          policies: [
            {
              principal_ref: "agents.primary",
              vault_ref: "vault",
              paths: ["config/**"],
              permissions: ["read"],
              conditions: {},
            },
          ],
        },
      }),
    });
    return created.id;
  }

  private executionAgent(
    agents: FleetAgent[],
  ): FleetAgent & { role: "trader"; agentId: string } {
    const managed = agents.filter(
      (agent) =>
        agent.agentId &&
        agent.runtime === "Hermes" &&
        agent.state === "ready",
    );
    if (
      managed.length !== fleetRoles.length ||
      fleetRoles.some(
        ({ role }) =>
          !managed.some((agent) => agent.role === role),
      )
    ) {
      throw new Error(
        "All four private agents must be online before connecting 1Claw",
      );
    }
    const trader = managed.find(
      (
        agent,
      ): agent is FleetAgent & {
        role: "trader";
        agentId: string;
      } => agent.role === "trader" && Boolean(agent.agentId),
    );
    if (!trader) {
      throw new Error("The Hermes trader is unavailable");
    }
    return trader;
  }

  private linkedResult(
    connected: ConnectedUser,
    trader: FleetAgent & { role: "trader"; agentId: string },
  ): OneClawFleetSecurity {
    return {
      status: "linked",
      connectionId: connected.connection_id,
      vaultId: connected.vault_ids[0],
      executionAgent: {
        role: "trader",
        perkosAgentId: trader.agentId,
        oneclawAgentId: connected.agent_ids[0]!,
      },
      eip712Restrictions: "disabled",
    };
  }

  private returnUrl(): string {
    return (
      this.config.ONECLAW_PLATFORM_RETURN_URL ??
      `${this.config.APP_ORIGIN.replace(/\/$/, "")}/?oneclaw=claimed`
    );
  }

  private assertReady(): void {
    if (!this.ready) {
      throw new Error("EQLTY 1Claw Platform API is not configured");
    }
  }

  private async platform<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const result = await this.platformResponse<T>(path, init);
    if (!result.ok) {
      throw new Error(
        this.errorMessage(
          result.body,
          `1Claw request failed with status ${result.status}`,
        ),
      );
    }
    return result.body;
  }

  private platformResponse<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ body: T; ok: boolean; status: number }> {
    return this.request<T>(
      this.config.ONECLAW_API_BASE,
      path,
      this.config.ONECLAW_PLATFORM_API_KEY,
      init,
    );
  }

  private async perkos<T>(
    path: string,
    token: string,
    init: RequestInit,
  ): Promise<T> {
    const result = await this.request<T>(
      this.config.PERKOS_API_URL,
      path,
      token,
      init,
    );
    if (!result.ok) {
      throw new Error(
        this.errorMessage(
          result.body,
          `PerkOS request failed with status ${result.status}`,
        ),
      );
    }
    return result.body;
  }

  private async request<T>(
    baseUrl: string,
    path: string,
    token: string | undefined,
    init: RequestInit,
  ): Promise<{ body: T; ok: boolean; status: number }> {
    const response = await this.fetchFn(
      new URL(
        path.replace(/^\//, ""),
        `${baseUrl.replace(/\/$/, "")}/`,
      ),
      {
        ...init,
        headers: {
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(30_000),
      },
    );
    return {
      body: (await response.json().catch(() => ({}))) as T,
      ok: response.ok,
      status: response.status,
    };
  }

  private errorMessage(body: unknown, fallback: string): string {
    if (!body || typeof body !== "object") return fallback;
    if ("detail" in body && typeof body.detail === "string") {
      return body.detail;
    }
    if ("message" in body && typeof body.message === "string") {
      return body.message;
    }
    return fallback;
  }
}
