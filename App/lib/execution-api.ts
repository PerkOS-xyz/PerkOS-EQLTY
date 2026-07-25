import type {
  CreateStrategyInput,
  ExecutionStrategy,
  TradeRun,
} from "./execution-types";

const fallbackUrl = "http://localhost:4021";

export const robinhoodUsdG =
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
export const universalRouter =
  "0x8876789976decbfcbbbe364623c63652db8c0904" as const;

function apiUrl(): string {
  return process.env.NEXT_PUBLIC_AGENT_API_URL?.trim() || fallbackUrl;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String(body.message)
        : body && typeof body === "object" && "error" in body
          ? String(body.error).replaceAll("_", " ")
          : `Execution request failed with status ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export function createExecutionStrategy(
  input: CreateStrategyInput,
): Promise<ExecutionStrategy> {
  return request<ExecutionStrategy>("/api/strategies", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function startProofRun(
  strategy: ExecutionStrategy,
  amountIn: string,
  execute: boolean,
): Promise<TradeRun> {
  return request<TradeRun>("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      strategyId: strategy.id,
      strategy,
      amountIn,
      execute,
    }),
  });
}

export function transactionUrl(hash: string): string {
  return `https://robinhoodchain.blockscout.com/tx/${hash}`;
}

export function graphEvidenceUrl(ticker: string): string {
  return `${apiUrl()}/api/evidence/${encodeURIComponent(ticker)}`;
}
