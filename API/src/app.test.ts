import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("API foundation", () => {
  it("loads safe defaults", () => {
    const config = loadConfig({});

    expect(config.PUBLIC_PROJECT_NAME).toBe("EQLTY");
    expect(config.ROBINHOOD_CHAIN_ID).toBe(4663);
    expect(config.DEMO_MODE).toBe(true);
  });

  it("rejects invalid configuration", () => {
    expect(() => loadConfig({ PORT: "70000" })).toThrow(
      "Invalid API configuration",
    );
  });

  it("reports health without caching", async () => {
    const response = await request("/health");
    const body = (await response.json()) as {
      ok: boolean;
      service: string;
      mode: string;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      ok: true,
      service: "eqlty-api",
      mode: "preview",
    });
  });

  it("only exposes public configuration", async () => {
    const response = await request("/api/config");
    const body = (await response.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.projectName).toBe("EQLTY");
    expect(serialized).not.toMatch(/key|secret|token|rpcUrl/i);
  });

  it("uses a consistent missing route response", async () => {
    const response = await request("/missing");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("serves the stock catalog contract", async () => {
    const catalog = {
      chainId: 4663 as const,
      quoteToken: "USDG" as const,
      quoteAmount: "1000000",
      observedAt: "2026-07-25T12:00:00.000Z",
      thresholds: {
        availableDeviationBps: 100,
        maxDeviationBps: 300,
        maxReferenceAgeSeconds: 86_400,
      },
      summary: {
        total: 0,
        available: 0,
        caution: 0,
        blocked: 0,
        routed: 0,
        orchestrationReady: 0,
      },
      assets: [],
    };
    const response = await request(
      "/api/assets?catalog=uniswap-v4-universe",
      {
        stockCatalog: {
          catalog: async () => catalog,
          assessTicker: async () => undefined,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(catalog);
  });

  it("serves the PerkOS owner challenge", async () => {
    const challenge = {
      nonce: "nonce-1",
      message: "Sign this message",
      expiresAt: 1_800_000_000_000,
    };
    const response = await request(
      "/api/auth/perkos/nonce?address=0x1234567890abcdef1234567890abcdef12345678",
      {
        ownerAuth: {
          challenge: async () => challenge,
          verify: async () => {
            throw new Error("not called");
          },
          session: () => undefined,
          logout: () => undefined,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(challenge);
  });

  it("rejects malformed owner addresses before proxying", async () => {
    const response = await request("/api/auth/perkos/nonce?address=invalid");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_wallet_address",
    });
  });

  it("serves authenticated agent metadata", async () => {
    const session = {
      sub: "eip155:4663:0x1234567890abcdef1234567890abcdef12345678",
      provider: "wallet" as const,
      walletAddress:
        "0x1234567890abcdef1234567890abcdef12345678" as const,
      fleetUserId: "u-12345678",
      expiresAt: "2026-07-25T13:00:00.000Z",
    };
    const settings = {
      schema: "urn:eqlty:agent-settings:v1" as const,
      version: 1,
      role: "scout" as const,
      perkosAgentId: "agent-scout",
      ensName: "scout.u-12345678.demo.eth",
      behavior: {
        objective: "Discover eligible assets",
        inputs: ["ens" as const],
        actions: ["recommend" as const],
        requiresWorldSelfieForChanges: true as const,
      },
      security: {
        provider: "1claw" as const,
        enforcement: "required-before-spend" as const,
        policyRef: "perkos:agent-scout:1claw",
      },
    };
    const response = await request("/api/fleet/metadata/scout", {
      ownerAuth: {
        challenge: async () => {
          throw new Error("not called");
        },
        verify: async () => session,
        session: () => session,
        logout: () => undefined,
      },
      ensControlPlane: {
        resolve: async () => ({
          source: "durin",
          mode: "live",
          status: "active",
          rootName: "u-12345678.demo.eth",
          manifestHash: `0x${"ab".repeat(32)}` as const,
          resolvedAt: "2026-07-25T12:00:00.000Z",
          owner: session.walletAddress,
          agentSettings: { scout: settings },
        }),
      },
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      schema: "urn:eqlty:ens-agent-metadata:v1",
      role: "scout",
      name: "scout.u-12345678.demo.eth",
    });
  });

  it("activates the authenticated owner's fleet", async () => {
    const session = {
      sub: "eip155:4663:0x1234567890abcdef1234567890abcdef12345678",
      provider: "wallet" as const,
      walletAddress:
        "0x1234567890abcdef1234567890abcdef12345678" as const,
      fleetUserId: "u-12345678",
      expiresAt: "2026-07-25T13:00:00.000Z",
    };
    const response = await request(
      "/api/fleet/activate",
      {
        ownerAuth: {
          challenge: async () => {
            throw new Error("not called");
          },
          verify: async () => session,
          session: () => session,
          perkosIdToken: () => "firebase-token",
          logout: () => undefined,
        },
        fleetActivation: {
          activate: async (input) => ({
            status: "provisioning",
            userId: input.userId,
            owner: input.owner,
            rootName: "u-12345678.demo.eth",
            agents: {
              scout: "eqlty-scout-12345678",
              risk: "eqlty-risk-12345678",
              trader: "eqlty-trader-12345678",
              auditor: "eqlty-auditor-12345678",
            },
            transactions: [],
            verified: false,
            runtime: {
              provider: "perkos",
              mode: "live",
              status: "provisioning",
              agents: [],
            },
          }),
        },
      },
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      status: "provisioning",
      userId: "u-12345678",
      verified: false,
    });
  });
});

async function request(
  path: string,
  dependencies?: Parameters<typeof createApp>[1],
  init?: RequestInit,
): Promise<Response> {
  const server = createServer(createApp(loadConfig({}), dependencies));
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${address.port}${path}`, init);
}
