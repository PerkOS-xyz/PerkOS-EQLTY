import type { Address, Hex } from "viem";

const fallbackUrl = "http://localhost:4021";

export type BuyToken = {
  symbol: string;
  address: Address;
  decimals: number;
};

/** GET /api/agent/quote: what spending amountIn USDG on the stock returns now. */
export type WalletBuyQuote = {
  chainId: 4663;
  ticker: string;
  tokenIn: BuyToken;
  tokenOut: BuyToken;
  amountIn: string;
  amountOut: string;
  requestId: string | null;
  quotedAt: string;
};

/** POST /api/agent/swap: unsigned calldata for the owner's wallet to send. */
export type WalletBuySwap = {
  chainId: 4663;
  to: Address;
  data: Hex;
  value: string;
  tokenIn: BuyToken;
  tokenOut: BuyToken;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  requestId: string;
  routing: string;
};

/** The Permit2 allowance the API asks for before it builds a swap (409). */
export type BuyAllowanceRequest = {
  token: Address;
  spender: Address;
  amount: string;
};

export class BuyApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly allowance?: BuyAllowanceRequest,
  ) {
    super(message);
    this.name = "BuyApiError";
  }
}

export function requestBuyQuote(input: {
  ticker: string;
  amountIn: string;
}): Promise<WalletBuyQuote> {
  const query = new URLSearchParams({
    ticker: input.ticker,
    amountIn: input.amountIn,
  });
  return request<WalletBuyQuote>(`/api/agent/quote?${query}`, {
    method: "GET",
  });
}

export function requestBuySwap(input: {
  ticker: string;
  amountIn: string;
  swapper: Address;
  slippageBps: number;
}): Promise<WalletBuySwap> {
  return request<WalletBuySwap>("/api/agent/swap", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const api =
    process.env.NEXT_PUBLIC_AGENT_API_URL?.trim() || fallbackUrl;
  const response = await fetch(`${api}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const fields =
      body && typeof body === "object"
        ? (body as Record<string, unknown>)
        : {};
    const allowance =
      typeof fields.token === "string" &&
      typeof fields.spender === "string" &&
      typeof fields.amount === "string"
        ? {
            token: fields.token as Address,
            spender: fields.spender as Address,
            amount: fields.amount,
          }
        : undefined;
    throw new BuyApiError(
      response.status,
      typeof fields.error === "string" ? fields.error : undefined,
      typeof fields.message === "string"
        ? fields.message
        : `Buy request failed with status ${response.status}`,
      allowance,
    );
  }
  return body as T;
}
