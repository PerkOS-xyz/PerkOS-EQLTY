import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeFunctionData,
  toHex,
  type Hex,
} from "viem";
import {
  checkWalletBuyTransaction,
  minimumOutFloor,
  walletBuyErrorMessage,
  WalletBuyError,
  type WalletBuyTransaction,
} from "./wallet-buy-check";

const router = "0x8876789976decbfcbbbe364623c63652db8c0904";
const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const nvda = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const tsla = "0xe0601ce157db5bdc3162bbac2a2c8af5320d9eec";
const owner = "0x1234567890abcdef1234567890abcdef12345678";
const stranger = "0x9999999999999999999999999999999999999999";
const msgSender = "0x0000000000000000000000000000000000000001";
const noHooks = "0x0000000000000000000000000000000000000000";
const amountIn = 25_000_000n;
const preview = 120_000_000_000_000_000n;
/** What the route builds for 1% slippage: the quote divided by 1.01. */
const routeMinimum = (preview * 10_000n) / 10_100n;
const expected = { owner, tokenOut: nvda, amountIn, previewAmountOut: preview } as const;

const executeAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const poolKey = {
  name: "poolKey",
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

function single(input: {
  amount?: bigint;
  minimum?: bigint;
  tokenOut?: string;
  layout?: "2.1.1" | "2.0";
} = {}): Hex {
  const tokenOut = (input.tokenOut ?? nvda) as Hex;
  const key = {
    currency0: usdg as Hex,
    currency1: tokenOut,
    fee: 3000,
    tickSpacing: -60,
    hooks: noHooks as Hex,
  };
  const amount = input.amount ?? amountIn;
  const minimum = input.minimum ?? routeMinimum;
  if (input.layout === "2.0") {
    return encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            poolKey,
            { name: "zeroForOne", type: "bool" },
            { name: "amountIn", type: "uint128" },
            { name: "amountOutMinimum", type: "uint128" },
            { name: "hookData", type: "bytes" },
          ],
        },
      ],
      [{ poolKey: key, zeroForOne: true, amountIn: amount, amountOutMinimum: minimum, hookData: "0x" }],
    );
  }
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          poolKey,
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "minHopPriceX36", type: "uint256" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    [
      {
        poolKey: key,
        zeroForOne: true,
        amountIn: amount,
        amountOutMinimum: minimum,
        minHopPriceX36: 0n,
        hookData: "0x",
      },
    ],
  );
}

function multiHop(minimum = routeMinimum): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "currencyIn", type: "address" },
          {
            name: "path",
            type: "tuple[]",
            components: [
              { name: "intermediateCurrency", type: "address" },
              { name: "fee", type: "uint256" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
              { name: "hookData", type: "bytes" },
            ],
          },
          { name: "minHopPriceX36", type: "uint256[]" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
        ],
      },
    ],
    [
      {
        currencyIn: usdg,
        path: [
          {
            intermediateCurrency: nvda,
            fee: 3000n,
            tickSpacing: 60,
            hooks: noHooks,
            hookData: "0x",
          },
        ],
        minHopPriceX36: [0n],
        amountIn,
        amountOutMinimum: minimum,
      },
    ],
  );
}

const settle = (currency: string = usdg, amount = 0n) =>
  encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "bool" }],
    [currency as Hex, amount, true],
  );
const take = (recipient: string = msgSender, currency: string = nvda) =>
  encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [currency as Hex, recipient as Hex, 0n],
  );
const settleAll = (maxAmount: bigint) =>
  encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [usdg, maxAmount],
  );
const takeAll = (minimum: bigint) =>
  encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [nvda, minimum],
  );

function v4(steps: Array<[number, Hex]>): Hex {
  return encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [
      toHex(new Uint8Array(steps.map(([step]) => step))),
      steps.map(([, param]) => param),
    ],
  );
}

function plainBuy(swap: Hex = single()): Hex {
  return v4([
    [0x06, swap],
    [0x0b, settle()],
    [0x0e, take()],
  ]);
}

function transaction(
  commands: number[] = [0x10],
  inputs: Hex[] = [plainBuy()],
  overrides: Partial<WalletBuyTransaction> = {},
): WalletBuyTransaction {
  return {
    to: router,
    data: encodeFunctionData({
      abi: executeAbi,
      functionName: "execute",
      args: [toHex(new Uint8Array(commands)), inputs, 1_900_000_000n],
    }),
    value: "0",
    chainId: 4663,
    ...overrides,
  };
}

function reasonOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof WalletBuyError) return error.reason;
    throw error;
  }
  return undefined;
}

describe("wallet buy transaction check", () => {
  it("accepts a v4 buy built for Universal Router 2.1.1", () => {
    expect(checkWalletBuyTransaction(transaction(), expected)).toEqual({
      minAmountOut: routeMinimum,
    });
  });

  it("accepts the swap, SETTLE_ALL and TAKE_ALL shape seen on Robinhood Chain", () => {
    const input = v4([
      [0x06, single()],
      [0x0c, settleAll(amountIn)],
      [0x0f, takeAll(routeMinimum)],
    ]);
    expect(
      checkWalletBuyTransaction(transaction([0x10], [input]), expected),
    ).toEqual({ minAmountOut: routeMinimum });
  });

  it("accepts the multi hop form and the Universal Router 2.0 layout", () => {
    const multi = v4([
      [0x07, multiHop()],
      [0x0c, settleAll(amountIn)],
      [0x0f, takeAll(0n)],
    ]);
    expect(
      checkWalletBuyTransaction(transaction([0x10], [multi]), expected),
    ).toEqual({ minAmountOut: routeMinimum });
    expect(
      checkWalletBuyTransaction(
        transaction([0x10], [plainBuy(single({ layout: "2.0" }))]),
        expected,
      ),
    ).toEqual({ minAmountOut: routeMinimum });
  });

  it("reads the minimum from TAKE_ALL when the swap leaves it open", () => {
    const input = v4([
      [0x06, single({ minimum: 0n })],
      [0x0b, settle()],
      [0x0f, takeAll(routeMinimum)],
    ]);
    expect(
      checkWalletBuyTransaction(transaction([0x10], [input]), expected),
    ).toEqual({ minAmountOut: routeMinimum });
  });

  it("adds up a buy split across two v4 swaps", () => {
    const half = amountIn / 2n;
    const leg = (minimum: bigint) =>
      v4([
        [0x06, single({ amount: half, minimum })],
        [0x0b, settle()],
        [0x0e, take(owner)],
      ]);
    expect(
      checkWalletBuyTransaction(
        transaction([0x10, 0x10], [leg(routeMinimum / 2n), leg(routeMinimum / 2n)]),
        expected,
      ),
    ).toEqual({ minAmountOut: (routeMinimum / 2n) * 2n });
  });

  it("accepts exactly 99% of the preview and calls one unit less a price move", () => {
    const floor = minimumOutFloor(preview);
    expect(floor).toBe(118_800_000_000_000_000n);
    expect(
      reasonOf(() =>
        checkWalletBuyTransaction(
          transaction([0x10], [plainBuy(single({ minimum: floor }))]),
          expected,
        ),
      ),
    ).toBeUndefined();
    expect(
      reasonOf(() =>
        checkWalletBuyTransaction(
          transaction([0x10], [plainBuy(single({ minimum: floor - 1n }))]),
          expected,
        ),
      ),
    ).toBe("price_moved");
  });

  it("refuses a transaction for another contract, chain or with ETH", () => {
    expect(
      reasonOf(() =>
        checkWalletBuyTransaction(transaction(undefined, undefined, { to: stranger }), expected),
      ),
    ).toBe("unsafe_transaction");
    expect(
      reasonOf(() =>
        checkWalletBuyTransaction(transaction(undefined, undefined, { chainId: 8453 }), expected),
      ),
    ).toBe("unsafe_transaction");
    expect(
      reasonOf(() =>
        checkWalletBuyTransaction(transaction(undefined, undefined, { value: "1" }), expected),
      ),
    ).toBe("unsafe_transaction");
  });

  it("refuses commands other than a plain V4_SWAP", () => {
    const sweep = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      [nvda, stranger, 0n],
    );
    expect(
      reasonOf(() =>
        checkWalletBuyTransaction(transaction([0x10, 0x04], [plainBuy(), sweep]), expected),
      ),
    ).toBe("unsafe_transaction");
    expect(
      reasonOf(() => checkWalletBuyTransaction(transaction([0x90]), expected)),
    ).toBe("unsafe_transaction");
  });

  it("refuses output sent to another wallet or a fee step", () => {
    const toStranger = v4([
      [0x06, single()],
      [0x0b, settle()],
      [0x0e, take(stranger)],
    ]);
    const portion = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      [nvda, stranger, 25n],
    );
    const withFee = v4([
      [0x06, single()],
      [0x0b, settle()],
      [0x10, portion],
      [0x0e, take()],
    ]);
    for (const input of [toStranger, withFee]) {
      expect(
        reasonOf(() => checkWalletBuyTransaction(transaction([0x10], [input]), expected)),
      ).toBe("unsafe_transaction");
    }
  });

  it("refuses another amount, another stock or another payment token", () => {
    const cases = [
      plainBuy(single({ amount: amountIn + 1n })),
      plainBuy(single({ tokenOut: tsla })),
      v4([
        [0x06, single()],
        [0x0b, settle(nvda)],
        [0x0e, take()],
      ]),
      v4([
        [0x06, single()],
        [0x0b, settle(usdg, amountIn + 1n)],
        [0x0e, take()],
      ]),
    ];
    for (const input of cases) {
      expect(
        reasonOf(() => checkWalletBuyTransaction(transaction([0x10], [input]), expected)),
      ).toBe("unsafe_transaction");
    }
  });

  it("refuses calldata it cannot read", () => {
    expect(
      reasonOf(() =>
        checkWalletBuyTransaction(
          transaction(undefined, undefined, { data: "0x3593564c00" }),
          expected,
        ),
      ),
    ).toBe("unsafe_transaction");
  });
});

describe("wallet buy error message", () => {
  it("says what happened in plain words", () => {
    expect(
      walletBuyErrorMessage(new Error("User rejected the request.")),
    ).toBe("You rejected the request in your wallet. Nothing was bought.");
    expect(
      walletBuyErrorMessage(
        new Error("insufficient funds for gas * price + value"),
      ),
    ).toBe("Not enough ETH on Robinhood Chain to pay the network gas.");
    expect(
      walletBuyErrorMessage(
        new Error("ERC20: transfer amount exceeds balance"),
      ),
    ).toBe("Not enough USDG in your wallet for this buy.");
    expect(
      walletBuyErrorMessage(new WalletBuyError("no_usdg", "Need 2 USDG.")),
    ).toBe("Need 2 USDG.");
  });
});
