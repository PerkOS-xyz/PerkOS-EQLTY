import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import type { FleetAgent, FleetRole } from "./fleet-types.js";
import { OneClawFleetProvisioner } from "./oneclaw-fleet.js";

const roles: FleetRole[] = [
  "scout",
  "risk",
  "trader",
  "auditor",
];

describe("1Claw fleet provisioning", () => {
  it("creates four isolated rails without exposing credentials", async () => {
    const requests: Array<{
      url: string;
      method: string;
      body?: Record<string, unknown>;
    }> = [];
    const ids = new Map(
      roles.map((role, index) => [
        `EQLTY-${role}-1c762eaa`,
        `${index + 1}1111111-1111-4111-8111-111111111111`,
      ]),
    );
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
        requests.push({ url, method, body });

        if (url.endsWith("/v1/auth/api-key-token")) {
          return json({ access_token: "jwt-user" });
        }
        if (url.endsWith("/v1/vaults") && method === "GET") {
          return json({ vaults: [] });
        }
        if (url.endsWith("/v1/vaults") && method === "POST") {
          return json(
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              name: body?.name,
            },
            201,
          );
        }
        if (url.endsWith("/v1/agents") && method === "GET") {
          return json({ agents: [] });
        }
        if (url.endsWith("/v1/agents") && method === "POST") {
          const name = String(body?.name);
          return json(
            {
              agent: {
                id: ids.get(name),
                name,
                is_active: true,
                eip712_default_policy: "allow",
              },
              api_key: `ocv_${name}-credential`,
            },
            201,
          );
        }
        if (
          url.endsWith("/signing-keys") &&
          method === "GET"
        ) {
          return json({ keys: [] });
        }
        if (
          url.endsWith("/signing-keys") &&
          method === "POST"
        ) {
          return json(
            {
              chain: "ethereum",
              is_active: true,
              address:
                "0x1111111111111111111111111111111111111111",
            },
            201,
          );
        }
        if (url.includes("/integrations/oneclaw")) {
          return json(
            { reprovisionJobId: `job-${requests.length}` },
            202,
          );
        }
        return json({ message: "unexpected request" }, 500);
      },
    );
    const config = loadConfig({
      ONECLAW_PERSONAL_API_KEY: "1ck_eqlty-test-key",
      ONECLAW_API_BASE: "https://api.1claw.xyz",
      PERKOS_API_URL: "https://api.perkos.xyz",
      INPUT_TOKEN_ADDRESS:
        "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      EQLTY_VAULT_ADDRESS:
        "0x033f13BC2CCB53dbfBEef7594668F9cfa4A70833",
    });

    const result = await new OneClawFleetProvisioner(config, {
      fetchFn,
    }).provision({
      userId: "u-1c762eaa00000000",
      perkosIdToken: "firebase-id-token",
      agents: testAgents(),
    });

    expect(result).toMatchObject({
      status: "linked",
      eip712Restrictions: "disabled",
    });
    expect(result.agents).toHaveLength(4);
    expect(JSON.stringify(result)).not.toContain("ocv_");
    expect(
      result.agents.find((agent) => agent.role === "trader")
        ?.walletAddress,
    ).toBe("0x1111111111111111111111111111111111111111");

    const createBodies = requests
      .filter(
        (request) =>
          request.url.endsWith("/v1/agents") &&
          request.method === "POST",
      )
      .map((request) => request.body);
    expect(createBodies).toHaveLength(4);
    expect(
      createBodies.find(
        (body) => body?.name === "EQLTY-trader-1c762eaa",
      ),
    ).toMatchObject({
      intents_api_enabled: true,
      tx_allowed_chains: ["robinhood-chain"],
      tx_max_per_day: 6,
      tx_to_allowlist: [
        "0x8876789976decbfcbbbe364623c63652db8c0904",
        "0x000000000022D473030F116dDEE9F6B43aC78BA3",
        "0x033f13BC2CCB53dbfBEef7594668F9cfa4A70833",
      ],
      tx_token_allowlist: [
        "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      ],
    });
    expect(
      createBodies.find(
        (body) => body?.name === "EQLTY-scout-1c762eaa",
      ),
    ).toMatchObject({
      intents_api_enabled: false,
      tx_allowed_chains: [],
      tx_max_per_day: 0,
    });
    for (const body of createBodies) {
      expect(body).not.toHaveProperty("eip712_default_policy");
      expect(body).not.toHaveProperty("eip712_domain_allowlist");
    }

    const integrationRequests = requests.filter((request) =>
      request.url.includes("/integrations/oneclaw"),
    );
    expect(integrationRequests).toHaveLength(4);
    expect(
      integrationRequests.find((request) =>
        request.url.includes("perkos-trader"),
      )?.body,
    ).toMatchObject({
      skillIds: ["eqlty-uniswap", "eqlty-ens"],
    });
    expect(
      integrationRequests.find((request) =>
        request.url.includes("perkos-auditor"),
      )?.body,
    ).toMatchObject({
      skillIds: [
        "eqlty-graph",
        "eqlty-uniswap",
        "eqlty-ens",
      ],
    });
  });

  it("stops when EIP-712 restrictions are enabled", async () => {
    const fetchFn = vi.fn(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/v1/auth/api-key-token")) {
          return json({ access_token: "jwt-user" });
        }
        if (url.endsWith("/v1/vaults")) {
          return json({
            vaults: [
              {
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                name: "EQLTY Agent Fleet 1c762eaa",
              },
            ],
          });
        }
        if (url.endsWith("/v1/agents") && method === "GET") {
          return json({
            agents: roles.map((role, index) => ({
              id:
                `${index + 1}1111111-1111-4111-8111-111111111111`,
              name: `EQLTY-${role}-1c762eaa`,
              is_active: true,
            })),
          });
        }
        if (method === "PATCH") {
          const id = url.split("/").at(-1);
          const role = roles[Number(id?.at(0)) - 1];
          return json({
            id,
            name: `EQLTY-${role}-1c762eaa`,
            is_active: true,
            eip712_default_policy:
              role === "trader" ? "deny" : "allow",
          });
        }
        if (url.endsWith("/rotate-key")) {
          return json({ api_key: "ocv_rotated-credential" });
        }
        return json({ message: "unexpected request" }, 500);
      },
    );
    const provisioner = new OneClawFleetProvisioner(
      loadConfig({
        ONECLAW_PERSONAL_API_KEY: "1ck_eqlty-test-key",
      }),
      { fetchFn },
    );

    await expect(
      provisioner.provision({
        userId: "u-1c762eaa00000000",
        perkosIdToken: "firebase-id-token",
        agents: testAgents().map((agent) => ({
          ...agent,
          oneclaw: "linked" as const,
        })),
      }),
    ).rejects.toThrow(
      "Disable EIP-712 restrictions for the EQLTY trader",
    );
  });
});

function testAgents(): FleetAgent[] {
  return roles.map((role) => ({
    role,
    agentId: `perkos-${role}`,
    name: `eqlty-${role}-1c762eaa`,
    runtime: "Hermes",
    state: "ready",
    plugins: [],
    oneclaw: "pending-agent-credential",
  }));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
