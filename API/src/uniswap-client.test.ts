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
