import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import type { PurchaseHistory } from "./purchase-history.js";
import {
  PortfolioService,
  type BalanceSnapshot,
} from "./portfolio.js";

const owner =
  "0x1234567890abcdef1234567890abcdef12345678" as const;
const nvda =
  "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" as const;
const amzn =
  "0x1111111111111111111111111111111111111111" as const;

describe("PortfolioService", () => {
  it("combines wallet balances, current prices and verified purchase cost", async () => {
    const history: PurchaseHistory = {
      source: "robinhood-chain",
      status: "ready",
      vault: "0x2222222222222222222222222222222222222222",
      entries: [
        {
          id: "purchase-1",
          status: "executed",
          strategyId: "1",
          nonce: "0",
          ticker: "NVDA",
          inputToken:
            "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
          outputToken: nvda,
          amountIn: "1000000",
          amountOut: "500000000000000000",
          router: "0x3333333333333333333333333333333333333333",
          signalHash: `0x${"11".repeat(32)}`,
          quoteHash: `0x${"22".repeat(32)}`,
          transactionHash: `0x${"33".repeat(32)}`,
          blockNumber: "10",
          executedAt: "2026-07-25T12:00:00.000Z",
        },
      ],
    };
    const balances: BalanceSnapshot = {
      checkedTokens: 2,
      unreadableTokens: 0,
      balances: [
        {
          token: nvda,
          rawBalance: "500000000000000000",
          decimals: 18,
        },
        {
          token: amzn,
          rawBalance: "1000000000000000000",
          decimals: 18,
        },
      ],
    };
    const service = new PortfolioService(
      loadConfig({
        ROBINHOOD_MAINNET_RPC_URL: "https://rpc.example.com",
      }),
      {
        history: { list: async () => history },
        catalog: {
          catalog: async () => ({
            chainId: 4663,
            quoteToken: "USDG",
            quoteAmount: "1000000",
            observedAt: "2026-07-25T12:01:00.000Z",
            thresholds: {
              availableDeviationBps: 100,
              maxDeviationBps: 300,
              maxReferenceAgeSeconds: 86_400,
            },
            summary: {
              total: 2,
              available: 2,
              caution: 0,
              blocked: 0,
              routed: 2,
              orchestrationReady: 2,
            },
            assets: [
              asset("NVDA", "NVIDIA", nvda, 3),
              asset("AMZN", "Amazon", amzn, 10),
            ],
          }),
        },
        balances: { read: async () => balances },
      },
    );

    const portfolio = await service.read(owner);

    expect(portfolio.status).toBe("ready");
    expect(portfolio.summary).toEqual({
      positions: 2,
      marketValueUsd: 11.5,
      costBasisUsd: 1,
      unrealizedGainUsd: 0.5,
    });
    expect(portfolio.holdings).toEqual([
      expect.objectContaining({
        ticker: "AMZN",
        balance: "1",
        currentPriceUsd: 10,
        costStatus: "unavailable",
      }),
      expect.objectContaining({
        ticker: "NVDA",
        balance: "0.5",
        currentPriceUsd: 3,
        averageCostUsd: 2,
        marketValueUsd: 1.5,
        costBasisUsd: 1,
        unrealizedGainUsd: 0.5,
        unrealizedGainPercent: 50,
        costStatus: "verified",
      }),
    ]);
  });

  it("marks cost as partial when the wallet holds untracked tokens", async () => {
    const history = {
      source: "robinhood-chain" as const,
      status: "ready" as const,
      entries: [
        {
          id: "purchase-1",
          status: "executed" as const,
          strategyId: "1",
          nonce: "0",
          inputToken:
            "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const,
          outputToken: nvda,
          amountIn: "1000000",
          amountOut: "500000000000000000",
          router:
            "0x3333333333333333333333333333333333333333" as const,
          signalHash: `0x${"11".repeat(32)}` as const,
          quoteHash: `0x${"22".repeat(32)}` as const,
          transactionHash: `0x${"33".repeat(32)}` as const,
          blockNumber: "10",
          executedAt: "2026-07-25T12:00:00.000Z",
        },
      ],
    };
    const service = new PortfolioService(
      loadConfig({
        ROBINHOOD_MAINNET_RPC_URL: "https://rpc.example.com",
      }),
      {
        history: { list: async () => history },
        catalog: {
          catalog: async () => ({
            chainId: 4663,
            quoteToken: "USDG",
            quoteAmount: "1000000",
            observedAt: "2026-07-25T12:01:00.000Z",
            thresholds: {
              availableDeviationBps: 100,
              maxDeviationBps: 300,
              maxReferenceAgeSeconds: 86_400,
            },
            summary: {
              total: 1,
              available: 1,
              caution: 0,
              blocked: 0,
              routed: 1,
              orchestrationReady: 1,
            },
            assets: [asset("NVDA", "NVIDIA", nvda, 3)],
          }),
        },
        balances: {
          read: async () => ({
            checkedTokens: 1,
            unreadableTokens: 0,
            balances: [
              {
                token: nvda,
                rawBalance: "1000000000000000000",
                decimals: 18,
              },
            ],
          }),
        },
      },
    );

    const portfolio = await service.read(owner);

    expect(portfolio.holdings[0]).toMatchObject({
      costStatus: "partial",
      averageCostUsd: 2,
    });
    expect(portfolio.holdings[0]?.costBasisUsd).toBeUndefined();
    expect(portfolio.holdings[0]?.unrealizedGainUsd).toBeUndefined();
  });

  it("reports pending until the Robinhood RPC is configured", async () => {
    const service = new PortfolioService(loadConfig({}), {
      history: {
        list: async () => {
          throw new Error("not called");
        },
      },
      catalog: {
        catalog: async () => {
          throw new Error("not called");
        },
      },
    });

    await expect(service.read(owner)).resolves.toMatchObject({
      status: "pending",
      holdings: [],
    });
  });
});

function asset(
  ticker: string,
  name: string,
  tokenAddress: `0x${string}`,
  referencePrice: number,
) {
  return {
    ticker,
    name,
    tokenAddress,
    multiplier: "1",
    robinhoodStatus: "ACTIVE",
    tradability: "TRADABLE",
    priceSource: "robinhood-price-api" as const,
    referencePrice,
    referenceUpdatedAt: "2026-07-25T12:00:00.000Z",
    uniswapRoutable: true,
    uniswapRouting: "CLASSIC",
    quotedAmountIn: "1000000",
    status: "available" as const,
    reasons: [],
    orchestrationReady: true,
  };
}
