import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import {
  FirestoreGoalStore,
  type PersistedGoal,
} from "./firestore-goal.js";
import type { DecisionFee } from "./decision-fee-types.js";
import type { OpportunityAnalysis } from "./goal-types.js";

const owner =
  "0x1111111111111111111111111111111111111111" as const;

describe("Firestore goal store", () => {
  it("returns the newest resumable decision and ignores invalid records", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          documents: [
            document(goal("older", "2026-07-25T12:00:00.000Z")),
            { fields: { payload: { stringValue: "not-json" } } },
            document(goal("unpaid", "2026-07-25T12:20:00.000Z", false)),
            document(goal("newer", "2026-07-25T12:10:00.000Z")),
          ],
        }),
        { status: 200 },
      ),
    );
    const store = new FirestoreGoalStore(
      loadConfig({ PERKOS_FIREBASE_PROJECT_ID: "perkos-test" }),
      fetchFn as unknown as typeof fetch,
    );

    const latest = await store.latest(owner, "firebase-token");

    expect(latest?.goal.id).toBe("newer");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://firestore.googleapis.com/v1/projects/perkos-test/databases/(default)/documents/wallets/0x1111111111111111111111111111111111111111/eqlty_goals?pageSize=100",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer firebase-token",
        }),
      }),
    );
  });
});

function document(value: PersistedGoal) {
  return {
    fields: { payload: { stringValue: JSON.stringify(value) } },
  };
}

function goal(
  id: string,
  startedAt: string,
  resumable = true,
): PersistedGoal {
  return {
    goal: {
      id,
      goal: "Compare stock tokens",
      amountIn: "1000000",
      status: resumable ? "completed" : "payment-required",
      startedAt,
      endsAt: startedAt,
      cadenceSeconds: 30,
      cyclesCompleted: 1,
      gates: {
        ens: "resolve-every-cycle",
        oneclaw: "enforced",
        linkedRoles: [],
        requiredRoles: ["trader"],
        oneclawRequired: false,
        oneclawLinked: false,
        oneclawMinimumAmount: "3000000",
        executionAuthorized: true,
        detail: "Ready",
      },
      latest: {} as OpportunityAnalysis,
      history: [],
      decisionFee: {
        status: resumable ? "settled" : "payment-required",
      } as DecisionFee,
    },
    input: {
      userId: "u-12345678",
      owner,
      goal: "Compare stock tokens",
      amountIn: "1000000",
      windowMinutes: 2,
      cadenceSeconds: 30,
      maxCandidates: 3,
      linkedRoles: [],
    },
  };
}
