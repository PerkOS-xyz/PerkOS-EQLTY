import type { ApiConfig } from "./config.js";
import type { FleetAgent, FleetRole } from "./fleet-types.js";
import { fleetRoles } from "./fleet-types.js";

type OneClawVault = {
  id: string;
  name: string;
};

type OneClawAgent = {
  id: string;
  name: string;
  is_active: boolean;
  evm_address?: string | null;
  eip712_default_policy?: "allow" | "deny";
};

type CreatedAgent = {
  agent: OneClawAgent;
  api_key?: string;
};

type SigningKey = {
  address?: string | null;
  chain: string;
  is_active: boolean;
};

type Dependencies = {
  fetchFn?: typeof fetch;
};

export type OneClawFleetSecurity = {
  status: "linked";
  vaultId: string;
  eip712Restrictions: "disabled";
  agents: Array<{
    role: FleetRole;
    perkosAgentId: string;
    oneclawAgentId: string;
    walletAddress?: string;
    reprovisionJobId: string;
  }>;
};

export class OneClawFleetProvisioner {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.fetchFn = dependencies.fetchFn ?? fetch;
  }

  get ready(): boolean {
    return Boolean(this.config.ONECLAW_PERSONAL_API_KEY);
  }

  async provision(input: {
    userId: string;
    perkosIdToken: string;
    agents: FleetAgent[];
  }): Promise<OneClawFleetSecurity> {
    const personalKey = this.config.ONECLAW_PERSONAL_API_KEY;
    if (!personalKey) {
      throw new Error(
        "EQLTY 1Claw provisioning is not configured",
      );
    }
    const managedAgents = input.agents.filter(
      (
        agent,
      ): agent is FleetAgent & { agentId: string } =>
        Boolean(agent.agentId) && agent.runtime === "Hermes",
    );
    if (
      managedAgents.length !== fleetRoles.length ||
      fleetRoles.some(
        ({ role }) =>
          !managedAgents.some((agent) => agent.role === role),
      )
    ) {
      throw new Error(
        "All four Hermes agents must be online before activating 1Claw",
      );
    }

    const accessToken = await this.userAccessToken(personalKey);
    const suffix = input.userId.replace(/^u-/, "").slice(0, 8);
    const vault = await this.findOrCreateVault(accessToken, suffix);
    const current = await this.oneclaw<{ agents: OneClawAgent[] }>(
      "/v1/agents",
      accessToken,
    );
    const byName = new Map(
      current.agents.map((agent) => [agent.name, agent]),
    );
    const linked: OneClawFleetSecurity["agents"] = [];

    for (const runtimeAgent of managedAgents) {
      const name = `EQLTY-${runtimeAgent.role}-${suffix}`;
      let agent = byName.get(name);
      let apiKey: string | undefined;
      if (!agent) {
        const created = await this.oneclaw<CreatedAgent>(
          "/v1/agents",
          accessToken,
          {
            method: "POST",
            body: JSON.stringify(
              this.agentPolicy(name, runtimeAgent, vault.id),
            ),
          },
        );
        agent = created.agent;
        apiKey = created.api_key;
      } else {
        agent = await this.oneclaw<OneClawAgent>(
          `/v1/agents/${encodeURIComponent(agent.id)}`,
          accessToken,
          {
            method: "PATCH",
            body: JSON.stringify(
              this.agentGuardrails(runtimeAgent.role, vault.id),
            ),
          },
        );
        if (runtimeAgent.oneclaw !== "linked") {
          const rotated = await this.oneclaw<{ api_key: string }>(
            `/v1/agents/${encodeURIComponent(agent.id)}/rotate-key`,
            accessToken,
            { method: "POST" },
          );
          apiKey = rotated.api_key;
        }
      }
      if (!agent) {
        throw new Error(
          `1Claw did not return the ${runtimeAgent.role} agent`,
        );
      }
      if (
        runtimeAgent.role === "trader" &&
        agent.eip712_default_policy === "deny"
      ) {
        throw new Error(
          "Disable EIP-712 restrictions for the EQLTY trader in 1Claw",
        );
      }

      const walletAddress =
        runtimeAgent.role === "trader"
          ? await this.traderWallet(agent, accessToken)
          : undefined;
      if (!apiKey && runtimeAgent.oneclaw === "linked") {
        linked.push({
          role: runtimeAgent.role,
          perkosAgentId: runtimeAgent.agentId,
          oneclawAgentId: agent.id,
          walletAddress,
          reprovisionJobId: "already-linked",
        });
        continue;
      }
      if (!apiKey?.startsWith("ocv_")) {
        throw new Error(
          `1Claw did not issue a credential for ${runtimeAgent.role}`,
        );
      }

      const perkos = await this.perkos<{
        reprovisionJobId: string;
      }>(
        `/agents/${encodeURIComponent(runtimeAgent.agentId)}/integrations/oneclaw`,
        input.perkosIdToken,
        {
          method: "POST",
          body: JSON.stringify({
            apiKey,
            oneclawAgentId: agent.id,
            vaultId: vault.id,
            apiBase: "https://api.1claw.xyz",
            skillIds: roleDefinition(runtimeAgent.role).skillIds,
          }),
        },
      );
      linked.push({
        role: runtimeAgent.role,
        perkosAgentId: runtimeAgent.agentId,
        oneclawAgentId: agent.id,
        walletAddress,
        reprovisionJobId: perkos.reprovisionJobId,
      });
    }

    return {
      status: "linked",
      vaultId: vault.id,
      eip712Restrictions: "disabled",
      agents: linked,
    };
  }

  private async findOrCreateVault(
    accessToken: string,
    suffix: string,
  ): Promise<OneClawVault> {
    const vaultName = `EQLTY Agent Fleet ${suffix}`;
    const current = await this.oneclaw<{ vaults: OneClawVault[] }>(
      "/v1/vaults",
      accessToken,
    );
    const existing = current.vaults.find(
      (candidate) => candidate.name === vaultName,
    );
    if (existing) return existing;
    return this.oneclaw<OneClawVault>("/v1/vaults", accessToken, {
      method: "POST",
      body: JSON.stringify({
        name: vaultName,
        description: `EQLTY controls for fleet ${suffix}`,
      }),
    });
  }

  private async traderWallet(
    agent: OneClawAgent,
    accessToken: string,
  ): Promise<string | undefined> {
    if (agent.evm_address) return agent.evm_address;
    const current = await this.oneclaw<{ keys?: SigningKey[] }>(
      `/v1/agents/${encodeURIComponent(agent.id)}/signing-keys`,
      accessToken,
    );
    let key = current.keys?.find(
      (candidate) =>
        candidate.chain === "ethereum" && candidate.is_active,
    );
    if (!key) {
      key = await this.oneclaw<SigningKey>(
        `/v1/agents/${encodeURIComponent(agent.id)}/signing-keys`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({ chain: "ethereum" }),
        },
      );
    }
    return key.address ?? undefined;
  }

  private agentPolicy(
    name: string,
    runtimeAgent: FleetAgent,
    vaultId: string,
  ): Record<string, unknown> {
    return {
      name,
      description:
        `EQLTY ${runtimeAgent.role} rail for ${runtimeAgent.name}`,
      auth_method: "api_key",
      token_ttl_seconds: 900,
      ...this.agentGuardrails(runtimeAgent.role, vaultId),
    };
  }

  private agentGuardrails(
    role: FleetRole,
    vaultId: string,
  ): Record<string, unknown> {
    const trader = role === "trader";
    return {
      is_active: true,
      vault_ids: [vaultId],
      intents_api_enabled: trader,
      execution_intents_enabled: false,
      shroud_enabled: false,
      intents_require_tee: false,
      execution_require_tee: false,
      tx_known_tokens_only: false,
      tx_max_per_day: trader ? 6 : 0,
      tx_allowed_chains: trader ? ["robinhood-chain"] : [],
      tx_to_allowlist: trader ? this.traderContracts() : [],
      tx_token_allowlist: trader
        ? [this.config.INPUT_TOKEN_ADDRESS]
        : [],
      tx_max_value: "0",
      tx_daily_limit: "0",
      cards_enabled: false,
      card_reveal_enabled: false,
      card_require_approval: true,
    };
  }

  private traderContracts(): string[] {
    return [
      this.config.UNISWAP_UNIVERSAL_ROUTER_ADDRESS,
      this.config.UNISWAP_PERMIT2_ADDRESS,
      ...(this.config.EQLTY_VAULT_ADDRESS
        ? [this.config.EQLTY_VAULT_ADDRESS]
        : []),
    ];
  }

  private async userAccessToken(apiKey: string): Promise<string> {
    const result = await this.oneclaw<{ access_token: string }>(
      "/v1/auth/api-key-token",
      undefined,
      {
        method: "POST",
        body: JSON.stringify({ api_key: apiKey }),
      },
    );
    if (!result.access_token) {
      throw new Error("1Claw API-key exchange failed");
    }
    return result.access_token;
  }

  private oneclaw<T>(
    path: string,
    token?: string,
    init: RequestInit = {},
  ): Promise<T> {
    return this.request<T>(
      this.config.ONECLAW_API_BASE,
      path,
      token,
      init,
      "1Claw",
    );
  }

  private perkos<T>(
    path: string,
    token: string,
    init: RequestInit,
  ): Promise<T> {
    return this.request<T>(
      this.config.PERKOS_API_URL,
      path,
      token,
      init,
      "PerkOS",
    );
  }

  private async request<T>(
    baseUrl: string,
    path: string,
    token: string | undefined,
    init: RequestInit,
    provider: string,
  ): Promise<T> {
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
        signal: AbortSignal.timeout(30_000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      const detail =
        typeof body.message === "string"
          ? body.message
          : typeof body.detail === "string"
            ? body.detail
            : `${provider} request failed (${response.status})`;
      throw new Error(detail);
    }
    return body as T;
  }
}

function roleDefinition(role: FleetRole) {
  const definition = fleetRoles.find(
    (candidate) => candidate.role === role,
  );
  if (!definition) throw new Error(`Unsupported fleet role: ${role}`);
  return definition;
}
