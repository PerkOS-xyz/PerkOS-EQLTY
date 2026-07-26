import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import type { StockCatalogAsset } from "./market-types.js";
import type { UniswapClient } from "./uniswap-client.js";
import { WalletSwapService } from "./wallet-swap.js";

const owner = "0x1234567890abcdef1234567890abcdef12345678";
const amzn = "0x12f190a9F9d7D37a250758b26824B97CE941bF54";
const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

describe("wallet stock sales", () => {
  it("quotes a catalog stock back to USDG", async () => {
    const quote = vi.fn(async () => ({
      chainId: 4663 as const,
      direction: "sell" as const,
      ticker: "AMZN",
      tokenIn: amzn as `0x${string}`,
      tokenOut: usdg as `0x${string}`,
      amountIn: "8598000000000000",
      amountOut: "1990000",
      requestId: "sale-1",
      routing: "CLASSIC",
      quotedAt: "2026-07-25T12:00:00.000Z",
      rawQuote: {},
    }));
    const service = createService({
      prepareWalletSell: quote,
      buildWalletSell: vi.fn(),
    });

    const result = await service.quote({
      owner,
      ticker: "AMZN",
      tokenIn: amzn,
      amountIn: "8598000000000000",
      maxSlippageBps: 100,
    });

    expect(result.amountOut).toBe("1990000");
    expect(quote).toHaveBeenCalledWith({
      ticker: "AMZN",
      tokenIn: amzn,
      amount: "8598000000000000",
      swapper: owner,
      maxSlippageBps: 100,
    });
  });

  it("rejects unknown stock contracts", async () => {
    const uniswap = {
      prepareWalletSell: vi.fn(),
      buildWalletSell: vi.fn(),
    };
    const service = new WalletSwapService(config(), {
      catalog: { assessTicker: async () => asset() },
      uniswap,
    });

    await expect(
      service.quote({
        owner,
        ticker: "AMZN",
        tokenIn: "0x9999999999999999999999999999999999999999",
        amountIn: "1",
        maxSlippageBps: 100,
      }),
    ).rejects.toThrow("does not match the market catalog");
    expect(uniswap.prepareWalletSell).not.toHaveBeenCalled();
  });

  it("rejects stale quotes before building calldata", async () => {
    const build = vi.fn();
    const service = new WalletSwapService(config(), {
      catalog: { assessTicker: async () => asset() },
      uniswap: {
        prepareWalletSell: vi.fn(),
        buildWalletSell: build,
      },
      now: () => new Date("2026-07-25T12:02:00.000Z"),
    });

    await expect(
      service.build({
        owner,
        sell: {
          chainId: 4663,
          direction: "sell",
          ticker: "AMZN",
          tokenIn: amzn,
          tokenOut: usdg,
          amountIn: "8598000000000000",
          amountOut: "1990000",
          requestId: "sale-1",
          routing: "CLASSIC",
          quotedAt: "2026-07-25T12:00:00.000Z",
          rawQuote: {},
        },
      }),
    ).rejects.toThrow("quote expired");
    expect(build).not.toHaveBeenCalled();
  });
});

function createService(
  uniswap: Pick<
    UniswapClient,
    "buildWalletSell" | "prepareWalletSell"
  >,
) {
  return new WalletSwapService(config(), {
    catalog: { assessTicker: async () => asset() },
    uniswap,
    now: () => new Date("2026-07-25T12:00:10.000Z"),
  });
}

function config() {
  return loadConfig({
    INPUT_TOKEN_ADDRESS: usdg,
    UNISWAP_API_KEY: "test-key",
  });
}

function asset(): StockCatalogAsset {
  return {
    ticker: "AMZN",
    name: "Amazon",
    tokenAddress: amzn,
    multiplier: "1",
    robinhoodStatus: "active",
    tradability: "fractional",
    priceSource: "robinhood-price-api",
    uniswapRoutable: true,
    quotedAmountIn: "1000000",
    status: "available",
    reasons: [],
    orchestrationReady: true,
  };
}
