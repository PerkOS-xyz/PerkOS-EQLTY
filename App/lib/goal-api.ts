import type { AutonomousGoal, StartGoalInput } from "./goal-types";

const fallbackUrl = "http://localhost:4021";

function apiUrl(): string {
  return process.env.NEXT_PUBLIC_AGENT_API_URL?.trim() || fallbackUrl;
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
