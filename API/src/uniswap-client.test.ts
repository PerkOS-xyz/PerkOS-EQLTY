import { encodeFunctionData } from "viem";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { UniswapClient } from "./uniswap-client.js";

const vault = "0x9999999999999999999999999999999999999999";
const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const nvda = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const router = "0x8876789976decbfcbbbe364623c63652db8c0904";
const permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const riskKey = `0x${"11".repeat(32)}`;
const approveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

describe("Uniswap execution preparation", () => {
  it("signs an exact Permit2 quote and returns guarded calldata", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(quoteBody(), {
          "x-request-id": "quote-live-1",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          swap: {
            to: router,
            from: vault,
            data: "0x1234",
            value: "0x00",
            chainId: 4663,
          },
        }),
      );
    const client = new UniswapClient(config(), fetchFn);

    const prepared = await client.prepareSwap({
      tokenOut: nvda,
      amount: "1000000",
      maxSlippageBps: 100,
    });

    expect(prepared).toMatchObject({
      amountOut: "4800000000000000",
      requestId: "quote-live-1",
      routing: "CLASSIC",
      transaction: {
        to: router,
        from: vault,
        data: "0x1234",
        value: "0x00",
        chainId: 4663,
      },
    });
    const swapRequest = JSON.parse(
      String(fetchFn.mock.calls[1]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(swapRequest.quote).toBeDefined();
    expect(swapRequest.permitData).toBeDefined();
    expect(swapRequest.signature).toMatch(/^0x[0-9a-f]+$/);
  });

  it("rejects a quote that sends output outside the vault", async () => {
    const invalid = quoteBody();
    (
      invalid.quote.output as Record<string, unknown>
    ).recipient = "0x8888888888888888888888888888888888888888";
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(invalid, {
          "x-request-id": "quote-live-2",
        }),
      );
    const client = new UniswapClient(config(), fetchFn);

    await expect(
      client.prepareSwap({
        tokenOut: nvda,
        amount: "1000000",
        maxSlippageBps: 100,
      }),
    ).rejects.toThrow("does not return to the vault");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("rejects native value in the generated transaction", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(quoteBody(), {
          "x-request-id": "quote-live-3",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          swap: {
            to: router,
            from: vault,
            data: "0x1234",
            value: "0x01",
            chainId: 4663,
          },
        }),
      );
    const client = new UniswapClient(config(), fetchFn);

    await expect(
      client.prepareSwap({
        tokenOut: nvda,
        amount: "1000000",
        maxSlippageBps: 100,
      }),
    ).rejects.toThrow("cannot include native value");
  });
});

describe("Uniswap wallet sales", () => {
  const owner = "0x1234567890abcdef1234567890abcdef12345678";

  it("prepares approval, quote and wallet swap calldata", async () => {
    const approval = {
      to: nvda,
      from: owner,
      data: encodeFunctionData({
        abi: approveAbi,
        functionName: "approve",
        args: [permit2, 5_000_000_000_000_000n],
      }),
      value: "0",
      chainId: 4663,
    };
    const saleQuote = quoteBody({
      swapper: owner,
      tokenIn: nvda,
      tokenOut: usdg,
      amountIn: "5000000000000000",
      amountOut: "1040000",
    });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ approval, cancel: null }))
      .mockResolvedValueOnce(
        jsonResponse(saleQuote, { "x-request-id": "sale-quote-1" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          swap: {
            to: router,
            from: owner,
            data: "0xabcd",
            value: "0",
            chainId: 4663,
          },
        }),
      );
    const client = new UniswapClient(config(), fetchFn);
    const sell = await client.prepareWalletSell({
      ticker: "NVDA",
      tokenIn: nvda,
      amount: "5000000000000000",
      swapper: owner,
      maxSlippageBps: 100,
    });

    expect(sell).toMatchObject({
      direction: "sell",
      ticker: "NVDA",
      amountOut: "1040000",
      approval,
      requestId: "sale-quote-1",
    });
    const prepared = await client.buildWalletSell({
      sell,
      swapper: owner,
      signature: `0x${"12".repeat(65)}`,
    });
    expect(prepared.transaction).toEqual({
      to: router,
      from: owner,
      data: "0xabcd",
      value: "0",
      chainId: 4663,
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("rejects an approval for a noncanonical spender", async () => {
    const approval = {
      to: nvda,
      from: owner,
      data: encodeFunctionData({
        abi: approveAbi,
        functionName: "approve",
        args: [router, 5_000_000_000_000_000n],
      }),
      value: "0",
      chainId: 4663,
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ approval, cancel: null }));

    await expect(
      new UniswapClient(config(), fetchFn).prepareWalletSell({
        ticker: "NVDA",
        tokenIn: nvda,
        amount: "5000000000000000",
        swapper: owner,
        maxSlippageBps: 100,
      }),
    ).rejects.toThrow("not canonical Permit2");
  });

  it("rejects a sale quote that returns USDG elsewhere", async () => {
    const invalid = quoteBody({
      swapper: owner,
      tokenIn: nvda,
      tokenOut: usdg,
      amountIn: "5000000000000000",
      amountOut: "1040000",
    });
    (
      invalid.quote.output as Record<string, unknown>
    ).recipient = vault;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ approval: null, cancel: null }),
      )
      .mockResolvedValueOnce(
        jsonResponse(invalid, { "x-request-id": "sale-quote-2" }),
      );

    await expect(
      new UniswapClient(config(), fetchFn).prepareWalletSell({
        ticker: "NVDA",
        tokenIn: nvda,
        amount: "5000000000000000",
        swapper: owner,
        maxSlippageBps: 100,
      }),
    ).rejects.toThrow("does not return to the wallet");
  });
});

function config() {
  return loadConfig({
    UNISWAP_API_KEY: "test-key",
    SWAPPER_ADDRESS: vault,
    EQLTY_VAULT_ADDRESS: vault,
    EQLTY_RISK_SIGNER_PRIVATE_KEY: riskKey,
    INPUT_TOKEN_ADDRESS: usdg,
    UNISWAP_UNIVERSAL_ROUTER_ADDRESS: router,
    UNISWAP_PERMIT2_ADDRESS: permit2,
  });
}

function quoteBody(
  overrides: {
    swapper?: string;
    tokenIn?: string;
    tokenOut?: string;
    amountIn?: string;
    amountOut?: string;
  } = {},
) {
  const swapper = overrides.swapper ?? vault;
  const tokenIn = overrides.tokenIn ?? usdg;
  const tokenOut = overrides.tokenOut ?? nvda;
  const amountIn = overrides.amountIn ?? "1000000";
  const amountOut = overrides.amountOut ?? "4800000000000000";
  return {
    routing: "CLASSIC",
    quote: {
      swapper,
      chainId: 4663,
      tokenInChainId: 4663,
      tokenOutChainId: 4663,
      input: {
        token: tokenIn,
        amount: amountIn,
      },
      output: {
        token: tokenOut,
        amount: amountOut,
        recipient: swapper,
      },
    },
    permitData: {
      domain: {
        name: "Permit2",
        chainId: 4663,
        verifyingContract: permit2,
      },
      types: {
        PermitDetails: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint160" },
          { name: "expiration", type: "uint48" },
          { name: "nonce", type: "uint48" },
        ],
        PermitSingle: [
          { name: "details", type: "PermitDetails" },
          { name: "spender", type: "address" },
          { name: "sigDeadline", type: "uint256" },
        ],
      },
      values: {
        details: {
          token: tokenIn,
          amount: amountIn,
          expiration: "1780000000",
          nonce: "0",
        },
        spender: router,
        sigDeadline: "1780000000",
      },
    },
  };
}

function jsonResponse(
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

describe("Uniswap agent attribution", () => {
  const humanHeader =
    '{"decision_origin":"human_mediated","integration_name":"eqlty"}';
  const owner = "0x1234567890abcdef1234567890abcdef12345678";
  const route = [[{ type: "v4-pool", address: vault, fee: "3000" }]];

  it("sends human_mediated by default and returns the quote details", async () => {
    const body = quoteBody();
    Object.assign(body.quote, {
      priceImpact: 0.42,
      route,
      gasFeeUSD: "0.0031",
    });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(body, { "x-request-id": "quote-agent-1" }),
      );

    const quote = await new UniswapClient(config(), fetchFn).quote(
      nvda,
      "1000000",
    );

    expect(quote).toEqual({
      amountOut: "4800000000000000",
      requestId: "quote-agent-1",
      routing: "CLASSIC",
      priceImpactPct: 0.42,
      route,
      gasFeeUsd: "0.0031",
      reportedRouting: "CLASSIC",
      attribution: { decisionOrigin: "human_mediated", status: null },
    });
    expect(sentHeaders(fetchFn, 0)["x-agent-info"]).toBe(humanHeader);
    expect(sentBody(fetchFn, 0)).toMatchObject({
      routingPreference: "BEST_PRICE",
      protocols: ["V4"],
    });
  });

  it("carries autonomous from the caller and surfaces the gateway status", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(quoteBody(), {
        "x-request-id": "quote-agent-2",
        "x-agent-info-status": "malformed",
      }),
    );

    const quote = await new UniswapClient(config(), fetchFn).quote(
      nvda,
      "1000000",
      "autonomous",
    );

    expect(sentHeaders(fetchFn, 0)["x-agent-info"]).toBe(
      '{"decision_origin":"autonomous","integration_name":"eqlty"}',
    );
    expect(quote.attribution).toEqual({
      decisionOrigin: "autonomous",
      status: "malformed",
    });
  });

  it("keeps the status on a prepared vault swap", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(quoteBody(), { "x-request-id": "quote-live-4" }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            swap: {
              to: router,
              from: vault,
              data: "0x1234",
              value: "0x00",
              chainId: 4663,
            },
          },
          { "x-agent-info-status": "malformed" },
        ),
      );

    const prepared = await new UniswapClient(config(), fetchFn).prepareSwap({
      tokenOut: nvda,
      amount: "1000000",
      maxSlippageBps: 100,
    });

    expect(sentHeaders(fetchFn, 0)["x-agent-info"]).toBe(humanHeader);
    expect(sentHeaders(fetchFn, 1)["x-agent-info"]).toBe(humanHeader);
    expect(prepared.attribution).toEqual({
      decisionOrigin: "human_mediated",
      status: "malformed",
    });
  });

  it("sends the header on every call of a wallet sale", async () => {
    const saleQuote = quoteBody({
      swapper: owner,
      tokenIn: nvda,
      tokenOut: usdg,
      amountIn: "5000000000000000",
      amountOut: "1040000",
    });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ approval: null, cancel: null }))
      .mockResolvedValueOnce(
        jsonResponse(saleQuote, { "x-request-id": "sale-quote-3" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          swap: {
            to: router,
            from: owner,
            data: "0xabcd",
            value: "0",
            chainId: 4663,
          },
        }),
      );
    const client = new UniswapClient(config(), fetchFn);

    const sell = await client.prepareWalletSell({
      ticker: "NVDA",
      tokenIn: nvda,
      amount: "5000000000000000",
      swapper: owner,
      maxSlippageBps: 100,
    });
    const prepared = await client.buildWalletSell({
      sell,
      swapper: owner,
      signature: `0x${"12".repeat(65)}`,
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    for (const call of [0, 1, 2]) {
      expect(sentHeaders(fetchFn, call)["x-agent-info"]).toBe(humanHeader);
    }
    expect(sell).not.toHaveProperty("attribution");
    expect(prepared.attribution).toEqual({
      decisionOrigin: "human_mediated",
      status: null,
    });
  });
});

function sentHeaders(
  fetchFn: ReturnType<typeof vi.fn<typeof fetch>>,
  call: number,
): Record<string, string> {
  return fetchFn.mock.calls[call]?.[1]?.headers as Record<string, string>;
}

function sentBody(
  fetchFn: ReturnType<typeof vi.fn<typeof fetch>>,
  call: number,
): Record<string, unknown> {
  return JSON.parse(String(fetchFn.mock.calls[call]?.[1]?.body)) as Record<
    string,
    unknown
  >;
}

describe("Uniswap wallet buys", () => {
  const owner = "0x1234567890abcdef1234567890abcdef12345678";
  const swapData = `0x3593564c${"00".repeat(32)}` as const;

  it("builds a swap for the wallet to send and signs nothing", async () => {
    const quote = walletBuyQuote();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(quote, { "x-request-id": "buy-quote-1" }),
      )
      .mockResolvedValueOnce(jsonResponse(swapResponse()));

    const built = await new UniswapClient(config(), fetchFn).prepareWalletBuy({
      tokenOut: nvda,
      amount: "1000000",
      swapper: owner,
      maxSlippageBps: 50,
      decisionOrigin: "human_mediated",
    });

    expect(built).toEqual({
      amountOut: "4800000000000000",
      minAmountOut: "4776119402985074",
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
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      "https://trade-api.gateway.uniswap.org/v1/quote",
    );
    expect(sentBody(fetchFn, 0)).toMatchObject({
      tokenIn: usdg,
      tokenOut: nvda,
      amount: "1000000",
      type: "EXACT_INPUT",
      swapper: owner,
      tokenInChainId: 4663,
      tokenOutChainId: 4663,
      slippageTolerance: 0.5,
      protocols: ["V4"],
    });
    expect(fetchFn.mock.calls[1]?.[0]).toBe(
      "https://trade-api.gateway.uniswap.org/v1/swap",
    );
    expect(sentBody(fetchFn, 1)).toEqual({
      quote: quote.quote,
      simulateTransaction: true,
    });
    for (const call of [0, 1]) {
      expect(sentHeaders(fetchFn, call)["x-agent-info"]).toBe(
        '{"decision_origin":"human_mediated","integration_name":"eqlty"}',
      );
    }
  });

  it("asks for an on-chain Permit2 allowance instead of signing the permit", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        { ...walletBuyQuote(), permitData: quoteBody().permitData },
        { "x-request-id": "buy-quote-2" },
      ),
    );

    await expect(
      new UniswapClient(config(), fetchFn).prepareWalletBuy({
        tokenOut: nvda,
        amount: "1000000",
        swapper: owner,
        maxSlippageBps: 50,
      }),
    ).rejects.toMatchObject({
      name: "Permit2AllowanceRequiredError",
      token: usdg,
      spender: router,
      amount: "1000000",
      permit2,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refuses a permit whose spender is not the configured router", async () => {
    const permitData = quoteBody().permitData;
    permitData.values.spender = vault;
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        { ...walletBuyQuote(), permitData },
        { "x-request-id": "buy-quote-3" },
      ),
    );

    await expect(
      new UniswapClient(config(), fetchFn).prepareWalletBuy({
        tokenOut: nvda,
        amount: "1000000",
        swapper: owner,
        maxSlippageBps: 50,
      }),
    ).rejects.toThrow("Permit2 spender is not the authorized router");
  });

  it("refuses a transaction for any contract but the configured router", async () => {
    const other = "0x204FAca1764B154221e35c0d20aBb3c525710498";
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(walletBuyQuote(), { "x-request-id": "buy-quote-4" }),
      )
      .mockResolvedValueOnce(jsonResponse(swapResponse({ to: other })));

    await expect(
      new UniswapClient(config(), fetchFn).prepareWalletBuy({
        tokenOut: nvda,
        amount: "1000000",
        swapper: owner,
        maxSlippageBps: 50,
      }),
    ).rejects.toThrow(
      `Uniswap returned a transaction for ${other}, not the configured Universal Router ${router}`,
    );
  });

  it.each([
    [
      "a sender other than the wallet",
      { from: vault },
      "Uniswap transaction sender is not the requested wallet",
    ],
    [
      "native value",
      { value: "1" },
      "A USDG purchase cannot include native value",
    ],
    [
      "another chain",
      { chainId: 1 },
      "Uniswap transaction is not on Robinhood Chain",
    ],
  ])("refuses a transaction with %s", async (_label, change, message) => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(walletBuyQuote(), { "x-request-id": "buy-quote-5" }),
      )
      .mockResolvedValueOnce(jsonResponse(swapResponse(change)));

    await expect(
      new UniswapClient(config(), fetchFn).prepareWalletBuy({
        tokenOut: nvda,
        amount: "1000000",
        swapper: owner,
        maxSlippageBps: 50,
      }),
    ).rejects.toThrow(message);
  });

  it.each([
    [
      "a routing other than CLASSIC",
      (body: WalletBuyQuote) => {
        body.routing = "DUTCH_V2";
      },
      "Uniswap quote routing is not CLASSIC",
    ],
    [
      "a quote for another swapper",
      (body: WalletBuyQuote) => {
        body.quote.swapper = vault;
      },
      "Uniswap quote swapper is not the requested wallet",
    ],
    [
      "no aggregated output for the wallet",
      (body: WalletBuyQuote) => {
        delete body.quote.aggregatedOutputs;
      },
      "Uniswap quote has no single output for the wallet",
    ],
    [
      "no minimum output",
      (body: WalletBuyQuote) => {
        delete body.quote.aggregatedOutputs?.[0]?.minAmount;
      },
      "Uniswap quote returned no minimum output for the wallet",
    ],
    [
      "a minimum below the requested slippage",
      (body: WalletBuyQuote) => {
        body.quote.aggregatedOutputs![0]!.minAmount = "4775999999999999";
      },
      "Uniswap minimum output does not match the requested slippage",
    ],
  ])("refuses %s before building", async (_label, change, message) => {
    const body = walletBuyQuote();
    change(body);
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(body, { "x-request-id": "buy-quote-6" }),
      );

    await expect(
      new UniswapClient(config(), fetchFn).prepareWalletBuy({
        tokenOut: nvda,
        amount: "1000000",
        swapper: owner,
        maxSlippageBps: 50,
      }),
    ).rejects.toThrow(message);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("reports a failed swap build with its status", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(walletBuyQuote(), { "x-request-id": "buy-quote-7" }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errorCode: "ValidationError" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      );

    await expect(
      new UniswapClient(config(), fetchFn).prepareWalletBuy({
        tokenOut: nvda,
        amount: "1000000",
        swapper: owner,
        maxSlippageBps: 50,
      }),
    ).rejects.toThrow("Uniswap swap build failed with status 400");
  });

  type WalletBuyQuote = ReturnType<typeof walletBuyQuote>;

  // A CLASSIC quote with no permit, shaped like the Trading API reference:
  // the wallet's own output carries the minimum in aggregatedOutputs.
  function walletBuyQuote() {
    const body = quoteBody({ swapper: owner });
    return {
      routing: body.routing,
      quote: {
        ...body.quote,
        aggregatedOutputs: [
          {
            token: nvda,
            amount: "4800000000000000",
            recipient: owner,
            bps: 10_000,
            minAmount: "4776119402985074",
          },
        ] as Array<Record<string, unknown>> | undefined,
      },
      permitData: null as unknown,
    };
  }

  function swapResponse(change: Record<string, unknown> = {}) {
    return {
      requestId: "buy-swap-1",
      swap: {
        to: router,
        from: owner,
        data: swapData,
        value: "0x00",
        chainId: 4663,
        ...change,
      },
    };
  }
});
