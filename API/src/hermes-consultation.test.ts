import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import type { EnsOrchestrationManifest } from "./ens-types.js";
import type { FleetAgent, FleetRole } from "./fleet-types.js";
import type { OpportunityCandidate } from "./goal-types.js";
import { HermesConsultationService } from "./hermes-consultation.js";

const address = "0x1111111111111111111111111111111111111111";
const transactionHash = `0x${"22".repeat(32)}` as const;
const manifestHash = `0x${"aa".repeat(32)}` as const;

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
  agent("trader", "trader-id"),
  agent("auditor", "auditor-id"),
];

describe("HermesConsultationService", () => {
  it("seals a verified Scout and Risk handoff", async () => {
    const replies = [
      {
        recommendedTicker: "NVDA",
        thesis:
          "NVDA is indexed at block 12345 with route deviation 90 bps, giving it the strongest sealed route.",
        evidence: [
          "graphLiquidity",
          "graphBlock",
          "routeDeviation",
        ],
        confidence: "high",
      },
      {
        decision: "approve",
        ticker: "NVDA",
        summary:
          "NVDA route deviation 90 bps remains below the ENS limit of 300 bps.",
        checks: [
          "ensAllowed",
          "deviationWithinLimit",
          "liquidityAboveMinimum",
          "graphEvidencePresent",
        ],
      },
      {
        decision: "prepare",
        ticker: "NVDA",
        summary:
          "Prepare the exact CLASSIC route from request NVDA-request without submitting funds.",
        checks: [
          "riskApproved",
          "uniswapRoutePresent",
          "requestIdPresent",
          "ensTickerAllowed",
        ],
      },
      {
        decision: "seal",
        ticker: "NVDA",
        summary:
          "Seal NVDA after all four handoffs passed ENS policy version 1.",
        checks: [
          "ensManifestPresent",
          "scoutVerified",
          "riskVerified",
          "traderVerified",
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
      manifestHash,
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
      trader: {
        status: "verified",
        ticker: "NVDA",
        agentId: "trader-id",
        detail: "prepared",
      },
      auditor: {
        status: "verified",
        ticker: "NVDA",
        agentId: "auditor-id",
        detail: "sealed",
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
    expect(result.trader.responseHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.auditor.responseHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain(
      "/agents/scout-id/task",
    );
    expect(String(fetchFn.mock.calls[1]?.[0])).toContain(
      "/agents/risk-id/task",
    );
    expect(String(fetchFn.mock.calls[2]?.[0])).toContain(
      "/agents/trader-id/task",
    );
    expect(String(fetchFn.mock.calls[3]?.[0])).toContain(
      "/agents/auditor-id/task",
    );
    const scoutRequest = JSON.parse(
      String(fetchFn.mock.calls[0]?.[1]?.body),
    ) as { prompt: string; timeoutMs: number };
    const traderRequest = JSON.parse(
      String(fetchFn.mock.calls[2]?.[1]?.body),
    ) as { prompt: string; timeoutMs: number };
    expect(scoutRequest.prompt).toContain('"recommendedTicker":"TICKER"');
    expect(scoutRequest.timeoutMs).toBe(25_000);
    expect(traderRequest.prompt).toContain('"decision":"prepare"');
    expect(traderRequest.timeoutMs).toBe(55_000);
    expect(traderRequest.prompt).toContain('"uniswapRouting":"CLASSIC"');
    expect(traderRequest.prompt).toContain('"uniswapRequestId":"NVDA-request"');
    expect(traderRequest.prompt).not.toContain('"graphEvidence"');
  });

  it("rejects a Scout selection that failed deterministic gates", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        ok: true,
        reply: JSON.stringify({
          recommendedTicker: "AMZN",
          thesis:
            "AMZN appears preferable at block 12345 with route deviation 120 bps despite its failed gates.",
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
      manifestHash,
      agents,
      idToken: "owner-token",
    });

    expect(result.status).toBe("invalid");
    expect(result.mode).toBe("deterministic-fallback");
    expect(result.scout.status).toBe("invalid");
    expect(result.risk.status).toBe("skipped");
    expect(fetchFn).toHaveBeenCalledTimes(2);
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
      manifestHash,
      agents,
    });

    expect(result).toMatchObject({
      mode: "deterministic-fallback",
      status: "unavailable",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("lets Scout correct one malformed handoff", async () => {
    const replies = [
      "NVDA is the best route.",
      JSON.stringify({
        recommendedTicker: "NVDA",
        thesis:
          "NVDA is indexed at block 12345 with route deviation 90 bps and the strongest sealed liquidity.",
        evidence: [
          "graphLiquidity",
          "graphBlock",
          "routeDeviation",
        ],
      }),
      JSON.stringify({
        decision: "approve",
        ticker: "NVDA",
        summary:
          "NVDA route deviation 90 bps remains below the ENS limit of 300 bps.",
        checks: [
          "ensAllowed",
          "deviationWithinLimit",
          "liquidityAboveMinimum",
          "graphEvidencePresent",
        ],
      }),
      JSON.stringify({
        decision: "prepare",
        ticker: "NVDA",
        summary:
          "Prepare the exact CLASSIC route from request NVDA-request without submitting funds.",
        checks: [
          "riskApproved",
          "uniswapRoutePresent",
          "requestIdPresent",
          "ensTickerAllowed",
        ],
      }),
      JSON.stringify({
        decision: "seal",
        ticker: "NVDA",
        summary:
          "Seal NVDA after all four handoffs passed ENS policy version 1.",
        checks: [
          "ensManifestPresent",
          "scoutVerified",
          "riskVerified",
          "traderVerified",
        ],
      }),
    ];
    const fetchFn = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({
          ok: true,
          reply: replies.shift(),
        }),
    );
    const service = new HermesConsultationService(loadConfig({}), {
      fetchFn,
    });

    const result = await service.consult({
      goal: "Choose a route",
      candidates,
      manifest,
      manifestHash,
      agents,
      idToken: "owner-token",
    });

    expect(result.status).toBe("verified");
    expect(result.scout.status).toBe("verified");
    expect(result.risk.status).toBe("verified");
    expect(result.trader.status).toBe("verified");
    expect(result.auditor.status).toBe("verified");
    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect(fetchFn.mock.calls[1]?.[1]?.body).toContain(
      "Retry once",
    );
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
  role: FleetRole,
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
