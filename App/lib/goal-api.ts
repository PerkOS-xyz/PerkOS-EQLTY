import type {
  AutonomousGoal,
  DecisionFeePaymentPayload,
  StartGoalInput,
} from "./goal-types";

const fallbackUrl = "http://localhost:4021";

export type DecisionFeeConfig = {
  mode: "preview" | "live";
  scheme: "exact";
  maximumAmount: string;
  completeAmount: string;
  noCandidateAmount: string;
  decimals: 6;
  symbol: "USDG";
};

function apiUrl(): string {
  return process.env.NEXT_PUBLIC_AGENT_API_URL?.trim() || fallbackUrl;
}

export function goalDecisionFeeResource(goalId: string): string {
  return `${apiUrl()}/api/goals/${encodeURIComponent(goalId)}/decision-fee`;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${apiUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    signal,
  });
  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String(body.message)
        : `Goal request failed with status ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export function startGoal(input: StartGoalInput): Promise<AutonomousGoal> {
  return request<AutonomousGoal>("/api/goals", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function readDecisionFeeConfig(): Promise<DecisionFeeConfig> {
  const config = await request<{ decisionFee?: DecisionFeeConfig }>(
    "/api/config",
  );
  if (!config.decisionFee) {
    throw new Error("Decision fee configuration is unavailable");
  }
  return config.decisionFee;
}

export function readGoal(
  goalId: string,
  signal?: AbortSignal,
): Promise<AutonomousGoal> {
  return request<AutonomousGoal>(
    `/api/goals/${encodeURIComponent(goalId)}`,
    undefined,
    signal,
  );
}

export function evaluateGoal(goalId: string): Promise<AutonomousGoal> {
  return request<AutonomousGoal>(
    `/api/goals/${encodeURIComponent(goalId)}/tick`,
    { method: "POST" },
  );
}

export function settleGoalDecisionFee(
  goalId: string,
  payment: DecisionFeePaymentPayload,
): Promise<AutonomousGoal> {
  return request<AutonomousGoal>(
    `/api/goals/${encodeURIComponent(goalId)}/decision-fee`,
    {
      method: "POST",
      body: JSON.stringify(payment),
    },
  );
}
