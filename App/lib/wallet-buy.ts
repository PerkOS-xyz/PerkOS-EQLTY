import { getAddress, type Address, type Hex } from "viem";
import type { WalletAccess } from "../app/wallet-access-context";
import {
  BuyApiError,
  requestBuyQuote,
  requestBuySwap,
  type WalletBuySwap,
} from "./buy-api";
import { robinhoodUsdG, universalRouter } from "./execution-api";
import {
  checkWalletBuyTransaction,
  minimumOutFloor,
  robinhoodChainId,
  walletBuyErrorMessage,
  WalletBuyError,
  walletBuySlippageBps,
} from "./wallet-buy-check";

export const permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
/**
 * The API's default per-order cap for POST /api/agent/swap
 * (EQLTY_AGENT_SWAP_MAX_AMOUNT): 100 USDG. The API enforces its own value.
 */
export const walletBuyApiCap = 100_000_000n;
/** How long the router may use the approved USDG through Permit2. */
const permissionSeconds = 30 * 60;
/** A Permit2 permission that ends sooner than this is renewed first. */
const permissionMarginSeconds = 2 * 60;
/** Generous gas for each wallet transaction on Robinhood Chain. */
const gasUnits = {
  approval: 70_000n,
  permission: 80_000n,
  buy: 350_000n,
};

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

export type WalletBuyStage =
  | "idle"
  | "checking"
  | "approving"
  | "permitting"
  | "building"
  | "buying"
  | "confirming";

/** What the owner sees before confirming. Amounts are atomic strings. */
export type WalletBuyPreview = {
  ticker: string;
  owner: Address;
  tokenOut: Address;
  tokenOutDecimals: number;
  amountIn: string;
  /** The previewed quote. */
  amountOut: string;
  /** The least the buy may return: 99% of the preview. */
  minAmountOut: string;
  quotedAt: string;
  usdgBalance: string;
  nativeBalance: string;
  needsApproval: boolean;
  needsPermission: boolean;
  estimatedGasWei: string;
};

export type WalletBuyResult = {
  ticker: string;
  transactionHash: Hex;
  approvalTransactionHash?: Hex;
  permissionTransactionHash?: Hex;
  blockNumber: string;
  amountIn: string;
  amountOut: string;
  /** The minimum the signed swap enforced on chain. */
  minAmountOut: string;
  tokenOutDecimals: number;
  requestId: string;
};

type Clients = Awaited<ReturnType<WalletAccess["getEvmClients"]>>;

type WalletState = {
  usdgBalance: bigint;
  nativeBalance: bigint;
  approval: bigint;
  permissionAmount: bigint;
  permissionExpiration: number;
  gasPrice: bigint;
};

/**
 * Reads a fresh quote and the owner's wallet on Robinhood Chain. Sends and
 * signs nothing.
 */
export async function previewWalletBuy(input: {
  wallet: WalletAccess;
  ticker: string;
  amountIn: string;
  /** The stock token the approved recommendation names. */
  tokenOut?: Address;
  cap: bigint;
}): Promise<WalletBuyPreview> {
  const amount = parseAmount(input.amountIn);
  if (amount > input.cap) {
    throw new WalletBuyError(
      "above_limit",
      `Wallet buys are limited to ${formatUsdG(input.cap)} USDG per order.`,
    );
  }
  const owner = requireOwner(input.wallet);
  const [quote, clients] = await Promise.all([
    requestBuyQuote({ ticker: input.ticker, amountIn: amount.toString() }).catch(
      (cause: unknown) => {
        throw apiFailure(cause);
      },
    ),
    input.wallet.getEvmClients(robinhoodChainId),
  ]);
  if (
    quote.chainId !== robinhoodChainId ||
    quote.ticker.toUpperCase() !== input.ticker.toUpperCase() ||
    !sameAddress(quote.tokenIn.address, robinhoodUsdG) ||
    quote.amountIn !== amount.toString() ||
    (input.tokenOut && !sameAddress(quote.tokenOut.address, input.tokenOut)) ||
    !/^[1-9]\d*$/.test(quote.amountOut)
  ) {
    throw new WalletBuyError(
      "unsafe_transaction",
      "The price check did not match this purchase, so nothing was prepared.",
    );
  }
  const state = await readWalletState(clients.publicClient, owner);
  const needsApproval = state.approval < amount;
  const needsPermission = permissionMissing(state, amount);
  return {
    ticker: quote.ticker,
    owner,
    tokenOut: getAddress(quote.tokenOut.address),
    tokenOutDecimals: quote.tokenOut.decimals,
    amountIn: amount.toString(),
    amountOut: quote.amountOut,
    minAmountOut: minimumOutFloor(BigInt(quote.amountOut)).toString(),
    quotedAt: quote.quotedAt,
    usdgBalance: state.usdgBalance.toString(),
    nativeBalance: state.nativeBalance.toString(),
    needsApproval,
    needsPermission,
    estimatedGasWei: estimateGasWei(
      state.gasPrice,
      needsApproval,
      needsPermission,
    ).toString(),
  };
}

/**
 * Buys the previewed stock from the owner's own wallet: approvals only when
 * missing, then the Uniswap swap the API builds, checked before the wallet
 * signs it. EQLTY never holds the funds or the key.
 */
export async function executeWalletBuy(input: {
  wallet: WalletAccess;
  preview: WalletBuyPreview;
  onStage: (stage: WalletBuyStage) => void;
}): Promise<WalletBuyResult> {
  const { preview } = input;
  const owner = requireOwner(input.wallet);
  if (!sameAddress(owner, preview.owner)) {
    throw new WalletBuyError(
      "wallet_mismatch",
      "The connected wallet changed. Close this window and start again.",
    );
  }
  const amount = parseAmount(preview.amountIn);
  input.onStage("checking");
  const clients = await input.wallet.getEvmClients(robinhoodChainId);
  const account = clients.walletClient.account;
  if (!account || !sameAddress(account.address, owner)) {
    throw new WalletBuyError(
      "wallet_mismatch",
      "The wallet that would sign is not the connected wallet.",
    );
  }

  let state = await readWalletState(clients.publicClient, owner);
  assertFunds(state, amount);
  const hashes: { approval?: Hex; permission?: Hex } = {};
  state = await ensureAllowances({
    clients,
    owner,
    amount,
    state,
    renewPermission: false,
    hashes,
    onStage: input.onStage,
  });

  input.onStage("building");
  const order = {
    ticker: preview.ticker,
    amountIn: amount.toString(),
    swapper: owner,
    slippageBps: walletBuySlippageBps,
  };
  let swap: WalletBuySwap;
  try {
    swap = await requestBuySwap(order);
  } catch (cause) {
    if (!(cause instanceof BuyApiError) || cause.status !== 409) {
      throw apiFailure(cause);
    }
    // The API saw no Permit2 permission for the router. Set it (only for
    // USDG, the router and this amount), then ask once more.
    const asked = cause.allowance;
    if (
      !asked ||
      !sameAddress(asked.token, robinhoodUsdG) ||
      !sameAddress(asked.spender, universalRouter) ||
      asked.amount !== amount.toString()
    ) {
      throw new WalletBuyError(
        "unsafe_transaction",
        "The server asked for a permission this buy does not need, so nothing was signed.",
      );
    }
    // A permission this buy just set may not have reached Uniswap's node
    // yet: give it a moment instead of asking the wallet again.
    const justSet = Boolean(hashes.permission);
    state = await readWalletState(clients.publicClient, owner);
    assertFunds(state, amount);
    state = await ensureAllowances({
      clients,
      owner,
      amount,
      state,
      renewPermission: !justSet,
      hashes,
      onStage: input.onStage,
    });
    if (justSet) await wait(4_000);
    input.onStage("building");
    swap = await requestBuySwap(order).catch((retry: unknown) => {
      throw apiFailure(retry);
    });
  }

  if (
    swap.amountIn !== amount.toString() ||
    !sameAddress(swap.tokenIn.address, robinhoodUsdG) ||
    !sameAddress(swap.tokenOut.address, preview.tokenOut)
  ) {
    throw new WalletBuyError(
      "unsafe_transaction",
      "The buy did not pass the safety check, so nothing was sent. It does not match what you confirmed.",
    );
  }
  const { minAmountOut } = checkWalletBuyTransaction(swap, {
    owner,
    tokenOut: preview.tokenOut,
    amountIn: amount,
    previewAmountOut: BigInt(preview.amountOut),
  });

  input.onStage("buying");
  // Simulate first: a swap that would revert costs gas and buys nothing.
  let gas: bigint;
  try {
    gas = await clients.publicClient.estimateGas({
      account: owner,
      to: universalRouter,
      data: swap.data,
      value: 0n,
    });
  } catch (cause) {
    const plain = walletBuyErrorMessage(cause);
    if (plain.startsWith("Not enough ETH")) throw noGas();
    if (plain.startsWith("Not enough USDG")) {
      throw new WalletBuyError("no_usdg", plain);
    }
    throw new WalletBuyError(
      "price_moved",
      "The buy would fail on chain right now, so nothing was sent. The price may have moved; check the new numbers and confirm again.",
    );
  }
  const [nativeBalance, gasPrice] = await Promise.all([
    clients.publicClient.getBalance({ address: owner }),
    clients.publicClient.getGasPrice(),
  ]);
  if (nativeBalance < gas * gasPrice) {
    throw noGas();
  }
  const transactionHash = await clients.walletClient.sendTransaction({
    account,
    to: universalRouter,
    data: swap.data,
    value: 0n,
  });
  input.onStage("confirming");
  const receipt = await clients.publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });
  if (receipt.status !== "success") {
    throw new WalletBuyError(
      "reverted",
      `The buy failed on chain, so nothing was bought. Transaction ${transactionHash}.`,
    );
  }
  return {
    ticker: preview.ticker,
    transactionHash,
    approvalTransactionHash: hashes.approval,
    permissionTransactionHash: hashes.permission,
    blockNumber: receipt.blockNumber.toString(),
    amountIn: amount.toString(),
    amountOut: swap.amountOut,
    minAmountOut: minAmountOut.toString(),
    tokenOutDecimals: preview.tokenOutDecimals,
    requestId: swap.requestId,
  };
}

async function ensureAllowances(input: {
  clients: Clients;
  owner: Address;
  amount: bigint;
  state: WalletState;
  renewPermission: boolean;
  hashes: { approval?: Hex; permission?: Hex };
  onStage: (stage: WalletBuyStage) => void;
}): Promise<WalletState> {
  const { publicClient, walletClient } = input.clients;
  const account = walletClient.account;
  let state = input.state;
  if (state.approval < input.amount) {
    input.onStage("approving");
    const hash = await walletClient.writeContract({
      account,
      address: robinhoodUsdG,
      abi: erc20Abi,
      functionName: "approve",
      args: [permit2, input.amount],
    });
    await confirmed(publicClient, hash);
    input.hashes.approval = hash;
  }
  if (input.renewPermission || permissionMissing(state, input.amount)) {
    input.onStage("permitting");
    const hash = await walletClient.writeContract({
      account,
      address: permit2,
      abi: permit2Abi,
      functionName: "approve",
      args: [
        robinhoodUsdG,
        universalRouter,
        input.amount,
        nowSeconds() + permissionSeconds,
      ],
    });
    await confirmed(publicClient, hash);
    input.hashes.permission = hash;
  }
  if (input.hashes.approval || input.hashes.permission) {
    state = await waitForAllowances(publicClient, input.owner, input.amount);
  }
  return state;
}

async function readWalletState(
  publicClient: Clients["publicClient"],
  owner: Address,
): Promise<WalletState> {
  const [usdgBalance, nativeBalance, approval, permission, gasPrice] =
    await Promise.all([
      publicClient.readContract({
        address: robinhoodUsdG,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
      publicClient.getBalance({ address: owner }),
      publicClient.readContract({
        address: robinhoodUsdG,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, permit2],
      }),
      publicClient.readContract({
        address: permit2,
        abi: permit2Abi,
        functionName: "allowance",
        args: [owner, robinhoodUsdG, universalRouter],
      }),
      publicClient.getGasPrice(),
    ]);
  return {
    usdgBalance,
    nativeBalance,
    approval,
    permissionAmount: permission[0],
    permissionExpiration: permission[1],
    gasPrice,
  };
}

/** A load balanced RPC can answer from a node a block behind the receipt. */
async function waitForAllowances(
  publicClient: Clients["publicClient"],
  owner: Address,
  amount: bigint,
): Promise<WalletState> {
  let state = await readWalletState(publicClient, owner);
  for (
    let attempt = 0;
    attempt < 5 &&
    (state.approval < amount || permissionMissing(state, amount));
    attempt++
  ) {
    await wait(1_500);
    state = await readWalletState(publicClient, owner);
  }
  return state;
}

function permissionMissing(state: WalletState, amount: bigint): boolean {
  return (
    state.permissionAmount < amount ||
    state.permissionExpiration <= nowSeconds() + permissionMarginSeconds
  );
}

function assertFunds(state: WalletState, amount: bigint): void {
  if (state.usdgBalance < amount) {
    throw new WalletBuyError(
      "no_usdg",
      `Not enough USDG in your wallet. This buy needs ${formatUsdG(amount)} USDG and the wallet has ${formatUsdG(state.usdgBalance)} USDG on Robinhood Chain.`,
    );
  }
  const gas = estimateGasWei(
    state.gasPrice,
    state.approval < amount,
    permissionMissing(state, amount),
  );
  if (state.nativeBalance < gas) throw noGas();
}

function estimateGasWei(
  gasPrice: bigint,
  needsApproval: boolean,
  needsPermission: boolean,
): bigint {
  const units =
    gasUnits.buy +
    (needsApproval ? gasUnits.approval : 0n) +
    (needsPermission ? gasUnits.permission : 0n);
  return (units * gasPrice * 12n) / 10n;
}

async function confirmed(
  publicClient: Clients["publicClient"],
  hash: Hex,
): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new WalletBuyError(
      "reverted",
      `A wallet approval failed on chain, so nothing was bought. Transaction ${hash}.`,
    );
  }
}

function apiFailure(cause: unknown): Error {
  if (!(cause instanceof BuyApiError)) return cause as Error;
  if (cause.code === "amount_above_limit") {
    return new WalletBuyError(
      "above_limit",
      "This buy is above the per-order limit for wallet buys. Choose a smaller amount.",
    );
  }
  if (cause.status === 429) {
    return new WalletBuyError(
      "unavailable",
      "Too many buys are being prepared right now. Wait a minute and try again.",
    );
  }
  if (cause.status === 404) {
    return new WalletBuyError(
      "unavailable",
      "This stock cannot be bought through Uniswap right now.",
    );
  }
  if (cause.status === 409) {
    return new WalletBuyError(
      "unavailable",
      "Uniswap still does not see the permission for your USDG. Nothing was bought; try again in a minute.",
    );
  }
  if (cause.status >= 500) {
    return new WalletBuyError(
      "unavailable",
      "Uniswap could not prepare the buy right now. Nothing was bought; try again in a moment.",
    );
  }
  return new WalletBuyError("unavailable", cause.message);
}

function noGas(): WalletBuyError {
  return new WalletBuyError(
    "no_gas",
    "Not enough ETH on Robinhood Chain to pay the network gas.",
  );
}

function requireOwner(wallet: WalletAccess): Address {
  if (!wallet.connected || !wallet.address) {
    throw new WalletBuyError(
      "wallet_mismatch",
      "Connect the wallet that will pay for this buy.",
    );
  }
  return getAddress(wallet.address);
}

function parseAmount(value: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new WalletBuyError(
      "unsafe_transaction",
      "The buy amount is not a valid USDG amount.",
    );
  }
  return BigInt(value);
}

function sameAddress(left: string, right: string): boolean {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatUsdG(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
