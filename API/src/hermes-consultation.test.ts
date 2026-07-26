import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import type { EnsOrchestrationManifest } from "./ens-types.js";
import type { FleetAgent } from "./fleet-types.js";
import type { OpportunityCandidate } from "./goal-types.js";
import { HermesConsultationService } from "./hermes-consultation.js";

const address = "0x1111111111111111111111111111111111111111";
const transactionHash = `0x${"22".repeat(32)}` as const;

const manifest: EnsOrchestrationManifest = {
  schema: "urn:eqlty:ens-orchestration:v1",
  version: 1,
  network: "eip155:4663",
  updatedAt: "2026-07-26T00:00:00.000Z",
  expiresAt: "2026-07-27T00:00:00.000Z",
  paused: false,
  fleet: {
    scout: "scout.demo.eth",
    risk: "risk.demo.eth",
    trader: "trader.demo.eth",
    auditor: "auditor.demo.eth",
  },
  policy: {
    allowedTickers: ["NVDA", "AMZN"],
    maxAmountPerTrade: "3000000",
    maxDeviationBps: 300,
    minLiquidityUsd: 50_000,
    maxOracleAgeSeconds: 300,
  },
};

const candidates: OpportunityCandidate[] = [
  candidate("NVDA", 80_000, 90),
  candidate("AMZN", 60_000, 120),
];

const agents: FleetAgent[] = [
  agent("scout", "scout-id"),
  agent("risk", "risk-id"),
];

describe("HermesConsultationService", () => {
  it("seals a verified Scout and Risk handoff", async () => {
    const replies = [
      {
        recommendedTicker: "NVDA",
        thesis:
          "Deep indexed liquidity and route quality best fit the stated goal.",
        evidence: [
          "graphLiquidity",
          "graphBlock",
          "routeDeviation",
        ],
      },
      {
        decision: "approve",
        ticker: "NVDA",
        summary:
          "The candidate remains inside every active policy boundary.",
        checks: [
          "ensAllowed",
          "deviationWithinLimit",
          "liquidityAboveMinimum",
          "graphEvidencePresent",
        ],
      },
    ];
    const fetchFn = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        ok: true,
        reply: JSON.stringify(replies.shift()),
        detail: "reply received",
      }),
    );
    const service = new HermesConsultationService(loadConfig({}), {
      fetchFn,
    });

    const result = await service.consult({
      goal: "Prefer the strongest liquid route",
      candidates,
      manifest,
      agents,
      idToken: "owner-token",
    });

    expect(result).toMatchObject({
      mode: "hermes-a2a",
      status: "verified",
      selectedTicker: "NVDA",
      scout: {
        status: "verified",
        ticker: "NVDA",
        agentId: "scout-id",
      },
      risk: {
        status: "verified",
        ticker: "NVDA",
        agentId: "risk-id",
        detail: "approved",
      },
    });
    expect(result.scout.responseHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.risk.responseHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.scout.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "the-graph",
          value: "$80,000",
        }),
        expect.objectContaining({
          source: "uniswap",
          value: "90 bps",
        }),
      ]),
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain(
      "/agents/scout-id/task",
    );
    expect(String(fetchFn.mock.calls[1]?.[0])).toContain(
      "/agents/risk-id/task",
    );
  });

  it("rejects a Scout selection that failed deterministic gates", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        ok: true,
        reply: JSON.stringify({
          recommendedTicker: "AMZN",
          thesis:
            "The rejected candidate appears preferable despite its failed gates.",
          evidence: ["graphLiquidity", "routeDeviation"],
        }),
      }),
    );
    const service = new HermesConsultationService(loadConfig({}), {
      fetchFn,
    });

    const result = await service.consult({
      goal: "Choose a route",
      candidates: [
        candidates[0]!,
        { ...candidates[1]!, status: "rejected" },
      ],
      manifest,
      agents,
      idToken: "owner-token",
    });

    expect(result.status).toBe("invalid");
    expect(result.mode).toBe("deterministic-fallback");
    expect(result.scout.status).toBe("invalid");
    expect(result.risk.status).toBe("skipped");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("uses the deterministic fallback without owner credentials", async () => {
    const fetchFn = vi.fn();
    const service = new HermesConsultationService(loadConfig({}), {
      fetchFn,
    });

    const result = await service.consult({
      goal: "Choose a route",
      candidates,
      manifest,
      agents,
    });

    expect(result).toMatchObject({
      mode: "deterministic-fallback",
      status: "unavailable",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

function candidate(
  ticker: string,
  liquidityUsd: number,
  deviationBps: number,
): OpportunityCandidate {
  return {
    ticker,
    name: ticker,
    tokenAddress: address,
    status: "eligible",
    score: 90,
    reason: "Policy-compatible route.",
    deviationBps,
    uniswapRouting: "CLASSIC",
    uniswapRequestId: `${ticker}-request`,
    graphEvidence: {
      blockNumber: "12345",
      transactionHash,
      poolIdentifier: `${ticker}-pool`,
      poolAddress: address,
      capturedAt: "2026-07-26T00:00:00.000Z",
      liquidityUsd,
    },
    orchestrationReady: true,
  };
}

function agent(
  role: "scout" | "risk",
  agentId: string,
): FleetAgent {
  return {
    role,
    agentId,
    name: `eqlty-${role}`,
    runtime: "Hermes",
    state: "ready",
    plugins: [],
    oneclaw: "pending-agent-credential",
  };
}
