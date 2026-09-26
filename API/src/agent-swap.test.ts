import { describe, expect, it, vi } from "vitest";
import { AgentSwapService } from "./agent-swap.js";
import { loadConfig } from "./config.js";
import type {
  StockCatalog,
  StockCatalogAsset,
  WalletBuySwap,
} from "./market-types.js";
import { Permit2AllowanceRequiredError } from "./uniswap-client.js";

const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const nvda = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const router = "0x8876789976decbfcbbbe364623c63652db8c0904";
const permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const vault = "0x9999999999999999999999999999999999999999";
const owner = "0x1234567890abcdef1234567890abcdef12345678";
const swapData = `0x3593564c${"00".repeat(32)}` as const;
const start = Date.parse("2026-09-26T12:00:00.000Z");

describe("agent swap", () => {
  it("builds the swap for the owner's wallet as human_mediated", async () => {
    const { service, uniswap, decimals } = setup();

    const swap = await service.swap({
      ticker: "nvda",
      amountIn: "25000000",
      swapper: owner,
      slippageBps: 50,
    });

    expect(swap).toEqual({
      chainId: 4663,
      to: router,
      data: swapData,
      value: "0",
      tokenIn: { symbol: "USDG", address: usdg, decimals: 6 },
      tokenOut: { symbol: "NVDA", address: nvda, decimals: 18 },
      amountIn: "25000000",
      amountOut: "120000000000000000",
      minAmountOut: "119402985074626865",
      requestId: "buy-quote-1",
      routing: "CLASSIC",
      protocols: ["V4"],
    });
    expect(uniswap.prepareWalletBuy).toHaveBeenCalledWith({
      tokenOut: nvda,
      amount: "25000000",
      swapper: owner,
      maxSlippageBps: 50,
      decisionOrigin: "human_mediated",
    });
    expect(decimals.decimals).toHaveBeenCalledWith(nvda);
  });

  it("asks every time, because a quote belongs to its swapper", async () => {
    const { service, uniswap } = setup();
    const input = {
      ticker: "NVDA",
      amountIn: "25000000",
      swapper: owner,
      slippageBps: 50,
    } as const;

    await service.swap(input);
    await service.swap(input);

    expect(uniswap.prepareWalletBuy).toHaveBeenCalledTimes(2);
  });

  it("answers a permit with the allowance to set on chain", async () => {
    const { service } = setup({
      prepareWalletBuy: async () => {
        throw new Permit2AllowanceRequiredError(
          usdg,
          router,
          "25000000",
          permit2,
        );
      },
    });

    await expect(
      service.swap({
        ticker: "NVDA",
        amountIn: "25000000",
        swapper: owner,
        slippageBps: 50,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "permit2_allowance_required",
      message: expect.stringContaining(`Permit2 (${permit2})`),
      extra: {
        allowance: { token: usdg, spender: router, amount: "25000000" },
      },
    });
  });

  it("reports a refused router as a public-safe 502", async () => {
    const { service } = setup({
      prepareWalletBuy: async () => {
        throw new Error(
          `Uniswap returned a transaction for ${vault}, not the configured Universal Router ${router}`,
        );
      },
    });

    await expect(
      service.swap({
        ticker: "NVDA",
        amountIn: "25000000",
        swapper: owner,
        slippageBps: 50,
      }),
    ).rejects.toMatchObject({
      status: 502,
      code: "uniswap_swap_failed",
      message: `Uniswap returned a transaction for ${vault}, not the configured Universal Router ${router}`,
    });
  });

  it("keeps an upstream failure public-safe", async () => {
    const { service } = setup({
      prepareWalletBuy: async () => {
        throw new Error("request body: https://trade-api.gateway.uniswap.org/v1");
      },
    });

    await expect(
      service.swap({
        ticker: "NVDA",
        amountIn: "25000000",
        swapper: owner,
        slippageBps: 50,
      }),
    ).rejects.toMatchObject({
      status: 502,
      code: "uniswap_swap_failed",
      message: "The external provider rejected the request.",
    });
  });

  it("refuses an amount over the wallet swap cap before asking anyone", async () => {
    const { service, catalog, uniswap } = setup();

    await expect(
      service.swap({
        ticker: "NVDA",
        amountIn: "100000001",
        swapper: owner,
        slippageBps: 50,
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "amount_above_limit",
      message:
        "amountIn is above this server's limit of 100000000 atomic USDG per swap",
    });
    expect(catalog.catalog).not.toHaveBeenCalled();
    expect(uniswap.prepareWalletBuy).not.toHaveBeenCalled();
  });

  it("uses its own cap, not the vault's per-trade cap", async () => {
    const { service } = setup({
      environment: {
        EQLTY_MAX_INPUT_AMOUNT: "1000000",
        EQLTY_AGENT_SWAP_MAX_AMOUNT: "5000000",
      },
    });

    await expect(
      service.swap({
        ticker: "NVDA",
        amountIn: "5000000",
        swapper: owner,
        slippageBps: 50,
      }),
    ).resolves.toMatchObject({ amountIn: "5000000" });
    await expect(
      service.swap({
        ticker: "NVDA",
        amountIn: "5000001",
        swapper: owner,
        slippageBps: 50,
      }),
    ).rejects.toMatchObject({ status: 400, code: "amount_above_limit" });
  });

  it.each([
    ["the zero address", "0x0000000000000000000000000000000000000000"],
    ["the EQLTY vault", vault],
  ])("refuses %s as the swapper", async (_label, swapper) => {
    const { service, uniswap } = setup();

    await expect(
      service.swap({
        ticker: "NVDA",
        amountIn: "25000000",
        swapper: swapper as `0x${string}`,
        slippageBps: 50,
      }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_swapper" });
    expect(uniswap.prepareWalletBuy).not.toHaveBeenCalled();
  });

  it("refuses a token the stock catalog does not mark Uniswap routable", async () => {
    const { service, uniswap } = setup({
      assets: [asset({ uniswapRoutable: false })],
    });

    await expect(
      service.swap({
        ticker: "NVDA",
        amountIn: "25000000",
        swapper: owner,
        slippageBps: 50,
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "not_uniswap_routable",
      message: "NVDA is not marked Uniswap routable in the stock catalog",
    });
    expect(uniswap.prepareWalletBuy).not.toHaveBeenCalled();
  });

  it("refuses a ticker that is not in the stock catalog", async () => {
    const { service } = setup();

    await expect(
      service.swap({
        ticker: "ZZZZ",
        amountIn: "25000000",
        swapper: owner,
        slippageBps: 50,
      }),
    ).rejects.toMatchObject({ status: 404, code: "asset_not_found" });
  });

  it("reports an unavailable stock catalog as a 502", async () => {
    const { service } = setup({
      catalog: async () => {
        throw new Error("Robinhood API failed with status 503");
      },
    });

    await expect(
      service.swap({
        ticker: "NVDA",
        amountIn: "25000000",
        swapper: owner,
        slippageBps: 50,
      }),
    ).rejects.toMatchObject({
      status: 502,
      code: "catalog_unavailable",
      message: "Robinhood API failed with status 503",
    });
  });

  it("refuses to answer when the token decimals cannot be read", async () => {
    const { service } = setup({
      decimals: async () => {
        throw new Error("execution reverted");
      },
    });

    await expect(
      service.swap({
        ticker: "NVDA",
        amountIn: "25000000",
        swapper: owner,
        slippageBps: 50,
      }),
    ).rejects.toMatchObject({
      status: 502,
      code: "token_decimals_unavailable",
    });
  });

  it.each([
    ["the Trading API key", { walletSwapReady: () => false }],
    ["the decimals RPC", { decimalsReady: () => false }],
  ])("says so when %s is not configured", async (_label, overrides) => {
    const { service, catalog } = setup(overrides);

    await expect(
      service.swap({
        ticker: "NVDA",
        amountIn: "25000000",
        swapper: owner,
        slippageBps: 50,
      }),
    ).rejects.toMatchObject({ status: 503, code: "swap_unavailable" });
    expect(catalog.catalog).not.toHaveBeenCalled();
  });

  it("gives each caller 12 swap builds a minute and spends none on a ticker it cannot route", async () => {
    let now = start;
    const { service, uniswap } = setup({ now: () => now });
    const input = {
      ticker: "NVDA",
      amountIn: "25000000",
      swapper: owner,
      slippageBps: 50,
      client: "a",
    } as const;
    // Junk tickers are refused before they touch the budget.
    for (let call = 0; call < 30; call += 1) {
      await expect(service.swap({ ...input, ticker: "NOPE" })).rejects.toMatchObject({ status: 404 });
    }
    for (let call = 0; call < 12; call += 1) {
      await service.swap(input);
    }

    now = start + 40_000;
    await expect(service.swap(input)).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
      extra: { retryAfterSeconds: 20 },
    });
    // Another caller keeps its own share.
    await expect(service.swap({ ...input, client: "b" })).resolves.toMatchObject({
      requestId: "buy-quote-1",
    });
    expect(uniswap.prepareWalletBuy).toHaveBeenCalledTimes(13);

    now = start + 60_000;
    await expect(service.swap(input)).resolves.toMatchObject({
      requestId: "buy-quote-1",
    });
  });
});

function setup(
  overrides: {
    prepareWalletBuy?: () => Promise<WalletBuySwap>;
    walletSwapReady?: () => boolean;
    decimals?: () => Promise<number>;
    decimalsReady?: () => boolean;
    catalog?: () => Promise<StockCatalog>;
    assets?: StockCatalogAsset[];
    environment?: NodeJS.ProcessEnv;
    now?: () => number;
  } = {},
) {
  const catalog = {
    catalog: vi.fn(
      overrides.catalog ??
        (async () => stockCatalog(overrides.assets ?? [asset()])),
    ),
  };
  const uniswap = {
    walletSwapReady: overrides.walletSwapReady ?? (() => true),
    prepareWalletBuy: vi.fn(overrides.prepareWalletBuy ?? (async () => built())),
  };
  const decimals = {
    ready: overrides.decimalsReady ?? (() => true),
    decimals: vi.fn(overrides.decimals ?? (async () => 18)),
  };
  const service = new AgentSwapService(
    loadConfig({
      INPUT_TOKEN_ADDRESS: usdg,
      EQLTY_VAULT_ADDRESS: vault,
      UNISWAP_UNIVERSAL_ROUTER_ADDRESS: router,
      ...overrides.environment,
    }),
    { catalog, uniswap, decimals, now: overrides.now ?? (() => start) },
  );
  return { service, catalog, uniswap, decimals };
}

function built(): WalletBuySwap {
  return {
    amountOut: "120000000000000000",
    minAmountOut: "119402985074626865",
    requestId: "buy-quote-1",
    routing: "CLASSIC",
    transaction: {
      to: router,
      from: owner,
      data: swapData,
      value: "0x00",
      chainId: 4663,
    },
    attribution: { decisionOrigin: "human_mediated", status: null },
  };
}

function stockCatalog(assets: StockCatalogAsset[]): StockCatalog {
  return {
    chainId: 4663,
    quoteToken: "USDG",
    quoteAmount: "1000000",
    observedAt: "2026-09-26T12:00:00.000Z",
    thresholds: {
      availableDeviationBps: 100,
      maxDeviationBps: 300,
      maxReferenceAgeSeconds: 86_400,
    },
    summary: {
      total: assets.length,
      available: assets.length,
      caution: 0,
      blocked: 0,
      routed: assets.filter((entry) => entry.uniswapRoutable).length,
      orchestrationReady: 0,
    },
    assets,
  };
}

function asset(
  overrides: Partial<StockCatalogAsset> = {},
): StockCatalogAsset {
  return {
    ticker: "NVDA",
    name: "NVIDIA",
    tokenAddress: nvda,
    multiplier: "1",
    robinhoodStatus: "ACTIVE",
    tradability: "TRADABLE",
    priceSource: "robinhood-price-api",
    referencePrice: 180,
    uniswapRoutable: true,
    uniswapCoverage: "market_observed",
    quotedAmountIn: "1000000",
    status: "available",
    reasons: [],
    orchestrationReady: false,
    ...overrides,
  };
}
