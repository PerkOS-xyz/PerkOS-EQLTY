import { randomUUID } from "node:crypto";
import type {
  AutonomousGoal,
  GoalIdentity,
  GoalInput,
  OpportunityAnalysis,
} from "./goal-types.js";
import type { FleetRole } from "./fleet-types.js";
import type {
  GoalStore,
  PersistedGoal,
} from "./firestore-goal.js";
import type { OpportunityAnalysisService } from "./opportunity-analysis.js";
import {
  defaultOneClawMinimumAmount,
  oneClawGate,
} from "./oneclaw-policy.js";

type StoredGoal = AutonomousGoal & {
  input: GoalInput;
  running: boolean;
};

type Dependencies = {
  now?: () => number;
  id?: () => string;
  oneclawMinimumAmount?: string;
  store?: GoalStore;
};

export class AutonomousGoalService {
  private readonly goals = new Map<string, StoredGoal>();
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly oneclawMinimumAmount: string;
  private readonly store?: GoalStore;

  constructor(
    private readonly opportunities: Pick<
      OpportunityAnalysisService,
      "analyze"
    >,
    dependencies: Dependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.id = dependencies.id ?? randomUUID;
    this.oneclawMinimumAmount =
      dependencies.oneclawMinimumAmount ??
      defaultOneClawMinimumAmount;
    this.store = dependencies.store;
  }

  async start(input: GoalInput): Promise<AutonomousGoal> {
    const startedAt = this.now();
    const requiredRoles: FleetRole[] = ["trader"];
    const linkedRoles = requiredRoles.filter((role) =>
      input.linkedRoles.includes(role),
    );
    const oneclaw = oneClawGate({
      amountIn: input.amountIn,
      linkedRoles,
      requiredRoles,
      minimumAmount: this.oneclawMinimumAmount,
    });
    const goal: StoredGoal = {
      id: this.id(),
      goal: input.goal,
      amountIn: input.amountIn,
      status: "active",
      startedAt: new Date(startedAt).toISOString(),
      endsAt: new Date(
        startedAt + input.windowMinutes * 60_000,
      ).toISOString(),
      cadenceSeconds: input.cadenceSeconds,
      cyclesCompleted: 0,
      gates: {
        ens: "resolve-every-cycle",
        oneclaw: "enforced",
        linkedRoles,
        requiredRoles,
        oneclawRequired: oneclaw.required,
        oneclawLinked: oneclaw.linked,
        oneclawMinimumAmount: oneclaw.minimumAmount,
        executionAuthorized: oneclaw.executionAuthorized,
        detail: gateDetail(oneclaw),
      },
      history: [],
      input,
      running: false,
    };
    this.goals.set(goal.id, goal);
    await this.evaluate(goal);
    return publicGoal(goal);
  }

  async read(
    id: string,
    identity: GoalIdentity,
  ): Promise<AutonomousGoal | undefined> {
    const goal = await this.ownedGoal(id, identity);
    if (!goal) return undefined;
    if (
      goal.status === "active" &&
      goal.nextEvaluationAt &&
      Date.parse(goal.nextEvaluationAt) <= this.now()
    ) {
      await this.evaluate(goal);
    }
    return publicGoal(goal);
  }

  async tick(
    id: string,
    identity: GoalIdentity,
  ): Promise<AutonomousGoal | undefined> {
    const goal = await this.ownedGoal(id, identity);
    if (!goal) return undefined;
    await this.evaluate(goal);
    return publicGoal(goal);
  }

  private async ownedGoal(
    id: string,
    identity: GoalIdentity,
  ): Promise<StoredGoal | undefined> {
    let goal = this.goals.get(id);
    if (!goal && identity.perkosIdToken && this.store) {
      const persisted = await this.store.read(
        identity.owner,
        identity.perkosIdToken,
        id,
      );
      if (persisted) {
        goal = restoreGoal(persisted, identity.perkosIdToken);
        this.goals.set(id, goal);
      }
    }
    if (
      !goal ||
      goal.input.userId !== identity.userId ||
      goal.input.owner.toLowerCase() !== identity.owner.toLowerCase()
    ) {
      return undefined;
    }
    goal.input.perkosIdToken =
      identity.perkosIdToken ?? goal.input.perkosIdToken;
    return goal;
  }

  private async evaluate(goal: StoredGoal): Promise<void> {
    if (goal.running || goal.status !== "active") return;
    goal.running = true;
    try {
      const now = this.now();
      if (now >= Date.parse(goal.endsAt) && goal.cyclesCompleted > 0) {
        goal.status = "completed";
        goal.nextEvaluationAt = undefined;
        return;
      }
      const analysis = await this.opportunities.analyze({
        goal: goal.goal,
        amountIn: goal.amountIn,
        maxCandidates: goal.input.maxCandidates,
        candidateTickers: goal.input.candidateTickers,
        userId: goal.input.userId,
        owner: goal.input.owner,
        fleetAgents: goal.input.fleetAgents,
        perkosIdToken: goal.input.perkosIdToken,
      });
      this.record(goal, analysis);
      goal.error = undefined;
      const next = now + goal.cadenceSeconds * 1_000;
      goal.nextEvaluationAt = new Date(
        Math.min(next, Date.parse(goal.endsAt)),
      ).toISOString();
    } catch (error) {
      goal.error =
        error instanceof Error ? error.message : "Goal evaluation failed";
      goal.nextEvaluationAt = new Date(
        Math.min(
          this.now() + goal.cadenceSeconds * 1_000,
          Date.parse(goal.endsAt),
        ),
      ).toISOString();
    } finally {
      goal.running = false;
    }
    await this.persist(goal);
  }

  private record(
    goal: StoredGoal,
    analysis: OpportunityAnalysis,
  ): void {
    goal.latest = analysis;
    goal.cyclesCompleted += 1;
    goal.history.push({
      cycle: goal.cyclesCompleted,
      evaluatedAt: analysis.evaluatedAt,
      recommendedTicker: analysis.recommendedTicker,
      proofRoot: analysis.proofRoot,
      policyManifestHash: analysis.policy.manifestHash,
    });
    if (goal.history.length > 64) {
      goal.history.splice(0, goal.history.length - 64);
    }
  }

  private async persist(goal: StoredGoal): Promise<void> {
    const idToken = goal.input.perkosIdToken;
    if (!idToken || !this.store) return;
    await this.store.save(
      goal.input.owner,
      idToken,
      goal.id,
      persistedGoal(goal),
    );
  }
}

function gateDetail(gate: ReturnType<typeof oneClawGate>): string {
  if (!gate.required) {
    return "This purchase is below the 3 USDG 1Claw threshold.";
  }
  if (gate.linked) {
    return "The trader has an active 1Claw execution rail.";
  }
  return "Analysis may continue, but purchases of 3 USDG or more are locked until the trader has an active 1Claw execution rail.";
}

function publicGoal(goal: StoredGoal): AutonomousGoal {
  const { input: _input, running: _running, ...value } = goal;
  return structuredClone(value);
}

function persistedGoal(goal: StoredGoal): PersistedGoal {
  const { perkosIdToken: _perkosIdToken, ...input } = goal.input;
  return {
    goal: publicGoal(goal),
    input: structuredClone(input),
  };
}

function restoreGoal(
  persisted: PersistedGoal,
  perkosIdToken: string,
): StoredGoal {
  return {
    ...structuredClone(persisted.goal),
    input: {
      ...structuredClone(persisted.input),
      perkosIdToken,
    },
    running: false,
  };
}
