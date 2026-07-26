import {
  getAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import type { WalletAccess } from "../app/wallet-access-context";
import {
  buildSellTransaction,
  requestSellQuote,
  type WalletSellQuote,
  type WalletSwapTransaction,
} from "./sell-api";

const robinhoodChainId = 4663;

export type SellStage =
  | "idle"
  | "approving"
  | "refreshing"
  | "signing"
  | "building"
  | "executing"
  | "confirming"
  | "recording";

export type WalletSellResult = {
  transactionHash: Hex;
  approvalTransactionHash?: Hex;
  blockNumber: string;
  ticker: string;
  tokenIn: Address;
  amountIn: string;
  amountOut: string;
  requestId: string;
  routing: string;
};

export async function executeWalletSell(input: {
  wallet: WalletAccess;
  quote: WalletSellQuote;
  onStage: (stage: SellStage) => void;
}): Promise<WalletSellResult> {
  const owner = requireOwner(input.wallet);
  const { publicClient, walletClient } =
    await input.wallet.getEvmClients(robinhoodChainId);
  if (
    !walletClient.account ||
    getAddress(walletClient.account.address) !== getAddress(owner)
  ) {
    throw new Error("The active signer does not match this portfolio");
  }

  let quote = input.quote;
  let approvalTransactionHash: Hex | undefined;
  if (quote.approval) {
    input.onStage("approving");
    validateTransaction(quote.approval, owner);
    const approvalHash = await walletClient.sendTransaction({
      account: walletClient.account,
      to: quote.approval.to,
      data: quote.approval.data,
      value: BigInt(quote.approval.value),
    });
    approvalTransactionHash = approvalHash;
    const approvalReceipt =
      await publicClient.waitForTransactionReceipt({
        hash: approvalHash,
      });
    assertSuccess(approvalReceipt.status, approvalHash);
    input.onStage("refreshing");
    quote = await requestSellQuote({
      ticker: quote.ticker,
      tokenIn: quote.tokenIn,
      amountIn: quote.amountIn,
    });
  }

  let signature: Hex | undefined;
  if (quote.permitData) {
    input.onStage("signing");
    const typedData = parsePermitData(quote.permitData);
    signature = await walletClient.signTypedData({
      account: walletClient.account,
      ...typedData,
    });
  }

  input.onStage("building");
  const prepared = await buildSellTransaction({ sell: quote, signature });
  validateTransaction(prepared.transaction, owner);
  input.onStage("executing");
  const transactionHash = await walletClient.sendTransaction({
    account: walletClient.account,
    to: prepared.transaction.to,
    data: prepared.transaction.data,
    value: BigInt(prepared.transaction.value),
  });
  input.onStage("confirming");
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });
  assertSuccess(receipt.status, transactionHash);
  return {
    transactionHash,
    approvalTransactionHash,
    blockNumber: receipt.blockNumber.toString(),
    ticker: quote.ticker,
    tokenIn: quote.tokenIn,
    amountIn: quote.amountIn,
    amountOut: prepared.amountOut,
    requestId: prepared.requestId,
    routing: prepared.routing,
  };
}

function parsePermitData(input: Record<string, unknown>) {
  const domain = record(input.domain, "Permit2 domain");
  const types = record(input.types, "Permit2 types") as Record<
    string,
    readonly { name: string; type: string }[]
  >;
  const message = record(input.values, "Permit2 values");
  const primaryType = [
    "PermitSingle",
    "PermitBatch",
    "PermitTransferFrom",
    "PermitBatchTransferFrom",
  ].find((name) => types[name]);
  if (!primaryType) throw new Error("Permit2 signature type is missing");
  return {
    domain: domain as TypedDataDomain,
    types,
    primaryType,
    message,
  };
}

function validateTransaction(
  transaction: WalletSwapTransaction,
  owner: Address,
): void {
  if (
    transaction.chainId !== robinhoodChainId ||
    getAddress(transaction.from) !== getAddress(owner)
  ) {
    throw new Error("Uniswap transaction does not match this wallet");
  }
  if (!transaction.data || transaction.data === "0x") {
    throw new Error("Uniswap transaction has no calldata");
  }
  if (BigInt(transaction.value) !== 0n) {
    throw new Error("Stock sales cannot spend native ETH");
  }
}

function requireOwner(wallet: WalletAccess): Address {
  if (!wallet.connected || !wallet.address) {
    throw new Error("Connect the wallet that owns this stock token");
  }
  return wallet.address;
}

function record(
  input: unknown,
  label: string,
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} is invalid`);
  }
  return input as Record<string, unknown>;
}

function assertSuccess(status: string, hash: Hex): void {
  if (status !== "success") {
    throw new Error(`Wallet transaction reverted: ${hash}`);
  }
}
