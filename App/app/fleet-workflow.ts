import type {
  AgentRole,
  EnsAgentMetadata,
} from "../lib/fleet-types";
import type {
  AutonomousGoal,
  OpportunityAnalysis,
} from "../lib/goal-types";
import type { GoalAnalysisState } from "./use-goal-analysis";

export type WorkflowState =
  | "idle"
  | "checking"
  | "passed"
  | "blocked"
  | "waiting";

export type FleetWorkflow = {
  started: boolean;
  runKey?: string;
  processing: boolean;
  phase: "idle" | "processing" | "monitoring" | "complete" | "blocked";
  analysis?: OpportunityAnalysis;
  session?: AutonomousGoal;
  stopRole?: AgentRole;
  stopReason?: string;
};

export type PolicyCheck = {
  label: string;
  value: string;
  state: "checking" | "passed" | "blocked" | "waiting" | "unavailable";
};

export type TechnologyStep = {
  label: "ENS" | "The Graph" | "Uniswap" | "Proof";
  detail: string;
  state: "checking" | "passed" | "blocked" | "waiting";
};

const roleOrder: AgentRole[] = ["scout", "risk", "trader", "auditor"];

export function workflowFromGoal(goal: GoalAnalysisState): FleetWorkflow {
  if (goal.runKey === 0) {
    return {
      started: false,
      processing: false,
      phase: "idle",
    };
  }
  const session = goal.session;
  const analysis = session?.latest;
  const stop = workflowStop(goal, session, analysis);
  const phase = stop
    ? "blocked"
    : goal.busy
      ? "processing"
      : session?.status === "active"
        ? "monitoring"
        : session
          ? "complete"
          : "processing";

  return {
    started: true,
    runKey: String(goal.runKey),
    processing: phase === "processing" || phase === "monitoring",
    phase,
    analysis,
    session,
    ...stop,
  };
}

export function roleWorkflowState(
  role: AgentRole,
  workflow: FleetWorkflow,
): WorkflowState {
  if (!workflow.started) return "idle";
  if (workflow.stopRole) {
    const roleIndex = roleOrder.indexOf(role);
    const stopIndex = roleOrder.indexOf(workflow.stopRole);
    if (roleIndex < stopIndex) return "passed";
    if (roleIndex === stopIndex) return "blocked";
    return "waiting";
  }
  if (workflow.analysis) return "passed";
  return workflow.processing ? "checking" : "waiting";
}

export function connectorState(
  index: number,
  workflow: FleetWorkflow,
): "idle" | "active" | "passed" | "blocked" {
  if (!workflow.started) return "idle";
  if (workflow.stopRole) {
    const stopIndex = roleOrder.indexOf(workflow.stopRole);
    if (index < stopIndex) return "passed";
    if (index === stopIndex) return "blocked";
    return "idle";
  }
  if (workflow.processing) return "active";
  return "passed";
}

export function policyChecks(
  role: AgentRole,
  metadata: EnsAgentMetadata | undefined,
  loading: boolean,
  error: string | undefined,
  workflow: FleetWorkflow,
  workflowState: WorkflowState,
): PolicyCheck[] {
  const expectedActions: Record<AgentRole, string> = {
    scout: "recommend",
    risk: "risk-gate",
    trader: "swap-uniswap",
    auditor: "audit",
  };
  if (loading || (!metadata && !error)) {
    return ["ENS record", "Inputs", "Agent action", "Spend policy"].map(
      (label) => ({
        label,
        value:
          workflowState === "waiting"
            ? "Waiting for prior gate"
            : "Resolving",
        state: workflowState === "waiting" ? "waiting" : "checking",
      }),
    );
  }
  if (error || !metadata) {
    return [
      {
        label: "ENS record",
        value: error ?? "Metadata unavailable",
        state: "unavailable",
      },
      ...["Inputs", "Agent action", "Spend policy"].map((label) => ({
        label,
        value: "Not evaluated",
        state: "waiting" as const,
      })),
    ];
  }

  const action = expectedActions[role];
  const checks: PolicyCheck[] = [
    {
      label: "ENS record",
      value: metadata.name,
      state:
        workflow.analysis?.policy.source === "local" ? "blocked" : "passed",
    },
    {
      label: "Inputs",
      value: `${metadata.settings.behavior.inputs.length} allowed sources`,
      state: metadata.settings.behavior.inputs.includes("ens")
        ? "passed"
        : "blocked",
    },
    {
      label: "Agent action",
      value: action,
      state: metadata.settings.behavior.actions.includes(action)
        ? "passed"
        : "blocked",
    },
    {
      label: "Spend policy",
      value: metadata.settings.security.enforcement,
      state:
        metadata.settings.security.enforcement === "required-before-spend"
          ? "passed"
          : "blocked",
    },
  ];
  checks.push(runtimeCheck(role, workflow, workflowState));
  if (workflow.stopRole === role && workflow.stopReason) {
    checks.unshift({
      label: "Workflow gate",
      value: workflow.stopReason,
      state: "blocked",
    });
  }
  return checks;
}

export function workflowTechnologySteps(
  workflow: FleetWorkflow,
): TechnologyStep[] {
  const analysis = workflow.analysis;
  const evidenced = analysis?.candidates.filter(
    (candidate) => candidate.orchestrationReady,
  );
  const quoted = analysis?.candidates.filter(
    (candidate) => candidate.uniswapRequestId,
  );
  return [
    {
      label: "ENS",
      detail: analysis
        ? `${analysis.policy.source} policy${
            analysis.policy.version
              ? ` v${analysis.policy.version}`
              : ""
          }`
        : "Resolve agent rules",
      state: analysis
        ? analysis.policy.source === "local" || analysis.policy.paused
          ? "blocked"
          : "passed"
        : workflow.stopRole === "scout"
          ? "blocked"
          : "checking",
    },
    {
      label: "The Graph",
      detail: analysis
        ? `${evidenced?.length ?? 0}/${analysis.candidates.length} candidates indexed`
        : "Substreams market evidence",
      state: !analysis
        ? workflow.stopRole
          ? "waiting"
          : "checking"
        : evidenced && evidenced.length > 0
          ? "passed"
          : "blocked",
    },
    {
      label: "Uniswap",
      detail: analysis
        ? `${quoted?.length ?? 0} live V4 quotes`
        : "Build Robinhood V4 routes",
      state: !analysis
        ? "waiting"
        : quoted && quoted.length > 0
          ? "passed"
          : "blocked",
    },
    {
      label: "Proof",
      detail: analysis
        ? `${analysis.proofRoot.slice(0, 10)}…${analysis.proofRoot.slice(-6)}`
        : "Seal the cycle evidence",
      state: analysis
        ? "passed"
        : workflow.stopRole === "auditor"
          ? "blocked"
          : "waiting",
    },
  ];
}

export function policyResultLabel(checks: PolicyCheck[]): string {
  if (checks.some((check) => check.state === "blocked")) return "Blocked";
  if (checks.some((check) => check.state === "unavailable")) {
    return "Unavailable";
  }
  if (checks.every((check) => check.state === "passed")) return "Rules pass";
  if (checks.some((check) => check.state === "checking")) return "Checking";
  return "Waiting";
}

export function workflowStateCopy(state: WorkflowState): string {
  return {
    idle: "Online",
    checking: "Processing",
    passed: "Validated",
    blocked: "Stopped",
    waiting: "Waiting",
  }[state];
}

export function workflowHeadline(workflow: FleetWorkflow): string {
  if (workflow.stopRole) {
    return `Stopped at ${workflow.stopRole}`;
  }
  if (workflow.phase === "processing") {
    return "Resolving ENS rules and market evidence";
  }
  if (workflow.phase === "monitoring") {
    return workflow.analysis
      ? "Fleet monitoring the next evaluation"
      : "First evaluation in progress";
  }
  return "All four Hermes handoffs verified";
}

function runtimeCheck(
  role: AgentRole,
  workflow: FleetWorkflow,
  workflowState: WorkflowState,
): PolicyCheck {
  if (!workflow.analysis) {
    return {
      label:
        role === "trader"
          ? "Uniswap route"
          : role === "auditor"
            ? "Proof root"
            : "Graph evidence",
      value:
        workflowState === "waiting"
          ? "Waiting for prior gate"
          : "Processing live data",
      state: workflowState === "waiting" ? "waiting" : "checking",
    };
  }
  const analysis = workflow.analysis;
  const handoff = analysis.consultation[role];
  if (handoff.status !== "verified") {
    return {
      label: "Hermes handoff",
      value: handoff.detail ?? `${role} response was not verified`,
      state: "blocked",
    };
  }
  const evidenced = analysis.candidates.filter(
    (candidate) => candidate.orchestrationReady,
  );
  if (role === "scout") {
    return {
      label: "Hermes handoff",
      value: `${handoff.agentName ?? "Scout"} · ${shortHash(handoff.responseHash)}`,
      state: "passed",
    };
  }
  if (role === "risk") {
    return {
      label: "Hermes handoff",
      value: `${handoff.agentName ?? "Risk"} · ${evidenced.length} passed`,
      state: "passed",
    };
  }
  if (role === "trader") {
    const quoted = analysis.candidates.filter(
      (candidate) => candidate.uniswapRequestId,
    );
    return {
      label: "Hermes handoff",
      value: `${handoff.agentName ?? "Trader"} · ${quoted.length} V4 routes`,
      state: "passed",
    };
  }
  return {
    label: "Hermes handoff",
    value: `${handoff.agentName ?? "Auditor"} · ${shortHash(handoff.responseHash)}`,
    state: "passed",
  };
}

function workflowStop(
  goal: GoalAnalysisState,
  session?: AutonomousGoal,
  analysis?: OpportunityAnalysis,
): Pick<FleetWorkflow, "stopRole" | "stopReason"> | undefined {
  if (goal.workflowError) {
    return { stopRole: "scout", stopReason: goal.workflowError };
  }
  if (session?.error) {
    return { stopRole: "scout", stopReason: session.error };
  }
  if (analysis?.policy.paused) {
    return {
      stopRole: "scout",
      stopReason: `ENS policy ${
        analysis.policy.version ? `v${analysis.policy.version} ` : ""
      }paused fleet activity.`,
    };
  }
  if (analysis) {
    for (const role of roleOrder) {
      const handoff = analysis.consultation[role];
      if (handoff.status !== "verified") {
        return {
          stopRole: role,
          stopReason:
            handoff.detail ??
            `${role} Hermes handoff was not verified; the deterministic fallback cannot authorize execution.`,
        };
      }
    }
  }
  if (
    analysis?.recommendedTicker &&
    session &&
    !session.gates.executionAuthorized
  ) {
    return {
      stopRole: "trader",
      stopReason: session.gates.detail,
    };
  }
  if (analysis && !analysis.recommendedTicker) {
    return {
      stopRole: "risk",
      stopReason:
        analysis.candidates.find(
          (candidate) => candidate.status === "rejected",
        )?.reason ?? "No candidate passed the active ENS and market rules.",
    };
  }
  if (session?.status === "blocked") {
    return {
      stopRole: "auditor",
      stopReason: "The workflow was blocked before proof completion.",
    };
  }
  return undefined;
}

function shortHash(value?: string): string {
  if (!value) return "verified";
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
