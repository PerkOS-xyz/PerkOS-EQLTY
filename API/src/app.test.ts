import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { EnsPolicyPreparationService } from "./ens-policy-preparation.js";
import type { ExecutionStrategy } from "./execution-types.js";

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

  it("reports purchase readiness for the authenticated wallet", async () => {
    const session = testSession();
    const read = vi.fn(async (owner, amountIn) => ({
      chainId: 4663 as const,
      network: "Robinhood Chain" as const,
      wallet: owner,
      vault:
        "0x033f13BC2CCB53dbfBEef7594668F9cfa4A70833" as const,
      nativeBalance: "3700000000000000",
      usdGBalance: "7963158",
      amountIn,
      ready: true,
      checks: { gas: true, funds: true, vault: true },
    }));
    const response = await request(
      "/api/wallet/readiness?amountIn=1000000",
      {
        ownerAuth: testOwnerAuth(session),
        walletReadiness: { read },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(read).toHaveBeenCalledWith(
      session.walletAddress,
      "1000000",
    );
    await expect(response.json()).resolves.toMatchObject({
      wallet: session.walletAddress,
      usdGBalance: "7963158",
      ready: true,
    });
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
        oneclawRequired: false,
        oneclawLinked: false,
        oneclawMinimumAmount: "3000000",
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
    const trader =
      "0x9999999999999999999999999999999999999999" as const;
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
      { ENS_TRADER_ADDRESS: trader },
    );

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: session.walletAddress,
        agent: trader,
        ticker: "NVDA",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      id: "strategy-1",
      executionMode: "full",
    });
  });

  it("links the wallet-created onchain strategy", async () => {
    const session = testSession();
    const bindOnchain = vi.fn(
      (id, owner, onchain): ExecutionStrategy => ({
        id,
        owner,
        onchain,
        ticker: "AMZN",
        agent: "0x9999999999999999999999999999999999999999",
        inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
        outputToken: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
        router: "0x8876789976decbfcbbbe364623c63652db8c0904",
        maxAmountPerTrade: "1000000",
        maxTotalSpend: "1000000",
        spent: "0",
        maxSlippageBps: 100,
        expiresAt: "2026-07-26T12:00:00.000Z",
        status: "active",
        humanProof: {
          provider: "owner-wallet-session",
          status: "verified",
          proofHash: `0x${"44".repeat(32)}`,
        },
        executionMode: "full",
      }),
    );
    const response = await request(
      "/api/strategies/strategy-1/onchain",
      {
        ownerAuth: testOwnerAuth(session),
        strategies: {
          create: vi.fn(),
          bindOnchain,
        },
      },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: 4663,
          strategyId: "2",
          creationTransactionHash: `0x${"11".repeat(32)}`,
          approvalTransactionHash: `0x${"22".repeat(32)}`,
          fundingTransactionHash: `0x${"33".repeat(32)}`,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(bindOnchain).toHaveBeenCalledWith(
      "strategy-1",
      session.walletAddress,
      expect.objectContaining({ strategyId: "2" }),
    );
    await expect(response.json()).resolves.toMatchObject({
      id: "strategy-1",
      onchain: { chainId: 4663, strategyId: "2" },
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
      oneclaw: input.oneclaw,
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
      oneclaw: {
        required: false,
        linked: true,
        minimumAmount: "3000000",
        executionAuthorized: true,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      id: "run-1",
      status: "approved",
    });
  });

  it("serves authenticated purchase history", async () => {
    const session = testSession();
    const list = vi.fn(async () => ({
      source: "robinhood-chain" as const,
      status: "ready" as const,
      vault:
        "0x2222222222222222222222222222222222222222" as const,
      entries: [],
    }));
    const response = await request("/api/history", {
      ownerAuth: testOwnerAuth(session),
      purchaseHistory: { list },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(list).toHaveBeenCalledWith(session.walletAddress);
    await expect(response.json()).resolves.toMatchObject({
      source: "robinhood-chain",
      status: "ready",
    });
  });

  it("serves the authenticated wallet portfolio", async () => {
    const session = testSession();
    const read = vi.fn(async () => ({
      source: "robinhood-chain" as const,
      status: "ready" as const,
      owner: session.walletAddress,
      observedAt: "2026-07-25T12:00:00.000Z",
      coverage: {
        checkedTokens: 10,
        unreadableTokens: 0,
        pricedPositions: 1,
        verifiedCostPositions: 1,
      },
      summary: {
        positions: 1,
        marketValueUsd: 1.25,
        costBasisUsd: 1,
        unrealizedGainUsd: 0.25,
      },
      holdings: [],
    }));
    const response = await request("/api/portfolio", {
      ownerAuth: testOwnerAuth(session),
      portfolio: { read },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(read).toHaveBeenCalledWith(session.walletAddress);
    await expect(response.json()).resolves.toMatchObject({
      summary: { positions: 1, unrealizedGainUsd: 0.25 },
    });
  });

  it("protects purchase history and portfolio without a session", async () => {
    const history = await request("/api/history");
    const portfolio = await request("/api/portfolio");

    expect(history.status).toBe(401);
    expect(portfolio.status).toBe(401);
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
  environment?: NodeJS.ProcessEnv,
): Promise<Response> {
  const server = createServer(
    createApp(loadConfig(environment ?? {}), dependencies),
  );
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${address.port}${path}`, init);
}
