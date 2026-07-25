import {
  getAddress,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import type { WalletAccess } from "../app/wallet-access-context";
import type {
  ExecutionStrategy,
  OnchainStrategy,
} from "./execution-types";

const robinhoodChainId = 4663;

const erc20Abi = [
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
] as const;

const vaultAbi = [
  {
    type: "event",
    name: "StrategyCreated",
    anonymous: false,
    inputs: [
      { name: "strategyId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "agent", type: "address", indexed: true },
      { name: "inputToken", type: "address", indexed: false },
      { name: "outputToken", type: "address", indexed: false },
      { name: "router", type: "address", indexed: false },
      { name: "maxAmountPerTrade", type: "uint256", indexed: false },
      { name: "maxTotalSpend", type: "uint256", indexed: false },
      { name: "expiresAt", type: "uint256", indexed: false },
      { name: "maxSlippageBps", type: "uint256", indexed: false },
      { name: "humanProofHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "function",
    name: "createStrategy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agent", type: "address" },
      { name: "inputToken", type: "address" },
      { name: "outputToken", type: "address" },
      { name: "router", type: "address" },
      { name: "maxAmountPerTrade", type: "uint128" },
      { name: "maxTotalSpend", type: "uint128" },
      { name: "expiresAt", type: "uint64" },
      { name: "maxSlippageBps", type: "uint16" },
      { name: "humanProofHash", type: "bytes32" },
    ],
    outputs: [{ name: "strategyId", type: "uint256" }],
  },
  {
    type: "function",
    name: "fundStrategy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "strategyId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "availableBalance",
    stateMutability: "view",
    inputs: [{ name: "strategyId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type PurchaseStage =
  | "idle"
  | "checking"
  | "creating"
  | "approving"
  | "funding"
  | "linking"
  | "executing";

export async function provisionWalletStrategy(input: {
  wallet: WalletAccess;
  strategy: ExecutionStrategy;
  vault: Address;
  amountIn: string;
  onStage: (stage: PurchaseStage) => void;
}): Promise<OnchainStrategy> {
  const owner = requireOwner(input.wallet);
  const amount = BigInt(input.amountIn);
  input.onStage("checking");
  const { publicClient, walletClient } =
    await input.wallet.getEvmClients(robinhoodChainId);
  if (
    !walletClient.account ||
    getAddress(walletClient.account.address) !== getAddress(owner)
  ) {
    throw new Error("The active signer does not match the connected wallet");
  }
  const code = await publicClient.getCode({ address: input.vault });
  if (!code || code === "0x") {
    throw new Error("The EQLTY vault is not deployed on Robinhood Chain");
  }
  const balance = await publicClient.readContract({
    address: input.strategy.inputToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
  if (balance < amount) {
    throw new Error(
      `Your wallet needs ${formatUsdG(amount)} USDG on Robinhood Chain`,
    );
  }

  input.onStage("creating");
  const creationTransactionHash = await walletClient.writeContract({
    account: walletClient.account,
    address: input.vault,
    abi: vaultAbi,
    functionName: "createStrategy",
    args: [
      input.strategy.agent,
      input.strategy.inputToken,
      input.strategy.outputToken,
      input.strategy.router,
      BigInt(input.strategy.maxAmountPerTrade),
      BigInt(input.strategy.maxTotalSpend),
      BigInt(Math.floor(Date.parse(input.strategy.expiresAt) / 1_000)),
      input.strategy.maxSlippageBps,
      input.strategy.humanProof.proofHash,
    ],
  });
  const creationReceipt = await publicClient.waitForTransactionReceipt({
    hash: creationTransactionHash,
  });
  assertSuccess(creationReceipt.status, creationTransactionHash);
  const created = parseEventLogs({
    abi: vaultAbi,
    eventName: "StrategyCreated",
    logs: creationReceipt.logs,
    strict: true,
  }).find(
    (event) => getAddress(event.args.owner) === getAddress(owner),
  );
  if (!created) {
    throw new Error("The wallet strategy creation event was not found");
  }
  const strategyId = created.args.strategyId;

  input.onStage("approving");
  const approvalTransactionHash = await walletClient.writeContract({
    account: walletClient.account,
    address: input.strategy.inputToken,
    abi: erc20Abi,
    functionName: "approve",
    args: [input.vault, amount],
  });
  const approvalReceipt = await publicClient.waitForTransactionReceipt({
    hash: approvalTransactionHash,
  });
  assertSuccess(approvalReceipt.status, approvalTransactionHash);
  const allowance = await publicClient.readContract({
    address: input.strategy.inputToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, input.vault],
  });
  if (allowance < amount) {
    throw new Error("USDG approval is lower than the purchase amount");
  }

  input.onStage("funding");
  const fundingTransactionHash = await walletClient.writeContract({
    account: walletClient.account,
    address: input.vault,
    abi: vaultAbi,
    functionName: "fundStrategy",
    args: [strategyId, amount],
  });
  const fundingReceipt = await publicClient.waitForTransactionReceipt({
    hash: fundingTransactionHash,
  });
  assertSuccess(fundingReceipt.status, fundingTransactionHash);
  const available = await publicClient.readContract({
    address: input.vault,
    abi: vaultAbi,
    functionName: "availableBalance",
    args: [strategyId],
  });
  if (available < amount) {
    throw new Error("The funded strategy balance is incomplete");
  }

  return {
    chainId: robinhoodChainId,
    strategyId: strategyId.toString(),
    creationTransactionHash,
    approvalTransactionHash,
    fundingTransactionHash,
  };
}

function requireOwner(wallet: WalletAccess): Address {
  if (!wallet.connected || !wallet.address) {
    throw new Error("Connect your wallet before preparing a purchase");
  }
  return wallet.address;
}

function assertSuccess(status: string, hash: Hex): void {
  if (status !== "success") {
    throw new Error(`Wallet transaction reverted: ${hash}`);
  }
}

function formatUsdG(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
