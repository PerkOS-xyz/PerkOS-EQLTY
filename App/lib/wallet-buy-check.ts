import {
  decodeAbiParameters,
  decodeFunctionData,
  getAddress,
  type AbiParameter,
  type Address,
  type Hex,
} from "viem";
import { robinhoodUsdG, universalRouter } from "./execution-api";

export const robinhoodChainId = 4663;
/** The slippage every wallet buy asks the swap route for: 1%. */
export const walletBuySlippageBps = 100;
/** The swap must guarantee at least this share of the previewed output. */
export const walletBuyFloorBps = 9_900;

/** The Universal Router command that runs one Uniswap v4 swap. */
const v4SwapCommand = 0x10;
/** The Uniswap v4 router actions a plain USDG to stock token buy uses. */
const action = {
  swapExactInSingle: 0x06,
  swapExactIn: 0x07,
  settle: 0x0b,
  settleAll: 0x0c,
  take: 0x0e,
  takeAll: 0x0f,
} as const;
/** In the v4 router, recipient address(1) means the wallet that sent the transaction. */
const msgSender = "0x0000000000000000000000000000000000000001";

const routerAbi = [
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
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
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

const path = {
  name: "path",
  type: "tuple[]",
  components: [
    { name: "intermediateCurrency", type: "address" },
    { name: "fee", type: "uint256" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
    { name: "hookData", type: "bytes" },
  ],
} as const;

/** Universal Router 2.1.1 adds minHopPriceX36; 2.0 has none. Newest first. */
const exactInSingleLayouts = [
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
] as const;

const exactInLayouts = [
  [
    {
      type: "tuple",
      components: [
        { name: "currencyIn", type: "address" },
        path,
        { name: "minHopPriceX36", type: "uint256[]" },
        { name: "amountIn", type: "uint128" },
        { name: "amountOutMinimum", type: "uint128" },
      ],
    },
  ],
  [
    {
      type: "tuple",
      components: [
        { name: "currencyIn", type: "address" },
        path,
        { name: "amountIn", type: "uint128" },
        { name: "amountOutMinimum", type: "uint128" },
      ],
    },
  ],
] as const;

export type WalletBuyFailure =
  | "rejected"
  | "no_usdg"
  | "no_gas"
  | "price_moved"
  | "above_limit"
  | "unsafe_transaction"
  | "wallet_mismatch"
  | "reverted"
  | "unavailable";

/** A wallet buy that stopped, with a message a person can act on. */
export class WalletBuyError extends Error {
  constructor(
    readonly reason: WalletBuyFailure,
    message: string,
  ) {
    super(message);
    this.name = "WalletBuyError";
  }
}

export type WalletBuyTransaction = {
  to: string;
  data: Hex;
  value: string;
  chainId: number;
};

export type WalletBuyExpectation = {
  owner: Address;
  tokenOut: Address;
  /** Atomic USDG the owner agreed to spend. */
  amountIn: bigint;
  /** The output the owner saw before confirming, in the stock token's atomic units. */
  previewAmountOut: bigint;
};

type Swap = {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOutMinimum: bigint;
};

/** The least output the owner accepts: 99% of what the preview showed. */
export function minimumOutFloor(previewAmountOut: bigint): bigint {
  return (previewAmountOut * BigInt(walletBuyFloorBps)) / 10_000n;
}

/**
 * Checks the swap the API built before the owner's wallet signs it: Robinhood
 * Chain, exactly the Universal Router, no ETH, only v4 swaps of exactly the
 * agreed USDG into the expected stock token, paid to the owner, with a
 * minimum output of at least 99% of the preview. Returns that minimum.
 */
export function checkWalletBuyTransaction(
  transaction: WalletBuyTransaction,
  expected: WalletBuyExpectation,
): { minAmountOut: bigint } {
  if (transaction.chainId !== robinhoodChainId) {
    throw unsafe("The buy is not on Robinhood Chain.");
  }
  if (!sameAddress(transaction.to, universalRouter)) {
    throw unsafe("The buy does not go to the Uniswap Universal Router.");
  }
  if (!/^\d+$/.test(transaction.value) || BigInt(transaction.value) !== 0n) {
    throw unsafe("The buy would also spend ETH.");
  }

  let commands: Hex;
  let inputs: readonly Hex[];
  try {
    const decoded = decodeFunctionData({
      abi: routerAbi,
      data: transaction.data,
    });
    [commands, inputs] = [decoded.args[0], decoded.args[1]];
  } catch {
    throw unsafe("The buy calldata could not be read.");
  }
  const commandBytes = bytesOf(commands);
  if (
    commandBytes.length === 0 ||
    commandBytes.length !== inputs.length ||
    commandBytes.some((command) => command !== v4SwapCommand)
  ) {
    throw unsafe("The buy runs more than a Uniswap v4 swap.");
  }

  const swaps: Swap[] = [];
  let takeAllMinimum = 0n;
  let takes = 0;
  for (const input of inputs) {
    let actions: Hex;
    let params: readonly Hex[];
    try {
      [actions, params] = decodeAbiParameters(
        [{ type: "bytes" }, { type: "bytes[]" }],
        input,
      );
    } catch {
      throw unsafe("The swap steps could not be read.");
    }
    const actionBytes = bytesOf(actions);
    if (actionBytes.length !== params.length) {
      throw unsafe("The swap steps could not be read.");
    }
    actionBytes.forEach((step, index) => {
      const param = params[index]!;
      if (step === action.swapExactInSingle || step === action.swapExactIn) {
        swaps.push(readSwap(step, param, expected));
        return;
      }
      if (step === action.settle) {
        const [currency, amount, payerIsUser] = decodeStep(
          [{ type: "address" }, { type: "uint256" }, { type: "bool" }],
          param,
        );
        if (
          !sameAddress(currency, robinhoodUsdG) ||
          !payerIsUser ||
          amount > expected.amountIn
        ) {
          throw unsafe("The buy pays with something other than your USDG.");
        }
        return;
      }
      if (step === action.settleAll) {
        const [currency, maxAmount] = decodeStep(
          [{ type: "address" }, { type: "uint256" }],
          param,
        );
        if (
          !sameAddress(currency, robinhoodUsdG) ||
          maxAmount > expected.amountIn
        ) {
          throw unsafe("The buy pays with something other than your USDG.");
        }
        return;
      }
      if (step === action.take) {
        const [currency, recipient] = decodeStep(
          [{ type: "address" }, { type: "address" }, { type: "uint256" }],
          param,
        );
        if (!sameAddress(currency, expected.tokenOut)) {
          throw wrongToken();
        }
        if (
          !sameAddress(recipient, msgSender) &&
          !sameAddress(recipient, expected.owner)
        ) {
          throw unsafe("The bought tokens would not go to your wallet.");
        }
        takes += 1;
        return;
      }
      if (step === action.takeAll) {
        const [currency, minAmount] = decodeStep(
          [{ type: "address" }, { type: "uint256" }],
          param,
        );
        if (!sameAddress(currency, expected.tokenOut)) {
          throw wrongToken();
        }
        if (minAmount > takeAllMinimum) takeAllMinimum = minAmount;
        takes += 1;
        return;
      }
      throw unsafe("The swap includes a step a plain buy does not need.");
    });
  }

  if (swaps.length === 0 || takes === 0) {
    throw unsafe("The buy has no swap paid to your wallet.");
  }
  const spent = swaps.reduce((total, swap) => total + swap.amountIn, 0n);
  if (spent !== expected.amountIn) {
    throw unsafe("The buy spends a different USDG amount than you confirmed.");
  }
  const swapMinimum = swaps.reduce(
    (total, swap) => total + swap.amountOutMinimum,
    0n,
  );
  const minAmountOut =
    swapMinimum > takeAllMinimum ? swapMinimum : takeAllMinimum;
  if (minAmountOut === 0n) {
    throw unsafe("The buy has no minimum output.");
  }
  if (expected.previewAmountOut <= 0n) {
    throw unsafe("There is no preview to compare the price with.");
  }
  if (minAmountOut < minimumOutFloor(expected.previewAmountOut)) {
    throw new WalletBuyError(
      "price_moved",
      "The price moved since you checked it. Nothing was bought; check the new numbers and confirm again.",
    );
  }
  return { minAmountOut };
}

/** Plain words for any error a wallet buy can end with. */
export function walletBuyErrorMessage(cause: unknown): string {
  if (cause instanceof WalletBuyError) return cause.message;
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  if (
    /user rejected|user denied|request rejected|rejected the request|denied transaction|code.?4001/i.test(
      message,
    )
  ) {
    return "You rejected the request in your wallet. Nothing was bought.";
  }
  if (
    /insufficient funds|gas required exceeds|exceeds the balance of the account/i.test(
      message,
    )
  ) {
    return "Not enough ETH on Robinhood Chain to pay the network gas.";
  }
  if (/transfer amount exceeds balance|insufficient balance/i.test(message)) {
    return "Not enough USDG in your wallet for this buy.";
  }
  if (/too ?little ?received|V4TooLittleReceived|slippage/i.test(message)) {
    return "The price moved since you checked it. Nothing was bought; check the new numbers and confirm again.";
  }
  return message
    ? `The buy did not go through. ${message}`
    : "The buy did not go through.";
}

function readSwap(
  step: number,
  param: Hex,
  expected: WalletBuyExpectation,
): Swap {
  const layouts =
    step === action.swapExactInSingle
      ? exactInSingleLayouts.map((layout) => () => {
          const [swap] = decodeAbiParameters(layout, param);
          const key = swap.poolKey;
          return {
            tokenIn: swap.zeroForOne ? key.currency0 : key.currency1,
            tokenOut: swap.zeroForOne ? key.currency1 : key.currency0,
            amountIn: swap.amountIn,
            amountOutMinimum: swap.amountOutMinimum,
          };
        })
      : exactInLayouts.map((layout) => () => {
          const [swap] = decodeAbiParameters(layout, param);
          const last = swap.path.at(-1);
          if (!last) throw new Error("empty path");
          return {
            tokenIn: swap.currencyIn,
            tokenOut: last.intermediateCurrency,
            amountIn: swap.amountIn,
            amountOutMinimum: swap.amountOutMinimum,
          };
        });
  let decodedAny = false;
  let tokensMatched = false;
  for (const decode of layouts) {
    let swap: Swap;
    try {
      swap = decode();
    } catch {
      continue;
    }
    decodedAny = true;
    if (
      !sameAddress(swap.tokenIn, robinhoodUsdG) ||
      !sameAddress(swap.tokenOut, expected.tokenOut)
    ) {
      continue;
    }
    tokensMatched = true;
    if (swap.amountIn > 0n && swap.amountIn <= expected.amountIn) {
      return swap;
    }
  }
  if (!decodedAny) throw unsafe("The swap steps could not be read.");
  throw tokensMatched
    ? unsafe("The buy spends a different USDG amount than you confirmed.")
    : wrongToken();
}

function decodeStep<const T extends readonly AbiParameter[]>(
  types: T,
  param: Hex,
) {
  try {
    return decodeAbiParameters(types, param);
  } catch {
    throw unsafe("The swap steps could not be read.");
  }
}

function bytesOf(value: Hex): number[] {
  const hex = value.slice(2);
  const bytes: number[] = [];
  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return bytes;
}

function sameAddress(left: unknown, right: string): boolean {
  try {
    return getAddress(String(left)) === getAddress(right);
  } catch {
    return false;
  }
}

function unsafe(detail: string): WalletBuyError {
  return new WalletBuyError(
    "unsafe_transaction",
    `The buy did not pass the safety check, so nothing was sent. ${detail}`,
  );
}

function wrongToken(): WalletBuyError {
  return unsafe("The buy is not USDG into the stock you chose.");
}
