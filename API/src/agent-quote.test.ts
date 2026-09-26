import { describe, expect, it, vi } from "vitest";
import { AgentQuoteService } from "./agent-quote.js";
import { loadConfig } from "./config.js";
import type { StockCatalogAsset, UniswapQuote } from "./market-types.js";

const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const nvda = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const start = Date.parse("2026-09-26T12:00:00.000Z");
const route = [
  [
    {
      type: "v4-pool",
      address: "0x1111111111111111111111111111111111111111",
      fee: "3000",
      tickSpacing: "60",
      hooks: "0x0000000000000000000000000000000000000000",
    },
  ],
];

describe("agent quote", () => {
  it("returns the Trading API quote as the Quote agent reads it", async () => {
    const { service, catalog, uniswap, decimals } = setup();

    const answer = await service.quote({
      ticker: "nvda",
      amountIn: "1000000",
    });

    expect(answer).toEqual({
      maxAgeSeconds: 20,
      quote: {
        chainId: 4663,
        ticker: "NVDA",
        tokenIn: { symbol: "USDG", address: usdg, decimals: 6 },
        tokenOut: { symbol: "NVDA", address: nvda, decimals: 18 },
        amountIn: "1000000",
        amountOut: "5500000000000000",
        priceImpactPct: 0.42,
        routing: "CLASSIC",
        protocols: ["V4"],
        route,
        gasFeeUsd: "0.0031",
        requestId: "quote-agent-1",
        quotedAt: "2026-09-26T12:00:00.000Z",
        attribution: { decisionOrigin: "autonomous", status: null },
      },
    });
    expect(catalog.assessTicker).toHaveBeenCalledWith("NVDA", "autonomous");
    expect(uniswap.quote).toHaveBeenCalledWith(
      nvda,
      "1000000",
      "autonomous",
    );
    expect(decimals.decimals).toHaveBeenCalledWith(nvda);
  });

  it("says plainly when the Trading API leaves a field out", async () => {
    // routing is the client's "V4" fallback; the API itself sent none.
    const { service } = setup({
      quote: async () => ({ amountOut: "7", routing: "V4" }),
    });

    const { quote } = await service.quote({
      ticker: "NVDA",
      amountIn: "1000000",
    });

    expect(quote).toMatchObject({
      priceImpactPct: null,
      routing: null,
      route: [],
      gasFeeUsd: null,
      requestId: null,
      attribution: { decisionOrigin: "autonomous", status: null },
    });
  });

  it("surfaces a malformed X-Agent-Info status from the gateway", async () => {
    const { service } = setup({
      quote: async () => ({
        ...liveQuote(),
        attribution: { decisionOrigin: "autonomous", status: "malformed" },
      }),
    });

    const { quote } = await service.quote({
      ticker: "NVDA",
      amountIn: "1000000",
    });

    expect(quote.attribution).toEqual({
      decisionOrigin: "autonomous",
      status: "malformed",
    });
  });

  it("reuses an identical answer for 20 seconds", async () => {
    let now = start;
    const { service, uniswap } = setup({}, () => now);

    const first = await service.quote({ ticker: "NVDA", amountIn: "1000000" });
    now = start + 19_000;
    const second = await service.quote({ ticker: "nvda", amountIn: "1000000" });

    expect(second.quote).toBe(first.quote);
    expect(second.maxAgeSeconds).toBe(1);
    expect(uniswap.quote).toHaveBeenCalledTimes(1);

    now = start + 20_000;
    const third = await service.quote({ ticker: "NVDA", amountIn: "1000000" });

    expect(third.quote.quotedAt).toBe("2026-09-26T12:00:20.000Z");
    expect(third.maxAgeSeconds).toBe(20);
    expect(uniswap.quote).toHaveBeenCalledTimes(2);
  });

  it("asks once for identical questions that arrive together", async () => {
    const { service, uniswap } = setup();

    const answers = await Promise.all([
      service.quote({ ticker: "NVDA", amountIn: "1000000" }),
      service.quote({ ticker: "NVDA", amountIn: "1000000" }),
      service.quote({ ticker: "NVDA", amountIn: "1000000" }),
    ]);

    expect(new Set(answers.map((answer) => answer.quote)).size).toBe(1);
    expect(uniswap.quote).toHaveBeenCalledTimes(1);
  });

  it("quotes a different size separately", async () => {
    const { service, uniswap } = setup();

    await service.quote({ ticker: "NVDA", amountIn: "1000000" });
    await service.quote({ ticker: "NVDA", amountIn: "500000" });

    expect(uniswap.quote).toHaveBeenCalledTimes(2);
    expect(uniswap.quote).toHaveBeenLastCalledWith(
      nvda,
      "500000",
      "autonomous",
    );
  });

  it("refuses an amount above the server limit before asking anyone", async () => {
    const { service, catalog, uniswap } = setup();

    await expect(
      service.quote({ ticker: "NVDA", amountIn: "100000001" }),
    ).rejects.toMatchObject({
      status: 400,
      code: "amount_above_limit",
      message:
        "amountIn is above this server's limit of 100000000 atomic USDG",
    });
    expect(catalog.assessTicker).not.toHaveBeenCalled();
    expect(uniswap.quote).not.toHaveBeenCalled();
  });

  it("allows any size the vault or the wallet swap endpoint may trade", async () => {
    const vaultLarger = setup({
      environment: {
        EQLTY_MAX_INPUT_AMOUNT: "300000000",
        EQLTY_AGENT_SWAP_MAX_AMOUNT: "1000000",
      },
    });
    const walletLarger = setup({
      environment: {
        EQLTY_MAX_INPUT_AMOUNT: "1000000",
        EQLTY_AGENT_SWAP_MAX_AMOUNT: "100000000",
      },
    });

    await expect(
      vaultLarger.service.quote({ ticker: "NVDA", amountIn: "300000000" }),
    ).resolves.toMatchObject({ quote: { amountIn: "300000000" } });
    await expect(
      walletLarger.service.quote({ ticker: "NVDA", amountIn: "100000000" }),
    ).resolves.toMatchObject({ quote: { amountIn: "100000000" } });
    await expect(
      walletLarger.service.quote({ ticker: "NVDA", amountIn: "100000001" }),
    ).rejects.toMatchObject({ status: 400, code: "amount_above_limit" });
  });

  it("refuses a ticker that is not in the stock catalog", async () => {
    const { service, uniswap } = setup({}, undefined, async () => undefined);

    await expect(
      service.quote({ ticker: "ZZZZ", amountIn: "1000000" }),
    ).rejects.toMatchObject({ status: 404, code: "asset_not_found" });
    expect(uniswap.quote).not.toHaveBeenCalled();
  });

  it("refuses a stock token with no observed Uniswap route", async () => {
    const { service, uniswap } = setup({}, undefined, async () =>
      asset({ uniswapRoutable: false }),
    );

    await expect(
      service.quote({ ticker: "NVDA", amountIn: "1000000" }),
    ).rejects.toMatchObject({
      status: 404,
      code: "not_uniswap_routable",
      message: "NVDA has no observed Uniswap route",
    });
    expect(uniswap.quote).not.toHaveBeenCalled();
  });

  it("reports a Trading API failure as a public-safe 502 and repeats it for 10 seconds", async () => {
    let now = start;
    const quote = vi
      .fn<() => Promise<UniswapQuote>>()
      .mockRejectedValueOnce(
        new Error("request body: https://trade-api.gateway.uniswap.org/v1"),
      )
      .mockResolvedValueOnce(liveQuote());
    const { service, catalog } = setup({ quote }, () => now);
    const failure = {
      status: 502,
      code: "uniswap_quote_failed",
      message: "The external provider rejected the request.",
    };

    await expect(
      service.quote({ ticker: "NVDA", amountIn: "1000000" }),
    ).rejects.toMatchObject(failure);
    now = start + 9_000;
    await expect(
      service.quote({ ticker: "NVDA", amountIn: "1000000" }),
    ).rejects.toMatchObject(failure);
    expect(quote).toHaveBeenCalledTimes(1);
    expect(catalog.assessTicker).toHaveBeenCalledTimes(1);

    now = start + 10_000;
    await expect(
      service.quote({ ticker: "NVDA", amountIn: "1000000" }),
    ).resolves.toMatchObject({ quote: { amountOut: "5500000000000000" } });
    expect(quote).toHaveBeenCalledTimes(2);
  });

  it("repeats a not-routable refusal without asking the catalog again", async () => {
    const { service, catalog } = setup({}, undefined, async () =>
      asset({ uniswapRoutable: false }),
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        service.quote({ ticker: "NVDA", amountIn: "1000000" }),
      ).rejects.toMatchObject({ status: 404, code: "not_uniswap_routable" });
    }
    expect(catalog.assessTicker).toHaveBeenCalledTimes(1);
  });

  it("gives each caller 20 new quotes a minute, so one caller cannot starve the others", async () => {
    let now = start;
    const { service, uniswap } = setup({}, () => now);
    for (let amount = 1; amount <= 20; amount += 1) {
      await service.quote({ ticker: "NVDA", amountIn: String(amount), client: "a" });
    }

    now = start + 15_000;
    await expect(
      service.quote({ ticker: "NVDA", amountIn: "21", client: "a" }),
    ).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
      retryAfterSeconds: 45,
    });
    // A cached answer is still served while the caller's share is spent.
    await expect(
      service.quote({ ticker: "NVDA", amountIn: "20", client: "a" }),
    ).resolves.toMatchObject({ quote: { amountIn: "20" } });
    // Another caller keeps its own share.
    await expect(
      service.quote({ ticker: "NVDA", amountIn: "21", client: "b" }),
    ).resolves.toMatchObject({ quote: { amountIn: "21" } });
    expect(uniswap.quote).toHaveBeenCalledTimes(21);

    now = start + 60_000;
    await expect(
      service.quote({ ticker: "NVDA", amountIn: "22", client: "a" }),
    ).resolves.toMatchObject({ quote: { amountIn: "22" } });
  });

  it("still caps the whole server at 120 new quotes a minute", async () => {
    const now = start;
    const { service } = setup({}, () => now);
    for (let amount = 1; amount <= 120; amount += 1) {
      await service.quote({ ticker: "NVDA", amountIn: String(amount), client: `c${amount % 7}` });
    }
    await expect(
      service.quote({ ticker: "NVDA", amountIn: "121", client: "fresh" }),
    ).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("reports the stock token decimals read on chain", async () => {
    const { service } = setup({ decimals: async () => 8 });

    const { quote } = await service.quote({
      ticker: "NVDA",
      amountIn: "1000000",
    });

    expect(quote.tokenOut).toEqual({
      symbol: "NVDA",
      address: nvda,
      decimals: 8,
    });
  });

  it("refuses to report a quote whose token decimals could not be read", async () => {
    const { service } = setup({
      decimals: async () => {
        throw new Error("execution reverted");
      },
    });

    await expect(
      service.quote({ ticker: "NVDA", amountIn: "1000000" }),
    ).rejects.toMatchObject({
      status: 502,
      code: "token_decimals_unavailable",
      message: "The decimals of NVDA could not be read on Robinhood Chain",
    });
  });

  it("says so when the RPC that reads decimals is not configured", async () => {
    const { service, catalog } = setup({ decimalsReady: () => false });

    await expect(
      service.quote({ ticker: "NVDA", amountIn: "1000000" }),
    ).rejects.toMatchObject({ status: 503, code: "quote_unavailable" });
    expect(catalog.assessTicker).not.toHaveBeenCalled();
  });

  it("reports an unavailable stock catalog as a 502", async () => {
    const { service } = setup({}, undefined, async () => {
      throw new Error("Robinhood API failed with status 503");
    });

    await expect(
      service.quote({ ticker: "NVDA", amountIn: "1000000" }),
    ).rejects.toMatchObject({
      status: 502,
      code: "catalog_unavailable",
      message: "Robinhood API failed with status 503",
    });
  });

  it("says so when Uniswap quoting is not configured", async () => {
    const { service, catalog } = setup({ ready: () => false });

    await expect(
      service.quote({ ticker: "NVDA", amountIn: "1000000" }),
    ).rejects.toMatchObject({ status: 503, code: "quote_unavailable" });
    expect(catalog.assessTicker).not.toHaveBeenCalled();
  });
});

function setup(
  overrides: {
    quote?: (...args: never[]) => Promise<UniswapQuote>;
    ready?: () => boolean;
    decimals?: (token: string) => Promise<number>;
    decimalsReady?: () => boolean;
    environment?: NodeJS.ProcessEnv;
  } = {},
  now: () => number = () => start,
  assessTicker: (
    ticker: string,
  ) => Promise<StockCatalogAsset | undefined> = async () => asset(),
) {
  const catalog = { assessTicker: vi.fn(assessTicker) };
  const uniswap = {
    ready: overrides.ready ?? (() => true),
    quote: vi.fn(overrides.quote ?? (async () => liveQuote())),
  };
  const decimals = {
    ready: overrides.decimalsReady ?? (() => true),
    decimals: vi.fn(overrides.decimals ?? (async () => 18)),
  };
  const service = new AgentQuoteService(
    loadConfig({ INPUT_TOKEN_ADDRESS: usdg, ...overrides.environment }),
    { catalog, uniswap, decimals, now },
  );
  return { service, catalog, uniswap, decimals };
}

function liveQuote(): UniswapQuote {
  return {
    amountOut: "5500000000000000",
    requestId: "quote-agent-1",
    routing: "CLASSIC",
    reportedRouting: "CLASSIC",
    priceImpactPct: 0.42,
    route,
    gasFeeUsd: "0.0031",
    attribution: { decisionOrigin: "autonomous", status: null },
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
    uniswapCoverage: "quote_verified",
    quotedAmountIn: "1000000",
    status: "available",
    reasons: [],
    orchestrationReady: true,
    ...overrides,
  };
}
