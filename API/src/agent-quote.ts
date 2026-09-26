import type { ApiConfig } from "./config.js";
import type {
  EvmAddress,
  StockCatalogAsset,
  UniswapQuote,
} from "./market-types.js";
import { publicErrorMessage } from "./public-error.js";
import type { StockCatalogService } from "./stock-catalog.js";
import { TokenDecimalsReader } from "./token-decimals.js";
import type {
  DecisionOrigin,
  UniswapAttribution,
} from "./uniswap-attribution.js";
import { quoteProtocols, UniswapClient } from "./uniswap-client.js";
import { UpstreamBudget } from "./upstream-budget.js";

/**
 * How long an identical (ticker, amountIn) answer is reused, so an agent that
 * asks in a loop cannot spend the Trading API quota.
 */
const agentQuoteCacheSeconds = 20;
/**
 * How long a 404 or 502 for the same (ticker, amountIn) is repeated without
 * asking again. A refusal already spent a Trading API quote, and an agent
 * retries exactly when it gets one.
 */
const agentQuoteFailureSeconds = 10;
const maxCachedAnswers = 256;
/**
 * At most this many uncached quotes start per minute, across all callers.
 * Each one can send two Trading API quotes (the catalog check and the quote
 * itself), plus retries on a 429, on the key live vault swaps also use.
 */
const freshQuotesPerMinute = 120;
/** Each caller's share of those fresh quotes. */
const freshQuotesPerClientPerMinute = 20;

/**
 * Nobody signs in to ask for this price: a desk agent calls the endpoint on its
 * own, so the Trading API hears autonomous. What the agent does with the
 * number still goes through Risk and the owner's hold.
 */
const decisionOrigin: DecisionOrigin = "autonomous";

/** USDG, the token every quote spends, answers decimals() with 6 on chain. */
const usdgDecimals = 6;

export type AgentQuoteToken = {
  symbol: string;
  address: EvmAddress;
  decimals: number;
};

export type AgentQuote = {
  chainId: 4663;
  ticker: string;
  tokenIn: AgentQuoteToken;
  tokenOut: AgentQuoteToken;
  amountIn: string;
  amountOut: string;
  priceImpactPct: number | null;
  /** The Trading API's routing value, or null when it sent none. */
  routing: string | null;
  protocols: string[];
  route: unknown[];
  gasFeeUsd: string | null;
  requestId: string | null;
  quotedAt: string;
  attribution: UniswapAttribution;
};

/** A quote and how many more seconds it may be reused. */
export type AgentQuoteAnswer = {
  quote: AgentQuote;
  maxAgeSeconds: number;
};

export class AgentQuoteError extends Error {
  constructor(
    readonly status: 400 | 404 | 429 | 502 | 503,
    readonly code: string,
    message: string,
    /** For a 429, the seconds until a fresh quote can start. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AgentQuoteError";
  }
}

type Dependencies = {
  catalog: Pick<StockCatalogService, "assessTicker">;
  uniswap?: Pick<UniswapClient, "quote" | "ready">;
  decimals?: Pick<TokenDecimalsReader, "decimals" | "ready">;
  now?: () => number;
};

type CachedAnswer =
  | { expiresAt: number; quote: AgentQuote }
  | { expiresAt: number; error: AgentQuoteError };

/**
 * The price a desk's Quote agent reports: what the Uniswap Trading API quotes
 * for spending amountIn atomic USDG on one stock token. Read only: it never
 * builds a transaction and never signs.
 */
export class AgentQuoteService {
  private readonly uniswap: Pick<UniswapClient, "quote" | "ready">;
  private readonly decimals: Pick<TokenDecimalsReader, "decimals" | "ready">;
  private readonly now: () => number;
  private readonly budget: UpstreamBudget;
  private readonly answers = new Map<string, CachedAnswer>();
  private readonly pending = new Map<string, Promise<CachedAnswer>>();

  constructor(
    private readonly config: ApiConfig,
    private readonly dependencies: Dependencies,
  ) {
    this.uniswap = dependencies.uniswap ?? new UniswapClient(config);
    this.decimals =
      dependencies.decimals ?? new TokenDecimalsReader(config);
    this.now = dependencies.now ?? Date.now;
    this.budget = new UpstreamBudget(
      freshQuotesPerMinute,
      60_000,
      this.now,
      freshQuotesPerClientPerMinute,
    );
  }

  /**
   * amountIn must already be a positive integer string. The limit is the
   * larger of the vault's per-trade cap and the wallet swap cap, so Quote can
   * price any order the desk may send.
   */
  async quote(input: {
    ticker: string;
    amountIn: string;
    /** Who is asking (the client IP), for its share of fresh quotes. */
    client?: string;
  }): Promise<AgentQuoteAnswer> {
    const ticker = input.ticker.trim().toUpperCase();
    const limit = [
      BigInt(this.config.EQLTY_MAX_INPUT_AMOUNT),
      BigInt(this.config.EQLTY_AGENT_SWAP_MAX_AMOUNT),
    ].reduce((larger, cap) => (cap > larger ? cap : larger));
    if (BigInt(input.amountIn) > limit) {
      throw new AgentQuoteError(
        400,
        "amount_above_limit",
        `amountIn is above this server's limit of ${limit} atomic USDG`,
      );
    }
    if (!this.uniswap.ready()) {
      throw new AgentQuoteError(
        503,
        "quote_unavailable",
        "Uniswap quoting is not configured on this server",
      );
    }
    if (!this.decimals.ready()) {
      throw new AgentQuoteError(
        503,
        "quote_unavailable",
        "The Robinhood Chain RPC that reads token decimals is not configured on this server",
      );
    }

    const key = `${ticker}:${input.amountIn}`;
    let answer = this.cached(key);
    if (!answer) {
      let pending = this.pending.get(key);
      if (!pending) {
        const retryAfterSeconds = this.budget.take(input.client);
        if (retryAfterSeconds > 0) {
          throw new AgentQuoteError(
            429,
            "rate_limited",
            `Too many new quotes on this server; retry in ${retryAfterSeconds} seconds`,
            retryAfterSeconds,
          );
        }
        pending = this.fresh(key, ticker, input.amountIn).finally(() => {
          this.pending.delete(key);
        });
        this.pending.set(key, pending);
      }
      answer = await pending;
    }
    if ("error" in answer) {
      throw answer.error;
    }
    return {
      quote: answer.quote,
      maxAgeSeconds: Math.max(
        0,
        Math.ceil((answer.expiresAt - this.now()) / 1_000),
      ),
    };
  }

  private cached(key: string): CachedAnswer | undefined {
    const answer = this.answers.get(key);
    return answer && answer.expiresAt > this.now() ? answer : undefined;
  }

  /** A fresh answer, or a 404 or 502 remembered for a short while. */
  private async fresh(
    key: string,
    ticker: string,
    amountIn: string,
  ): Promise<CachedAnswer> {
    try {
      const answer = await this.ask(ticker, amountIn);
      this.remember(key, answer);
      return answer;
    } catch (error) {
      if (
        error instanceof AgentQuoteError &&
        (error.status === 404 || error.status === 502)
      ) {
        this.remember(key, {
          expiresAt: this.now() + agentQuoteFailureSeconds * 1_000,
          error,
        });
      }
      throw error;
    }
  }

  private async ask(
    ticker: string,
    amountIn: string,
  ): Promise<CachedAnswer> {
    let asset: StockCatalogAsset | undefined;
    try {
      asset = await this.dependencies.catalog.assessTicker(
        ticker,
        decisionOrigin,
      );
    } catch (error) {
      throw new AgentQuoteError(
        502,
        "catalog_unavailable",
        publicErrorMessage(error, "The stock catalog is unavailable"),
      );
    }
    if (!asset) {
      throw new AgentQuoteError(
        404,
        "asset_not_found",
        `${ticker} is not a Robinhood stock token on chain 4663`,
      );
    }
    if (!asset.uniswapRoutable) {
      throw new AgentQuoteError(
        404,
        "not_uniswap_routable",
        `${ticker} has no observed Uniswap route`,
      );
    }

    const [quoteResult, decimalsResult] = await Promise.allSettled([
      this.uniswap.quote(asset.tokenAddress, amountIn, decisionOrigin),
      this.decimals.decimals(asset.tokenAddress),
    ]);
    if (quoteResult.status === "rejected") {
      throw new AgentQuoteError(
        502,
        "uniswap_quote_failed",
        publicErrorMessage(quoteResult.reason, "The Uniswap quote failed"),
      );
    }
    if (decimalsResult.status === "rejected") {
      throw new AgentQuoteError(
        502,
        "token_decimals_unavailable",
        `The decimals of ${asset.ticker} could not be read on Robinhood Chain`,
      );
    }
    const quote: UniswapQuote = quoteResult.value;

    const now = this.now();
    const answer: CachedAnswer = {
      expiresAt: now + agentQuoteCacheSeconds * 1_000,
      quote: {
        chainId: 4663,
        ticker: asset.ticker,
        tokenIn: {
          symbol: "USDG",
          address: this.config.INPUT_TOKEN_ADDRESS as EvmAddress,
          decimals: usdgDecimals,
        },
        tokenOut: {
          symbol: asset.ticker,
          address: asset.tokenAddress,
          decimals: decimalsResult.value,
        },
        amountIn,
        amountOut: quote.amountOut,
        priceImpactPct: quote.priceImpactPct ?? null,
        routing: quote.reportedRouting ?? null,
        protocols: [...quoteProtocols],
        route: quote.route ?? [],
        gasFeeUsd: quote.gasFeeUsd ?? null,
        requestId: quote.requestId ?? null,
        quotedAt: new Date(now).toISOString(),
        attribution: quote.attribution ?? { decisionOrigin, status: null },
      },
    };
    return answer;
  }

  /** Keeps live answers only, and at most maxCachedAnswers of them. */
  private remember(key: string, answer: CachedAnswer): void {
    const now = this.now();
    for (const [storedKey, stored] of this.answers) {
      if (stored.expiresAt <= now) this.answers.delete(storedKey);
    }
    this.answers.delete(key);
    this.answers.set(key, answer);
    while (this.answers.size > maxCachedAnswers) {
      const oldest = this.answers.keys().next().value;
      if (oldest === undefined) break;
      this.answers.delete(oldest);
    }
  }
}
