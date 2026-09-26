import type { ApiConfig } from "./config.js";
import type {
  EvmAddress,
  StockCatalog,
  WalletBuySwap,
} from "./market-types.js";
import { publicErrorMessage } from "./public-error.js";
import type { StockCatalogService } from "./stock-catalog.js";
import { TokenDecimalsReader } from "./token-decimals.js";
import type { DecisionOrigin } from "./uniswap-attribution.js";
import {
  Permit2AllowanceRequiredError,
  quoteProtocols,
  UniswapClient,
} from "./uniswap-client.js";
import { UpstreamBudget } from "./upstream-budget.js";

/**
 * The caller asks for this swap only after its owner approved the order, so
 * the Trading API hears human_mediated.
 */
const decisionOrigin: DecisionOrigin = "human_mediated";

/** USDG, the token every swap spends, answers decimals() with 6 on chain. */
const usdgDecimals = 6;

/**
 * At most this many swaps start per minute, across all callers. Each one
 * sends a Trading API quote and, when that passes, a swap build, on the key
 * live vault swaps also use.
 */
const swapsPerMinute = 60;
/** Each caller's share: a buy takes two (the allowance answer, then the swap). */
const swapsPerClientPerMinute = 12;

const zeroAddress = "0x0000000000000000000000000000000000000000";

export type AgentSwapToken = {
  symbol: string;
  address: EvmAddress;
  decimals: number;
};

export type AgentSwap = {
  chainId: 4663;
  /** The Universal Router the Trading API returned, checked against config. */
  to: EvmAddress;
  data: `0x${string}`;
  value: "0";
  tokenIn: AgentSwapToken;
  tokenOut: AgentSwapToken;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  requestId: string;
  routing: string;
  protocols: string[];
};

/** The on-chain Permit2 allowance a swapper must set before asking again. */
export type Permit2AllowanceNeeded = {
  token: EvmAddress;
  spender: EvmAddress;
  amount: string;
};

export class AgentSwapError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 429 | 502 | 503,
    readonly code: string,
    message: string,
    readonly extra: {
      /** For a 429, the seconds until a new swap can be built. */
      retryAfterSeconds?: number;
      /** For a 409, the allowance to set on chain. */
      allowance?: Permit2AllowanceNeeded;
    } = {},
  ) {
    super(message);
    this.name = "AgentSwapError";
  }
}

type Dependencies = {
  catalog: Pick<StockCatalogService, "catalog">;
  uniswap?: Pick<UniswapClient, "prepareWalletBuy" | "walletSwapReady">;
  decimals?: Pick<TokenDecimalsReader, "decimals" | "ready">;
  now?: () => number;
};

/**
 * Builds the Uniswap swap a desk sends from its owner's wallet once the owner
 * approved the order: USDG from that wallet into one stock token. EQLTY holds
 * no key for that wallet and signs nothing. The vault is never the swapper.
 * Answers are not cached, because a quote is specific to its swapper.
 */
export class AgentSwapService {
  private readonly uniswap: Pick<
    UniswapClient,
    "prepareWalletBuy" | "walletSwapReady"
  >;
  private readonly decimals: Pick<TokenDecimalsReader, "decimals" | "ready">;
  private readonly budget: UpstreamBudget;

  constructor(
    private readonly config: ApiConfig,
    private readonly dependencies: Dependencies,
  ) {
    this.uniswap = dependencies.uniswap ?? new UniswapClient(config);
    this.decimals =
      dependencies.decimals ?? new TokenDecimalsReader(config);
    this.budget = new UpstreamBudget(
      swapsPerMinute,
      60_000,
      dependencies.now ?? Date.now,
      swapsPerClientPerMinute,
    );
  }

  /**
   * amountIn must already be a positive integer string, swapper a 0x address
   * and slippageBps an integer from 1 to 500.
   */
  async swap(input: {
    ticker: string;
    amountIn: string;
    swapper: EvmAddress;
    slippageBps: number;
    /** Who is asking (the client IP), for its share of swap builds. */
    client?: string;
  }): Promise<AgentSwap> {
    const ticker = input.ticker.trim().toUpperCase();
    const limit = this.config.EQLTY_AGENT_SWAP_MAX_AMOUNT;
    if (BigInt(input.amountIn) > BigInt(limit)) {
      throw new AgentSwapError(
        400,
        "amount_above_limit",
        `amountIn is above this server's limit of ${limit} atomic USDG per swap`,
      );
    }
    if (same(input.swapper, zeroAddress)) {
      throw new AgentSwapError(
        400,
        "invalid_swapper",
        "swapper cannot be the zero address",
      );
    }
    const vault = this.config.EQLTY_VAULT_ADDRESS;
    if (vault && same(input.swapper, vault)) {
      throw new AgentSwapError(
        400,
        "invalid_swapper",
        "swapper cannot be the EQLTY vault; this endpoint builds swaps for a wallet that pays with its own USDG",
      );
    }
    if (!this.uniswap.walletSwapReady()) {
      throw new AgentSwapError(
        503,
        "swap_unavailable",
        "Uniswap swaps are not configured on this server",
      );
    }
    if (!this.decimals.ready()) {
      throw new AgentSwapError(
        503,
        "swap_unavailable",
        "The Robinhood Chain RPC that reads token decimals is not configured on this server",
      );
    }
    let catalog: StockCatalog;
    try {
      catalog = await this.dependencies.catalog.catalog();
    } catch (error) {
      throw new AgentSwapError(
        502,
        "catalog_unavailable",
        publicErrorMessage(error, "The stock catalog is unavailable"),
      );
    }
    const asset = catalog.assets.find((entry) => entry.ticker === ticker);
    if (!asset) {
      throw new AgentSwapError(
        404,
        "asset_not_found",
        `${ticker} is not a Robinhood stock token on chain 4663`,
      );
    }
    if (!asset.uniswapRoutable) {
      throw new AgentSwapError(
        404,
        "not_uniswap_routable",
        `${ticker} is not marked Uniswap routable in the stock catalog`,
      );
    }
    // Spent only for a request that can reach Uniswap: junk tickers cost nothing.
    const retryAfterSeconds = this.budget.take(input.client);
    if (retryAfterSeconds > 0) {
      throw new AgentSwapError(
        429,
        "rate_limited",
        `Too many swaps on this server; retry in ${retryAfterSeconds} seconds`,
        { retryAfterSeconds },
      );
    }

    const [swapResult, decimalsResult] = await Promise.allSettled([
      this.uniswap.prepareWalletBuy({
        tokenOut: asset.tokenAddress,
        amount: input.amountIn,
        swapper: input.swapper,
        maxSlippageBps: input.slippageBps,
        decisionOrigin,
      }),
      this.decimals.decimals(asset.tokenAddress),
    ]);
    if (swapResult.status === "rejected") {
      throw swapFailure(swapResult.reason);
    }
    if (decimalsResult.status === "rejected") {
      throw new AgentSwapError(
        502,
        "token_decimals_unavailable",
        `The decimals of ${asset.ticker} could not be read on Robinhood Chain`,
      );
    }
    const built: WalletBuySwap = swapResult.value;

    return {
      chainId: 4663,
      to: built.transaction.to,
      data: built.transaction.data,
      value: "0",
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
      amountIn: input.amountIn,
      amountOut: built.amountOut,
      minAmountOut: built.minAmountOut,
      requestId: built.requestId,
      routing: built.routing,
      protocols: [...quoteProtocols],
    };
  }
}

function swapFailure(error: unknown): AgentSwapError {
  if (error instanceof Permit2AllowanceRequiredError) {
    return new AgentSwapError(
      409,
      "permit2_allowance_required",
      `The swapper has no Permit2 allowance for the Universal Router yet. From the swapper, make sure the token lets Permit2 (${error.permit2}) spend it, call Permit2 approve(token, spender, amount, expiration), then ask again.`,
      {
        allowance: {
          token: error.token,
          spender: error.spender,
          amount: error.amount,
        },
      },
    );
  }
  return new AgentSwapError(
    502,
    "uniswap_swap_failed",
    publicErrorMessage(error, "The Uniswap swap could not be built"),
  );
}

function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
