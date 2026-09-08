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
    type: "event",
    name: "Approval",
    anonymous: false,
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
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
    type: "event",
    name: "StrategyFunded",
    anonymous: false,
    inputs: [
      { name: "strategyId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "available", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "StrategyWithdrawal",
    anonymous: false,
    inputs: [
      { name: "strategyId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
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
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "strategyId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "nextStrategyId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "strategies",
    stateMutability: "view",
    inputs: [{ name: "strategyId", type: "uint256" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "agent", type: "address" },
      { name: "inputToken", type: "address" },
      { name: "outputToken", type: "address" },
      { name: "router", type: "address" },
      { name: "maxAmountPerTrade", type: "uint128" },
      { name: "maxTotalSpend", type: "uint128" },
      { name: "spent", type: "uint128" },
      { name: "expiresAt", type: "uint64" },
      { name: "maxSlippageBps", type: "uint16" },
      { name: "paused", type: "bool" },
      { name: "revoked", type: "bool" },
      { name: "humanProofHash", type: "bytes32" },
    ],
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

export type RecoverableStrategy = {
  strategyId: string;
  amount: string;
  inputToken: Address;
  outputToken: Address;
};

type EqltyPublicClient = Awaited<
  ReturnType<WalletAccess["getEvmClients"]>
>["publicClient"];

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
  const pending = await findPendingStrategy({
    publicClient,
    owner,
    vault: input.vault,
    strategy: input.strategy,
  });
  let strategyId: bigint;
  let creationTransactionHash: Hex;
  let creationBlock: bigint;
  if (pending) {
    strategyId = pending.strategyId;
    creationTransactionHash = pending.transactionHash;
    creationBlock = pending.blockNumber;
  } else {
    creationTransactionHash = await walletClient.writeContract({
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
    strategyId = created.args.strategyId;
    creationBlock = creationReceipt.blockNumber;
  }

  input.onStage("approving");
  let approvalTransactionHash = await findApprovalTransaction({
    publicClient,
    token: input.strategy.inputToken,
    owner,
    spender: input.vault,
    amount,
    fromBlock: creationBlock,
  });
  let allowance = await readAllowance({
    publicClient,
    token: input.strategy.inputToken,
    owner,
    spender: input.vault,
  });
  if (allowance < amount || !approvalTransactionHash) {
    approvalTransactionHash = await walletClient.writeContract({
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
    allowance = await waitForAllowance({
      publicClient,
      token: input.strategy.inputToken,
      owner,
      spender: input.vault,
      amount,
    });
    if (allowance < amount) {
      throw new Error("USDG approval is lower than the purchase amount");
    }
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
  const funded = parseEventLogs({
    abi: vaultAbi,
    eventName: "StrategyFunded",
    logs: fundingReceipt.logs,
    strict: true,
  }).find((event) => event.args.strategyId === strategyId);
  if (!funded || funded.args.amount < amount || funded.args.available < amount) {
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

async function findPendingStrategy(input: {
  publicClient: EqltyPublicClient;
  owner: Address;
  vault: Address;
  strategy: ExecutionStrategy;
}): Promise<
  | {
      strategyId: bigint;
      transactionHash: Hex;
      blockNumber: bigint;
    }
  | undefined
> {
  const nextStrategyId = await input.publicClient.readContract({
    address: input.vault,
    abi: vaultAbi,
    functionName: "nextStrategyId",
  });
  const expectedExpiry = BigInt(
    Math.floor(Date.parse(input.strategy.expiresAt) / 1_000),
  );
  const latestBlock = await input.publicClient.getBlockNumber();
  const fromBlock = latestBlock > 50_000n ? latestBlock - 50_000n : 0n;

  for (let strategyId = nextStrategyId - 1n; strategyId > 0n; strategyId--) {
    const [available, strategy] = await Promise.all([
      input.publicClient.readContract({
        address: input.vault,
        abi: vaultAbi,
        functionName: "availableBalance",
        args: [strategyId],
      }),
      input.publicClient.readContract({
        address: input.vault,
        abi: vaultAbi,
        functionName: "strategies",
        args: [strategyId],
      }),
    ]);
    if (
      available !== 0n ||
      strategy[7] !== 0n ||
      strategy[10] ||
      strategy[11] ||
      getAddress(strategy[0]) !== getAddress(input.owner) ||
      getAddress(strategy[1]) !== getAddress(input.strategy.agent) ||
      getAddress(strategy[2]) !== getAddress(input.strategy.inputToken) ||
      getAddress(strategy[3]) !== getAddress(input.strategy.outputToken) ||
      getAddress(strategy[4]) !== getAddress(input.strategy.router) ||
      strategy[5] !== BigInt(input.strategy.maxAmountPerTrade) ||
      strategy[6] !== BigInt(input.strategy.maxTotalSpend) ||
      strategy[8] !== expectedExpiry ||
      strategy[9] !== input.strategy.maxSlippageBps ||
      strategy[12] !== input.strategy.humanProof.proofHash
    ) {
      continue;
    }
    const created = (
      await input.publicClient.getLogs({
        address: input.vault,
        event: vaultAbi[0],
        args: { strategyId },
        fromBlock,
        toBlock: latestBlock,
      })
    ).at(-1);
    if (created?.transactionHash && created.blockNumber) {
      return {
        strategyId,
        transactionHash: created.transactionHash,
        blockNumber: created.blockNumber,
      };
    }
  }
  return undefined;
}

async function findApprovalTransaction(input: {
  publicClient: EqltyPublicClient;
  token: Address;
  owner: Address;
  spender: Address;
  amount: bigint;
  fromBlock: bigint;
}): Promise<Hex | undefined> {
  const approvals = await input.publicClient.getLogs({
    address: input.token,
    event: erc20Abi[0],
    args: { owner: input.owner, spender: input.spender },
    fromBlock: input.fromBlock,
    toBlock: "latest",
  });
  return approvals
    .filter(
      (approval) =>
        approval.transactionHash &&
        approval.args.value !== undefined &&
        approval.args.value >= input.amount,
    )
    .at(-1)?.transactionHash;
}

async function readAllowance(input: {
  publicClient: EqltyPublicClient;
  token: Address;
  owner: Address;
  spender: Address;
}): Promise<bigint> {
  return input.publicClient.readContract({
    address: input.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [input.owner, input.spender],
  });
}

async function waitForAllowance(input: {
  publicClient: EqltyPublicClient;
  token: Address;
  owner: Address;
  spender: Address;
  amount: bigint;
}): Promise<bigint> {
  let allowance = 0n;
  for (let attempt = 0; attempt < 10; attempt++) {
    allowance = await readAllowance(input);
    if (allowance >= input.amount) return allowance;
    await delay(400);
  }
  return allowance;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function readRecoverableStrategies(input: {
  wallet: WalletAccess;
  vault: Address;
}): Promise<RecoverableStrategy[]> {
  const owner = requireOwner(input.wallet);
  const { publicClient } =
    await input.wallet.getEvmClients(robinhoodChainId);
  const nextStrategyId = await publicClient.readContract({
    address: input.vault,
    abi: vaultAbi,
    functionName: "nextStrategyId",
  });
  const strategyIds = Array.from(
    { length: Math.max(0, Number(nextStrategyId) - 1) },
    (_, index) => BigInt(index + 1),
  );
  const strategies = await Promise.all(
    strategyIds.map(async (strategyId) => {
      const [available, strategy] = await Promise.all([
        publicClient.readContract({
          address: input.vault,
          abi: vaultAbi,
          functionName: "availableBalance",
          args: [strategyId],
        }),
        publicClient.readContract({
          address: input.vault,
          abi: vaultAbi,
          functionName: "strategies",
          args: [strategyId],
        }),
      ]);
      if (
        available === 0n ||
        getAddress(strategy[0]) !== getAddress(owner)
      ) {
        return undefined;
      }
      return {
        strategyId: strategyId.toString(),
        amount: available.toString(),
        inputToken: strategy[2],
        outputToken: strategy[3],
      } satisfies RecoverableStrategy;
    }),
  );
  return strategies.filter(
    (strategy): strategy is RecoverableStrategy => Boolean(strategy),
  );
}

export async function withdrawRecoverableStrategy(input: {
  wallet: WalletAccess;
  vault: Address;
  strategy: RecoverableStrategy;
}): Promise<Hex> {
  const owner = requireOwner(input.wallet);
  const amount = BigInt(input.strategy.amount);
  const { publicClient, walletClient } =
    await input.wallet.getEvmClients(robinhoodChainId);
  if (
    !walletClient.account ||
    getAddress(walletClient.account.address) !== getAddress(owner)
  ) {
    throw new Error("The active signer does not match the connected wallet");
  }
  const transactionHash = await walletClient.writeContract({
    account: walletClient.account,
    address: input.vault,
    abi: vaultAbi,
    functionName: "withdraw",
    args: [BigInt(input.strategy.strategyId), amount],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });
  assertSuccess(receipt.status, transactionHash);
  const withdrawn = parseEventLogs({
    abi: vaultAbi,
    eventName: "StrategyWithdrawal",
    logs: receipt.logs,
    strict: true,
  }).find(
    (event) =>
      event.args.strategyId === BigInt(input.strategy.strategyId) &&
      event.args.amount === amount,
  );
  if (!withdrawn) {
    throw new Error("The strategy withdrawal event was not found");
  }
  return transactionHash;
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
