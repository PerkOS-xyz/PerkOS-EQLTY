import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  type Hex,
} from "viem";
import type { WalletAccess } from "../app/wallet-access-context";
import {
  executeWalletBuy,
  permit2,
  previewWalletBuy,
  type WalletBuyPreview,
} from "./wallet-buy";
import { WalletBuyError } from "./wallet-buy-check";

const router = "0x8876789976decbfcbbbe364623c63652db8c0904";
const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const nvda = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const owner = "0x1234567890AbcdEF1234567890aBcdef12345678";
const amountIn = 25_000_000n;
const quoted = 120_000_000_000_000_000n;
const cap = 100_000_000n;

function swapData(minimum: bigint): Hex {
  const swap = encodeAbiParameters(
    parseAbiParameters(
      "((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)",
    ),
    [
      {
        poolKey: {
          currency0: usdg,
          currency1: nvda,
          fee: 3000,
          tickSpacing: 60,
          hooks: "0x0000000000000000000000000000000000000000",
        },
        zeroForOne: true,
        amountIn,
        amountOutMinimum: minimum,
        minHopPriceX36: 0n,
        hookData: "0x",
      },
    ],
  );
  const steps = encodeAbiParameters(parseAbiParameters("bytes, bytes[]"), [
    "0x060c0f",
    [
      swap,
      encodeAbiParameters(parseAbiParameters("address, uint256"), [usdg, amountIn]),
      encodeAbiParameters(parseAbiParameters("address, uint256"), [nvda, minimum]),
    ],
  ]);
  return encodeFunctionData({
    abi: parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline)"]),
    functionName: "execute",
    args: ["0x10", [steps], 1_900_000_000n],
  });
}

function fakeChain(input: {
  usdgBalance?: bigint;
  approval?: bigint;
  permission?: bigint;
  permissionExpiration?: number;
} = {}) {
  const chain = {
    usdgBalance: input.usdgBalance ?? 50_000_000n,
    approval: input.approval ?? 0n,
    permission: input.permission ?? 0n,
    permissionExpiration: input.permissionExpiration ?? 0,
  };
  const writes: Array<{ address: string; functionName: string; args: readonly unknown[] }> = [];
  const sent: Array<{ to: string; data: Hex; value: bigint }> = [];
  const publicClient = {
    readContract: vi.fn(async (call: { address: string; functionName: string }) => {
      if (call.address === permit2) {
        return [chain.permission, chain.permissionExpiration, 0];
      }
      return call.functionName === "balanceOf" ? chain.usdgBalance : chain.approval;
    }),
    getBalance: vi.fn(async () => 10n ** 16n),
    getGasPrice: vi.fn(async () => 10_000_000n),
    estimateGas: vi.fn(async () => 200_000n),
    waitForTransactionReceipt: vi.fn(async () => ({
      status: "success",
      blockNumber: 77n,
    })),
  };
  const walletClient = {
    account: { address: owner },
    writeContract: vi.fn(
      async (call: { address: string; functionName: string; args: readonly unknown[] }) => {
        writes.push(call);
        if (call.address === permit2) {
          chain.permission = call.args[2] as bigint;
          chain.permissionExpiration = call.args[3] as number;
        } else {
          chain.approval = call.args[1] as bigint;
        }
        return `0x${String(writes.length).padStart(64, "a")}` as Hex;
      },
    ),
    sendTransaction: vi.fn(async (call: { to: string; data: Hex; value: bigint }) => {
      sent.push(call);
      return `0x${"b".repeat(64)}` as Hex;
    }),
  };
  const wallet = {
    enabled: true,
    loaded: true,
    connected: true,
    address: owner,
    open: () => undefined,
    logout: async () => undefined,
    signMessage: async () => "0x" as Hex,
    getEvmClients: async () => ({ publicClient, walletClient }),
  } as unknown as WalletAccess;
  return { chain, writes, sent, wallet, publicClient };
}

function stubApi(swaps: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; body?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url.includes("/api/agent/quote")) {
        return Response.json({
          chainId: 4663,
          ticker: "NVDA",
          tokenIn: { symbol: "USDG", address: usdg, decimals: 6 },
          tokenOut: { symbol: "NVDA", address: nvda, decimals: 18 },
          amountIn: amountIn.toString(),
          amountOut: quoted.toString(),
          requestId: "quote-1",
          quotedAt: "2026-10-01T12:00:00.000Z",
        });
      }
      const next = swaps.shift() ?? { status: 500, body: {} };
      return Response.json(next.body, { status: next.status });
    }),
  );
  return calls;
}

const swapBody = (minimum: bigint) => ({
  chainId: 4663,
  to: router,
  data: swapData(minimum),
  value: "0",
  tokenIn: { symbol: "USDG", address: usdg, decimals: 6 },
  tokenOut: { symbol: "NVDA", address: nvda, decimals: 18 },
  amountIn: amountIn.toString(),
  amountOut: quoted.toString(),
  minAmountOut: ((quoted * 100n) / 101n).toString(),
  requestId: "swap-1",
  routing: "CLASSIC",
});

/** A wallet whose USDG approval and router permission are already set. */
function ready() {
  return {
    approval: amountIn,
    permission: amountIn,
    permissionExpiration: Math.floor(Date.now() / 1_000) + 1_200,
  };
}

function permissionRequest(spender: string) {
  return {
    error: "permit2_allowance_required",
    message: "The swapper has no Permit2 allowance for the Universal Router yet.",
    token: usdg,
    spender,
    amount: amountIn.toString(),
  };
}

async function preview(wallet: WalletAccess): Promise<WalletBuyPreview> {
  return previewWalletBuy({
    wallet,
    ticker: "NVDA",
    amountIn: amountIn.toString(),
    tokenOut: nvda,
    cap,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wallet buy", () => {
  it("previews the quote, the 99% floor and the approvals still missing", async () => {
    const { wallet } = fakeChain();
    stubApi([]);
    await expect(preview(wallet)).resolves.toMatchObject({
      amountOut: quoted.toString(),
      minAmountOut: ((quoted * 9_900n) / 10_000n).toString(),
      needsApproval: true,
      needsPermission: true,
      usdgBalance: "50000000",
    });
  });

  it("refuses an order above the cap before asking anything", async () => {
    const { wallet } = fakeChain();
    const calls = stubApi([]);
    await expect(
      previewWalletBuy({ wallet, ticker: "NVDA", amountIn: "100000001", cap }),
    ).rejects.toMatchObject({ reason: "above_limit" });
    expect(calls).toEqual([]);
  });

  it("approves USDG, sets the router permission, then sends the checked swap", async () => {
    const { wallet, writes, sent } = fakeChain();
    const calls = stubApi([{ status: 200, body: swapBody((quoted * 100n) / 101n) }]);
    const stages: string[] = [];
    const result = await executeWalletBuy({
      wallet,
      preview: await preview(wallet),
      onStage: (stage) => stages.push(stage),
    });

    expect(writes.map((write) => [write.address, write.functionName])).toEqual([
      [usdg, "approve"],
      [permit2, "approve"],
    ]);
    expect(writes[0]!.args).toEqual([permit2, amountIn]);
    expect(writes[1]!.args.slice(0, 3)).toEqual([usdg, router, amountIn]);
    const expiration = writes[1]!.args[3] as number;
    expect(expiration - Math.floor(Date.now() / 1_000)).toBeGreaterThan(29 * 60);
    expect(sent).toEqual([{ account: { address: owner }, to: router, data: swapData((quoted * 100n) / 101n), value: 0n }]);
    expect(calls.at(-1)!.url).toContain("/api/agent/swap");
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({
      ticker: "NVDA",
      amountIn: amountIn.toString(),
      swapper: owner,
      slippageBps: 100,
    });
    expect(stages).toEqual(["checking", "approving", "permitting", "building", "buying", "confirming"]);
    expect(result).toMatchObject({
      transactionHash: `0x${"b".repeat(64)}`,
      minAmountOut: ((quoted * 100n) / 101n).toString(),
      blockNumber: "77",
    });
  });

  it("skips approvals that are already in place", async () => {
    const { wallet, writes, sent } = fakeChain(ready());
    stubApi([{ status: 200, body: swapBody((quoted * 100n) / 101n) }]);
    const checked = await preview(wallet);
    expect(checked).toMatchObject({ needsApproval: false, needsPermission: false });
    await executeWalletBuy({ wallet, preview: checked, onStage: () => undefined });
    expect(writes).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("renews the router permission and asks once more when the API answers 409", async () => {
    const { wallet, writes, sent } = fakeChain(ready());
    const calls = stubApi([
      { status: 409, body: permissionRequest(router) },
      { status: 200, body: swapBody((quoted * 100n) / 101n) },
    ]);
    await executeWalletBuy({ wallet, preview: await preview(wallet), onStage: () => undefined });
    expect(writes.map((write) => [write.address, write.functionName])).toEqual([
      [permit2, "approve"],
    ]);
    expect(writes[0]!.args.slice(0, 3)).toEqual([usdg, router, amountIn]);
    expect(calls.filter((call) => call.url.includes("/api/agent/swap"))).toHaveLength(2);
    expect(sent).toHaveLength(1);
  });

  it("never sends a swap whose minimum is under 99% of the preview", async () => {
    const { wallet, sent } = fakeChain(ready());
    stubApi([{ status: 200, body: swapBody((quoted * 9_800n) / 10_000n) }]);
    const error = await executeWalletBuy({
      wallet,
      preview: await preview(wallet),
      onStage: () => undefined,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WalletBuyError);
    expect((error as WalletBuyError).reason).toBe("price_moved");
    expect(sent).toEqual([]);
  });

  it("stops before any wallet request when the wallet lacks USDG", async () => {
    const { wallet, writes, sent } = fakeChain({ usdgBalance: 1_000_000n });
    stubApi([]);
    await expect(
      executeWalletBuy({ wallet, preview: await preview(wallet), onStage: () => undefined }),
    ).rejects.toMatchObject({ reason: "no_usdg" });
    expect(writes).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("refuses a 409 that asks to approve another spender", async () => {
    const { wallet, writes, sent } = fakeChain(ready());
    stubApi([
      {
        status: 409,
        body: permissionRequest("0x9999999999999999999999999999999999999999"),
      },
    ]);
    await expect(
      executeWalletBuy({ wallet, preview: await preview(wallet), onStage: () => undefined }),
    ).rejects.toMatchObject({ reason: "unsafe_transaction" });
    expect(writes).toEqual([]);
    expect(sent).toEqual([]);
  });
});

