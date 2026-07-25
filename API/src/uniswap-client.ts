import type { ApiConfig } from "./config.js";
import type {
  EvmAddress,
  UniswapQuote,
} from "./market-types.js";

const maxAttempts = 3;

export class UniswapClient {
  constructor(
    private readonly config: ApiConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  ready(): boolean {
    return Boolean(
      this.config.UNISWAP_API_KEY &&
        this.config.SWAPPER_ADDRESS,
    );
  }

  async quote(
    tokenOut: EvmAddress,
    amount: string,
  ): Promise<UniswapQuote> {
    if (!this.config.UNISWAP_API_KEY || !this.config.SWAPPER_ADDRESS) {
      throw new Error("Uniswap quoting is not configured");
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await this.fetchFn(
        `${this.config.UNISWAP_API_URL}/quote`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-api-key": this.config.UNISWAP_API_KEY,
            "x-universal-router-version": "2.1.1",
          },
          body: JSON.stringify({
            tokenIn: this.config.INPUT_TOKEN_ADDRESS,
            tokenOut,
            amount,
            type: "EXACT_INPUT",
            swapper: this.config.SWAPPER_ADDRESS,
            tokenInChainId: 4663,
            tokenOutChainId: 4663,
            slippageTolerance: 1,
            routingPreference: "BEST_PRICE",
            protocols: ["V4"],
            permitAmount: "EXACT",
          }),
          signal: AbortSignal.timeout(12_000),
        },
      );

      if (response.status === 429 && attempt < maxAttempts) {
        await response.body?.cancel();
        await wait(retryDelay(response, attempt));
        continue;
      }

      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        throw new Error(`Uniswap quote failed with status ${response.status}`);
      }
      return parseQuote(body, response.headers.get("x-request-id"));
    }

    throw new Error("Uniswap quote retry limit reached");
  }
}

function parseQuote(
  body: unknown,
  headerRequestId: string | null,
): UniswapQuote {
  if (!isRecord(body)) {
    throw new Error("Uniswap quote response is invalid");
  }
  const quote = isRecord(body.quote) ? body.quote : {};
  const output = isRecord(quote.output) ? quote.output : {};
  const amountOut = String(output.amount ?? quote.amountOut ?? "");

  if (!/^[1-9]\d*$/.test(amountOut)) {
    throw new Error("Uniswap quote returned no output amount");
  }

  const requestId =
    headerRequestId ||
    (typeof body.requestId === "string" ? body.requestId : undefined);
  const routing =
    typeof body.routing === "string"
      ? body.routing
      : typeof quote.routing === "string"
        ? quote.routing
        : "V4";

  return {
    amountOut,
    requestId,
    routing,
  };
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter * 1_000, 3_000)
    : attempt * 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
