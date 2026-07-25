import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { EnsPolicyPreparationService } from "./ens-policy-preparation.js";

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

  it("serves authenticated Graph evidence", async () => {
    const session = {
      sub: "eip155:4663:0x1234567890abcdef1234567890abcdef12345678",
      provider: "wallet" as const,
      walletAddress:
        "0x1234567890abcdef1234567890abcdef12345678" as const,
      fleetUserId: "u-12345678",
      expiresAt: "2026-07-25T13:00:00.000Z",
    };
    const response = await request("/api/evidence/nvda", {
      ownerAuth: {
        challenge: async () => {
          throw new Error("not called");
        },
        verify: async () => session,
        session: () => session,
        logout: () => undefined,
      },
      graphEvidence: {
        evidence: async (ticker: string) => ({
          ticker: ticker.toUpperCase(),
          source: "the-graph-substreams",
          health: { healthy: true },
        }),
      } as NonNullable<
        Parameters<typeof createApp>[1]
      >["graphEvidence"],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ticker: "NVDA",
      source: "the-graph-substreams",
      health: { healthy: true },
    });
  });

  it("starts an authenticated two-minute fleet goal", async () => {
    const session = {
      sub: "eip155:4663:0x1234567890abcdef1234567890abcdef12345678",
      provider: "wallet" as const,
      walletAddress:
        "0x1234567890abcdef1234567890abcdef12345678" as const,
      fleetUserId: "u-12345678",
      expiresAt: "2026-07-25T13:00:00.000Z",
    };
    const start = vi.fn(async () => ({
      id: "goal-1",
      goal: "Find the strongest stock token opportunity",
      amountIn: "1000000",
      status: "active" as const,
      startedAt: "2026-07-25T12:00:00.000Z",
      endsAt: "2026-07-25T12:02:00.000Z",
      cadenceSeconds: 30,
      cyclesCompleted: 1,
      gates: {
        ens: "resolve-every-cycle" as const,
        oneclaw: "enforced" as const,
        linkedRoles: ["scout" as const],
        requiredRoles: [
          "scout" as const,
          "risk" as const,
          "trader" as const,
          "auditor" as const,
        ],
        executionAuthorized: false,
        detail: "Execution is locked.",
      },
      history: [],
    }));
    const response = await request(
      "/api/goals",
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
          activate: async () => ({
            status: "reactivated",
            userId: session.fleetUserId,
            owner: session.walletAddress,
            rootName: "u-12345678.demo.eth",
            agents: {
              scout: "agent-scout",
              risk: "agent-risk",
              trader: "agent-trader",
              auditor: "agent-auditor",
            },
            manifestHash: `0x${"aa".repeat(32)}`,
            transactions: [],
            verified: true,
            runtime: {
              provider: "perkos",
              mode: "live",
              status: "ready",
              agents: [
                {
                  role: "scout",
                  agentId: "agent-scout",
                  name: "eqlty-scout-12345678",
                  runtime: "Hermes",
                  state: "ready",
                  plugins: [],
                  oneclaw: "linked",
                },
              ],
            },
          }),
        },
        goals: {
          start,
          read: async () => undefined,
          tick: async () => undefined,
        },
      },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal: "Find the strongest stock token opportunity",
          amountIn: "1000000",
          windowMinutes: 2,
          cadenceSeconds: 30,
          maxCandidates: 3,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u-12345678",
        owner: session.walletAddress,
        linkedRoles: ["scout"],
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      id: "goal-1",
      status: "active",
    });
  });

  it("prepares an authenticated ENS policy change", async () => {
    const session = testSession();
    const prepared = {
      rootName: "u-12345678.demo.eth",
      currentManifestHash: `0x${"11".repeat(32)}`,
      manifestHash: `0x${"22".repeat(32)}`,
      manifest: {},
      manifestJson: "{}",
      agentRecords: {},
      diff: [
        {
          field: "allowedTickers",
          before: ["NVDA"],
          after: ["NVDA", "AMZN"],
        },
      ],
      publicationMode: "prepared-only" as const,
      requiredAuthorization: [
        "owner-wallet",
        "world-selfie",
      ] as const,
    } as Awaited<
      ReturnType<EnsPolicyPreparationService["prepare"]>
    >;
    const prepare = vi.fn(async () => prepared);
    const response = await request(
      "/api/orchestration/prepare",
      {
        ownerAuth: testOwnerAuth(session),
        ensPolicyPreparation: { prepare },
      },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paused: false,
          allowedTickers: ["nvda", "amzn"],
          maxAmountPerTrade: "1000000",
          maxDeviationBps: 300,
          minLiquidityUsd: 50_000,
          maxOracleAgeSeconds: 900,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(prepare).toHaveBeenCalledWith({
      userId: session.fleetUserId,
      owner: session.walletAddress,
      change: expect.objectContaining({
        allowedTickers: ["NVDA", "AMZN"],
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      publicationMode: "prepared-only",
      requiredAuthorization: ["owner-wallet", "world-selfie"],
    });
  });

  it("rejects unauthorized and malformed ENS policy changes", async () => {
    const prepare = vi.fn();
    const unauthorized = await request(
      "/api/orchestration/prepare",
      { ensPolicyPreparation: { prepare } },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const invalid = await request(
      "/api/orchestration/prepare",
      {
        ownerAuth: testOwnerAuth(testSession()),
        ensPolicyPreparation: { prepare },
      },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowedTickers: [] }),
      },
    );

    expect(unauthorized.status).toBe(401);
    expect(invalid.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("creates an execution strategy for the session owner", async () => {
    const session = testSession();
    const create = vi.fn(async (input) => ({
      ...input,
      id: "strategy-1",
      spent: "0",
      status: "active" as const,
      humanProof: {
        provider: "owner-wallet-session" as const,
        status: "verified" as const,
        proofHash: `0x${"aa".repeat(32)}` as const,
      },
      executionMode: "full" as const,
    }));
    const response = await request(
      "/api/strategies",
      {
        ownerAuth: testOwnerAuth(session),
        strategies: { create },
      },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: session.walletAddress,
          agent: session.walletAddress,
          ticker: "NVDA",
          inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
          outputToken: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
          router: "0x8876789976decbfcbbbe364623c63652db8c0904",
          maxAmountPerTrade: "1000000",
          maxTotalSpend: "1000000",
          maxSlippageBps: 100,
          expiresAt: "2026-07-26T12:00:00.000Z",
          humanVerified: true,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: session.walletAddress,
        ticker: "NVDA",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      id: "strategy-1",
      executionMode: "full",
    });
  });

  it("runs the authenticated four-agent proof path", async () => {
    const session = testSession();
    const run = vi.fn(async (input) => ({
      id: "run-1",
      strategyId: input.strategyId,
      ticker: "NVDA",
      amountIn: input.amountIn,
      executeRequested: input.execute,
      status: "approved" as const,
      createdAt: "2026-07-25T12:00:00.000Z",
      steps: [],
      handoffs: [],
      proofBundleRoot: `0x${"bb".repeat(32)}` as const,
    }));
    const response = await request(
      "/api/runs",
      {
        ownerAuth: testOwnerAuth(session),
        fleetActivation: {
          activate: async () => ({
            status: "reactivated",
            userId: session.fleetUserId,
            owner: session.walletAddress,
            rootName: "u-12345678.demo.eth",
            agents: {
              scout: "agent-scout",
              risk: "agent-risk",
              trader: "agent-trader",
              auditor: "agent-auditor",
            },
            manifestHash: `0x${"aa".repeat(32)}`,
            transactions: [],
            verified: true,
            runtime: {
              provider: "perkos",
              mode: "live",
              status: "ready",
              agents: ["scout", "risk", "trader", "auditor"].map(
                (role) => ({
                  role: role as
                    | "scout"
                    | "risk"
                    | "trader"
                    | "auditor",
                  agentId: `agent-${role}`,
                  name: `eqlty-${role}-12345678`,
                  runtime: "Hermes" as const,
                  state: "ready" as const,
                  plugins: [],
                  oneclaw: "linked" as const,
                }),
              ),
            },
          }),
        },
        proofRuns: { run },
      },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          strategyId: "strategy-1",
          strategy: { ignored: true },
          amountIn: "1000000",
          execute: false,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(run).toHaveBeenCalledWith({
      strategyId: "strategy-1",
      amountIn: "1000000",
      execute: false,
      userId: session.fleetUserId,
      owner: session.walletAddress,
      executionAuthorized: true,
    });
    await expect(response.json()).resolves.toMatchObject({
      id: "run-1",
      status: "approved",
    });
  });
});

function testSession() {
  return {
    sub: "eip155:4663:0x1234567890abcdef1234567890abcdef12345678",
    provider: "wallet" as const,
    walletAddress:
      "0x1234567890abcdef1234567890abcdef12345678" as const,
    fleetUserId: "u-12345678",
    expiresAt: "2026-07-25T13:00:00.000Z",
  };
}

function testOwnerAuth(session: ReturnType<typeof testSession>) {
  return {
    challenge: async () => {
      throw new Error("not called");
    },
    verify: async () => session,
    session: () => session,
    perkosIdToken: () => "firebase-token",
    logout: () => undefined,
  };
}

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
