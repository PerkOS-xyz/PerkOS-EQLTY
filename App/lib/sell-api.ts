import type { Address, Hex } from "viem";

const fallbackUrl = "http://localhost:4021";

export type WalletSwapTransaction = {
  to: Address;
  from: Address;
  data: Hex;
  value: string;
  chainId: 4663;
};

export type WalletSellQuote = {
  chainId: 4663;
  direction: "sell";
  ticker: string;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  amountOut: string;
  requestId: string;
  routing: string;
  quotedAt: string;
  approval?: WalletSwapTransaction;
  permitData?: Record<string, unknown>;
  rawQuote: Record<string, unknown>;
};

export type PreparedWalletSell = {
  amountOut: string;
  requestId: string;
  routing: string;
  rawQuote: Record<string, unknown>;
  transaction: WalletSwapTransaction;
};

export async function requestSellQuote(input: {
  ticker: string;
  tokenIn: Address;
  amountIn: string;
  maxSlippageBps?: number;
}): Promise<WalletSellQuote> {
  return request<WalletSellQuote>("/api/sells/quote", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      maxSlippageBps: input.maxSlippageBps ?? 100,
    }),
  });
}

export async function buildSellTransaction(input: {
  sell: WalletSellQuote;
  signature?: Hex;
}): Promise<PreparedWalletSell> {
  return request<PreparedWalletSell>("/api/sells/swap", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function request<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const api =
    process.env.NEXT_PUBLIC_AGENT_API_URL?.trim() || fallbackUrl;
  const response = await fetch(`${api}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String(body.message)
        : `Sale request failed with status ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}
