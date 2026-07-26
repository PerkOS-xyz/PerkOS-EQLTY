import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import type { FleetAgent, FleetRole } from "./fleet-types.js";
import { OneClawFleetProvisioner } from "./oneclaw-fleet.js";

const appId = "b79615cd-e233-46da-9ccc-ffb031bbfc49";
const connectionId = "22222222-2222-4222-8222-222222222222";
const templateId = "33333333-3333-4333-8333-333333333333";
const vaultId = "44444444-4444-4444-8444-444444444444";
const agentId = "55555555-5555-4555-8555-555555555555";
const roles: FleetRole[] = [
  "scout",
  "risk",
  "trader",
  "auditor",
];

describe("1Claw Platform API provisioning", () => {
  it("bootstraps a user-owned execution agent and hides its credential", async () => {
    const requests: Array<{
      body?: Record<string, unknown>;
      method: string;
      url: string;
    }> = [];
    const fetchFn = vi.fn(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined;
        requests.push({ body, method, url });

        if (url.endsWith(`/v1/platform/apps/${appId}/users`)) {
          return json({ users: [] });
        }
        if (url.endsWith("/v1/platform/users/upsert")) {
          return json(
            {
              connection_id: connectionId,
              email: "julio@example.com",
              is_new: true,
              user_handle: "66666666-6666-4666-8666-666666666666",
            },
            201,
          );
        }
        if (url.endsWith(`/v1/platform/apps/${appId}/templates`)) {
          if (method === "GET") return json([]);
          return json(
            {
              id: templateId,
              name: "EQLTY execution rail",
              is_active: true,
            },
            201,
          );
        }
        if (
          url.endsWith(
            `/v1/platform/connections/${connectionId}/bootstrap`,
          )
        ) {
          return json(
            {
              claim_url:
                "https://1claw.xyz/connect/eqlty/claim/ct_test",
              claim_token: "ct_test",
              connection_id: connectionId,
              expires_in: 600,
              summary: {
                agent_id: agentId,
                agent_api_key: "ocv_one-time-secret",
                vault_id: vaultId,
                signing_keys: [
                  {
                    chain: "ethereum",
                    address:
                      "0x1111111111111111111111111111111111111111",
                  },
                ],
              },
            },
            201,
          );
        }
        if (url.includes("/integrations/oneclaw")) {
          return json({ reprovisionJobId: "job-trader" }, 202);
        }
        return json({ detail: "unexpected request" }, 500);
      },
    );

    const result = await provisioner(fetchFn).provision({
      userId: "u-1c762eaa00000000",
      externalSubject:
        "eip155:4663:0x1234567890abcdef1234567890abcdef12345678",
      email: "julio@example.com",
      perkosIdToken: "firebase-id-token",
      agents: testAgents(),
    });

    expect(result).toMatchObject({
      status: "claim_required",
      connectionId,
      vaultId,
      eip712Restrictions: "disabled",
      executionAgent: {
        role: "trader",
        perkosAgentId: "perkos-trader",
        oneclawAgentId: agentId,
        walletAddress:
          "0x1111111111111111111111111111111111111111",
      },
    });
    expect(JSON.stringify(result)).not.toContain("ocv_");

    const upsert = requests.find((request) =>
      request.url.endsWith("/v1/platform/users/upsert"),
    );
    expect(upsert?.body).toMatchObject({
      email: "julio@example.com",
      external_subject:
        "eip155:4663:0x1234567890abcdef1234567890abcdef12345678",
    });
    const template = requests.find(
      (request) =>
        request.url.endsWith(`/v1/platform/apps/${appId}/templates`) &&
        request.method === "POST",
    );
    expect(template?.body).toMatchObject({
      name: "EQLTY execution rail",
      spec: {
        agents: [
          {
            name: "EQLTY Trader",
            intents: { enabled: true },
          },
        ],
        signing_keys: [{ chain: "ethereum" }],
      },
    });
    const perkos = requests.find((request) =>
      request.url.includes("/integrations/oneclaw"),
    );
    expect(perkos?.url).toContain("/agents/perkos-trader/");
    expect(perkos?.body).toMatchObject({
      apiKey: "ocv_one-time-secret",
      oneclawAgentId: agentId,
      skillIds: ["eqlty-uniswap", "eqlty-ens"],
    });
    expect(
      requests.some((request) =>
        request.url.endsWith("/v1/auth/api-key-token"),
      ),
    ).toBe(false);
  });

  it("returns the official link URL for an existing 1Claw user", async () => {
    const fetchFn = vi.fn(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const url = String(input);
        if (url.endsWith(`/v1/platform/apps/${appId}/users`)) {
          return json([]);
        }
        if (url.endsWith("/v1/platform/users/upsert")) {
          return json(
            {
              is_new: false,
              email: "julio@example.com",
              link_required: {
                status: "link_required",
                reason: "user_exists_in_other_org",
                authorize_url:
                  "https://1claw.xyz/connect/eqlty/link",
                app_slug: "eqlty",
              },
            },
            409,
          );
        }
        return json({ detail: String(init?.method) }, 500);
      },
    );

    await expect(
      provisioner(fetchFn).provision({
        userId: "u-1c762eaa00000000",
        externalSubject: "wallet:julio",
        email: "julio@example.com",
        perkosIdToken: "firebase-id-token",
        agents: testAgents(),
      }),
    ).resolves.toEqual({
      status: "link_required",
      authorizeUrl: "https://1claw.xyz/connect/eqlty/link",
    });
  });

  it("reuses a claimed connection without creating resources again", async () => {
    const fetchFn = vi.fn(
      async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith(`/v1/platform/apps/${appId}/users`)) {
          return json([
            {
              connection_id: connectionId,
              external_subject: "wallet:julio",
              status: "claimed",
              claimed_at: "2026-07-25T12:00:00Z",
              agent_ids: [agentId],
              vault_ids: [vaultId],
            },
          ]);
        }
        return json({ detail: "unexpected request" }, 500);
      },
    );

    const result = await provisioner(fetchFn).provision({
      userId: "u-1c762eaa00000000",
      externalSubject: "wallet:julio",
      email: "julio@example.com",
      perkosIdToken: "firebase-id-token",
      agents: testAgents("linked"),
    });

    expect(result).toMatchObject({
      status: "linked",
      connectionId,
      vaultId,
      executionAgent: {
        perkosAgentId: "perkos-trader",
        oneclawAgentId: agentId,
      },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a bootstrapped credential was not linked", async () => {
    const fetchFn = vi.fn(async () =>
      json([
        {
          connection_id: connectionId,
          external_subject: "wallet:julio",
          status: "pending_claim",
          claimed_at: null,
          agent_ids: [agentId],
          vault_ids: [vaultId],
        },
      ]),
    );

    await expect(
      provisioner(fetchFn).provision({
        userId: "u-1c762eaa00000000",
        externalSubject: "wallet:julio",
        email: "julio@example.com",
        perkosIdToken: "firebase-id-token",
        agents: testAgents(),
      }),
    ).rejects.toThrow("PerkOS credential is unavailable");
  });

  it("requires Platform API configuration", () => {
    expect(
      new OneClawFleetProvisioner(loadConfig()).ready,
    ).toBe(false);
  });
});

function provisioner(fetchFn: typeof fetch) {
  return new OneClawFleetProvisioner(
    loadConfig({
      APP_ORIGIN: "https://eqlty.perkos.xyz",
      ONECLAW_PLATFORM_APP_ID: appId,
      ONECLAW_PLATFORM_API_KEY: "plt_eqlty-test-key",
      ONECLAW_API_BASE: "https://api.1claw.xyz",
      PERKOS_API_URL: "https://api.perkos.xyz",
    }),
    { fetchFn },
  );
}

function testAgents(
  traderState: FleetAgent["oneclaw"] = "pending-agent-credential",
): FleetAgent[] {
  return roles.map((role) => ({
    role,
    agentId: `perkos-${role}`,
    name: `eqlty-${role}-1c762eaa`,
    runtime: "Hermes",
    state: "ready",
    plugins: [],
    oneclaw: role === "trader" ? traderState : "pending-agent-credential",
  }));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
