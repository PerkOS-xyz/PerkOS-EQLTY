import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { UniswapClient } from "./uniswap-client.js";

const vault = "0x9999999999999999999999999999999999999999";
const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const nvda = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const router = "0x8876789976decbfcbbbe364623c63652db8c0904";
const permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const riskKey = `0x${"11".repeat(32)}`;

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

function quoteBody() {
  return {
    routing: "CLASSIC",
    quote: {
      swapper: vault,
      chainId: 4663,
      tokenInChainId: 4663,
      tokenOutChainId: 4663,
      input: {
        token: usdg,
        amount: "1000000",
      },
      output: {
        token: nvda,
        amount: "4800000000000000",
        recipient: vault,
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
          token: usdg,
          amount: "1000000",
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
