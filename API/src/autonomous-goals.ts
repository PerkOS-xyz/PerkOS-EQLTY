import { randomUUID } from "node:crypto";
import type {
  AutonomousGoal,
  GoalIdentity,
  GoalInput,
  OpportunityAnalysis,
} from "./goal-types.js";
import type { FleetRole } from "./fleet-types.js";
import { fleetRoles } from "./fleet-types.js";
import type { OpportunityAnalysisService } from "./opportunity-analysis.js";

type StoredGoal = AutonomousGoal & {
  input: GoalInput;
  running: boolean;
};

type Dependencies = {
  now?: () => number;
  id?: () => string;
};

export class AutonomousGoalService {
  private readonly goals = new Map<string, StoredGoal>();
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    private readonly opportunities: Pick<
      OpportunityAnalysisService,
      "analyze"
    >,
    dependencies: Dependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.id = dependencies.id ?? randomUUID;
  }

  async start(input: GoalInput): Promise<AutonomousGoal> {
    const startedAt = this.now();
    const requiredRoles = fleetRoles.map(
      ({ role }) => role,
    ) as FleetRole[];
    const linkedRoles = requiredRoles.filter((role) =>
      input.linkedRoles.includes(role),
    );
    const executionAuthorized = requiredRoles.every((role) =>
      linkedRoles.includes(role),
    );
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
        executionAuthorized,
        detail: executionAuthorized
          ? "Every fleet role has an active 1Claw security link."
          : "Analysis may continue, but execution is locked until every fleet role has an active 1Claw security link.",
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
    const goal = this.ownedGoal(id, identity);
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
    const goal = this.ownedGoal(id, identity);
    if (!goal) return undefined;
    await this.evaluate(goal);
    return publicGoal(goal);
  }

  private ownedGoal(
    id: string,
    identity: GoalIdentity,
  ): StoredGoal | undefined {
    const goal = this.goals.get(id);
    if (
      !goal ||
      goal.input.userId !== identity.userId ||
      goal.input.owner.toLowerCase() !== identity.owner.toLowerCase()
    ) {
      return undefined;
    }
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
}

function publicGoal(goal: StoredGoal): AutonomousGoal {
  const { input: _input, running: _running, ...value } = goal;
  return structuredClone(value);
}
