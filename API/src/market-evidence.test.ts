import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { MarketEvidenceService } from "./market-evidence.js";

describe("market evidence provider", () => {
  it("uses Robinhood RPC for the revenue-stage MVP", async () => {
    const rpc = provider("robinhood-rpc");
    const graph = provider("the-graph-substreams");
    const service = new MarketEvidenceService(
      loadConfig({ EQLTY_EVIDENCE_PROVIDER: "rpc" }),
      { rpc, graph },
    );

    expect(service.ready()).toBe(true);
    await expect(service.status()).resolves.toMatchObject({
      evidenceProvider: "robinhood-rpc",
    });
    expect(rpc.status).toHaveBeenCalledOnce();
    expect(graph.status).not.toHaveBeenCalled();
  });

  it("can restore The Graph without changing consumers", async () => {
    const rpc = provider("robinhood-rpc");
    const graph = provider("the-graph-substreams");
    const service = new MarketEvidenceService(
      loadConfig({ EQLTY_EVIDENCE_PROVIDER: "graph" }),
      { rpc, graph },
    );

    await expect(service.status()).resolves.toMatchObject({
      evidenceProvider: "the-graph-substreams",
    });
    expect(graph.status).toHaveBeenCalledOnce();
    expect(rpc.status).not.toHaveBeenCalled();
  });
});

function provider(
  evidenceProvider: "the-graph-substreams" | "robinhood-rpc",
) {
  return {
    ready: vi.fn(() => true),
    status: vi.fn(async () => ({
      configured: true,
      status: "ready" as const,
      checkedAt: "2026-09-06T12:00:00.000Z",
      evidenceProvider,
      recovery: {
        state: "healthy" as const,
        action: "none" as const,
        automatic: true,
        message: "ready",
      },
    })),
    evidence: vi.fn(async () => {
      throw new Error("not called");
    }),
    series: vi.fn(async () => {
      throw new Error("not called");
    }),
  };
}
