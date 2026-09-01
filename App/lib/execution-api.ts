import type {
  CreateStrategyInput,
  ExecutionStrategy,
  OnchainStrategy,
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

export function linkExecutionStrategy(
  strategy: ExecutionStrategy,
  onchain: OnchainStrategy,
): Promise<ExecutionStrategy> {
  return request<ExecutionStrategy>(
    `/api/strategies/${encodeURIComponent(strategy.id)}/onchain`,
    {
      method: "POST",
      body: JSON.stringify(onchain),
    },
  );
}

export function recoverExecutionStrategy(
  strategy: ExecutionStrategy,
): Promise<ExecutionStrategy | undefined> {
  return request<ExecutionStrategy | undefined>(
    `/api/strategies/${encodeURIComponent(strategy.id)}/recover`,
    {
      method: "POST",
      body: JSON.stringify(strategy),
    },
  );
}

export type ExecutionConfig = {
  network: {
    chainId: number;
  };
  contracts: {
    eqltyVault?: `0x${string}`;
    trader?: `0x${string}`;
  };
  execution: {
    status: "ready" | "pending";
    decisionAuthorization: "live" | "preview";
    protectedPurchases: "enabled" | "blocked";
  };
};

export type WalletReadiness = {
  chainId: 4663;
  network: "Robinhood Chain";
  wallet: `0x${string}`;
  vault: `0x${string}`;
  nativeBalance: string;
  usdGBalance: string;
  amountIn: string;
  ready: boolean;
  checks: {
    gas: boolean;
    funds: boolean;
    vault: boolean;
  };
};

export function readExecutionConfig(): Promise<ExecutionConfig> {
  return request<ExecutionConfig>("/api/config", { method: "GET" });
}

export function readWalletReadiness(
  amountIn: string,
): Promise<WalletReadiness> {
  return request<WalletReadiness>(
    `/api/wallet/readiness?amountIn=${encodeURIComponent(amountIn)}`,
    { method: "GET" },
  );
}

export function startProofRun(
  goalId: string,
  strategy: ExecutionStrategy,
  amountIn: string,
  execute: boolean,
): Promise<TradeRun> {
  return request<TradeRun>("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      goalId,
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

export function transactionEventsUrl(hash: string): string {
  return `${transactionUrl(hash)}?tab=logs`;
}

export function blockUrl(blockNumber: string): string {
  return `https://robinhoodchain.blockscout.com/block/${blockNumber}`;
}

export function addressUrl(address: string): string {
  return `https://robinhoodchain.blockscout.com/address/${address}`;
}

export function graphEvidenceUrl(ticker: string): string {
  return `${apiUrl()}/api/evidence/${encodeURIComponent(ticker)}`;
}

export function loadGraphEvidence(
  ticker: string,
): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(
    `/api/evidence/${encodeURIComponent(ticker)}`,
    { method: "GET" },
  );
}
