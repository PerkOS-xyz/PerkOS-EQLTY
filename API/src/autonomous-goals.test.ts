import { describe, expect, it, vi } from "vitest";
import { AutonomousGoalService } from "./autonomous-goals.js";
import type {
  GoalStore,
  PersistedGoal,
} from "./firestore-goal.js";
import type { OpportunityAnalysis } from "./goal-types.js";

const owner =
  "0x1111111111111111111111111111111111111111" as const;

describe("autonomous goals", () => {
  it("runs a two-minute goal and reevaluates when polled", async () => {
    let now = Date.parse("2026-07-25T12:00:00.000Z");
    const analyze = vi.fn(async () => analysis(now));
    const service = new AutonomousGoalService(
      { analyze },
      { now: () => now, id: () => "goal-1" },
    );

    const started = await service.start(goalInput());

    expect(started.endsAt).toBe("2026-07-25T12:02:00.000Z");
    expect(started.nextEvaluationAt).toBe(
      "2026-07-25T12:00:30.000Z",
    );
    expect(started.cyclesCompleted).toBe(1);
    expect(started.gates.executionAuthorized).toBe(true);

    now += 30_000;
    const second = await service.read("goal-1", identity());
    expect(second?.cyclesCompleted).toBe(2);
    expect(second?.history).toHaveLength(2);
    expect(analyze).toHaveBeenCalledTimes(2);

    now += 90_000;
    const completed = await service.read("goal-1", identity());
    expect(completed?.status).toBe("completed");
    expect(completed?.nextEvaluationAt).toBeUndefined();
  });

  it("keeps analysis active while 1Claw locks execution", async () => {
    const now = Date.parse("2026-07-25T12:00:00.000Z");
    const service = new AutonomousGoalService(
      { analyze: async () => analysis(now) },
      { now: () => now },
    );

    const goal = await service.start({
      ...goalInput(),
      amountIn: "3000000",
      linkedRoles: ["scout", "risk", "auditor"],
    });

    expect(goal.status).toBe("active");
    expect(goal.cyclesCompleted).toBe(1);
    expect(goal.gates.executionAuthorized).toBe(false);
    expect(goal.gates.detail).toContain("are locked");
  });

  it("keeps sub-threshold execution available without 1Claw", async () => {
    const now = Date.parse("2026-07-25T12:00:00.000Z");
    const service = new AutonomousGoalService(
      { analyze: async () => analysis(now) },
      { now: () => now },
    );

    const goal = await service.start({
      ...goalInput(),
      amountIn: "2999999",
      linkedRoles: [],
    });

    expect(goal.gates.oneclawRequired).toBe(false);
    expect(goal.gates.oneclawLinked).toBe(false);
    expect(goal.gates.executionAuthorized).toBe(true);
  });

  it("does not expose a goal to another owner", async () => {
    const now = Date.parse("2026-07-25T12:00:00.000Z");
    const service = new AutonomousGoalService(
      { analyze: async () => analysis(now) },
      { now: () => now, id: () => "goal-private" },
    );
    await service.start(goalInput());

    await expect(
      service.read("goal-private", {
        userId: "u-other",
        owner: "0x2222222222222222222222222222222222222222",
      }),
    ).resolves.toBeUndefined();
  });

  it("preserves a failed cycle for a later retry", async () => {
    let now = Date.parse("2026-07-25T12:00:00.000Z");
    const analyze = vi
      .fn()
      .mockRejectedValueOnce(new Error("Graph stream unavailable"))
      .mockResolvedValueOnce(analysis(now + 30_000));
    const service = new AutonomousGoalService(
      { analyze },
      { now: () => now, id: () => "goal-retry" },
    );

    const started = await service.start(goalInput());
    expect(started.cyclesCompleted).toBe(0);
    expect(started.error).toBe("Graph stream unavailable");

    now += 30_000;
    const recovered = await service.read("goal-retry", identity());
    expect(recovered?.cyclesCompleted).toBe(1);
    expect(recovered?.error).toBeUndefined();
  });

  it("restores a goal in a new serverless instance", async () => {
    const records = new Map<string, PersistedGoal>();
    const store: GoalStore = {
      read: vi.fn(async (_owner, _token, id) => records.get(id)),
      save: vi.fn(async (_owner, _token, id, goal) => {
        records.set(id, structuredClone(goal));
      }),
    };
    const now = Date.parse("2026-07-25T12:00:00.000Z");
    const first = new AutonomousGoalService(
      { analyze: async () => analysis(now) },
      { now: () => now, id: () => "goal-durable", store },
    );
    await first.start({
      ...goalInput(),
      perkosIdToken: "firebase-token",
    });

    const second = new AutonomousGoalService(
      { analyze: async () => analysis(now) },
      { now: () => now, store },
    );
    const restored = await second.read("goal-durable", {
      ...identity(),
      perkosIdToken: "firebase-token",
    });

    expect(restored?.id).toBe("goal-durable");
    expect(restored?.cyclesCompleted).toBe(1);
    expect(store.read).toHaveBeenCalledOnce();
    expect(JSON.stringify(records.get("goal-durable"))).not.toContain(
      "firebase-token",
    );
  });
});

function goalInput() {
  return {
    ...identity(),
    goal: "Find the strongest policy-compatible stock-token route",
    amountIn: "1000000",
    windowMinutes: 2,
    cadenceSeconds: 30,
    maxCandidates: 3,
    linkedRoles: ["scout", "risk", "trader", "auditor"] as const,
  };
}

function identity() {
  return { userId: "u-12345678", owner };
}

function analysis(timestamp: number): OpportunityAnalysis {
  const evaluatedAt = new Date(timestamp).toISOString();
  return {
    id: `analysis-${timestamp}`,
    goal: "test",
    amountIn: "1000000",
    mode: "analysis",
    policy: {
      source: "durin",
      rootName: "u-12345678.demo.eth",
      version: 1,
      manifestHash: `0x${"aa".repeat(32)}`,
      allowedTickers: ["NVDA", "AMZN", "AMD"],
      paused: false,
    },
    evaluatedAt,
    recommendedTicker: "AMZN",
    candidates: [],
    consultation: {
      mode: "deterministic-fallback",
      status: "unavailable",
      scout: {
        role: "scout",
        status: "unavailable",
        facts: [],
      },
      risk: {
        role: "risk",
        status: "unavailable",
        facts: [],
      },
    },
    proofRoot: `0x${"bb".repeat(32)}`,
  };
}
