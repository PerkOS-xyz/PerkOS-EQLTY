import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  getAddress,
  http,
  type Log,
  type TransactionReceipt,
} from "viem";
import type { ApiConfig } from "./config.js";
import { FirestoreSaleStore } from "./firestore-sale.js";
import type {
  GraphEvidence,
  GraphEvidenceService,
} from "./graph-evidence.js";
import type { EvmAddress } from "./market-types.js";
import { hashPayload } from "./proof-handoff.js";
import type {
  SaleAuditBundle,
  SaleAuditRecord,
  SaleHistory,
} from "./sale-audit-types.js";

const swapTopic =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";
const transferTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const transferAbi = [
  {
    type: "event",
    name: "Transfer",
    anonymous: false,
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

type Dependencies = {
  store?: Pick<FirestoreSaleStore, "list" | "save">;
  graph: Pick<GraphEvidenceService, "evidence">;
  receipt?: (
    hash: `0x${string}`,
  ) => Promise<TransactionReceipt>;
  now?: () => Date;
};

export type CaptureSaleInput = {
  owner: EvmAddress;
  idToken: string;
  ticker: string;
  tokenIn: EvmAddress;
  tokenInDecimals: number;
  amountIn: string;
  quotedAmountOut: string;
  requestId: string;
  routing: string;
  transactionHash: `0x${string}`;
  approvalTransactionHash?: `0x${string}`;
};

export class SaleAuditService {
  private readonly store: Pick<FirestoreSaleStore, "list" | "save">;
  private readonly receipt: (
    hash: `0x${string}`,
  ) => Promise<TransactionReceipt>;
  private readonly now: () => Date;

  constructor(
    private readonly config: ApiConfig,
    private readonly dependencies: Dependencies,
  ) {
    this.store =
      dependencies.store ?? new FirestoreSaleStore(config);
    this.receipt =
      dependencies.receipt ?? this.createReceiptReader(config);
    this.now = dependencies.now ?? (() => new Date());
  }

  async capture(input: CaptureSaleInput): Promise<SaleAuditBundle> {
    const receipt = await this.receipt(input.transactionHash);
    const graph = await this.graphEvidence(
      input.ticker,
      input.transactionHash,
    );
    const record = buildSaleRecord(
      this.config,
      input,
      receipt,
      graph,
      this.now(),
    );
    const bundle: SaleAuditBundle = {
      ...record,
      bundleHash: hashPayload(record),
    };
    await this.store.save(input.owner, input.idToken, bundle);
    return bundle;
  }

  list(owner: EvmAddress, idToken: string): Promise<SaleHistory> {
    return this.store.list(owner, idToken);
  }

  private async graphEvidence(
    ticker: string,
    transactionHash: `0x${string}`,
  ): Promise<GraphEvidence | Error> {
    let latest: GraphEvidence | Error = new Error(
      "Onchain evidence has not been observed",
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        latest = await this.dependencies.graph.evidence(ticker);
        if (
          latest.transactionHash.toLowerCase() ===
          transactionHash.toLowerCase()
        ) {
          return latest;
        }
      } catch (error) {
        latest =
          error instanceof Error
            ? error
            : new Error("Onchain evidence failed");
      }
      if (attempt < 2) await wait(1_500);
    }
    return latest;
  }

  private createReceiptReader(config: ApiConfig) {
    return async (hash: `0x${string}`): Promise<TransactionReceipt> => {
      if (!config.ROBINHOOD_MAINNET_RPC_URL) {
        throw new Error("Robinhood RPC is required for sale audit");
      }
      const chain = defineChain({
        id: 4663,
        name: "Robinhood Chain",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: { http: [config.ROBINHOOD_MAINNET_RPC_URL] },
        },
      });
      const client = createPublicClient({
        chain,
        transport: http(config.ROBINHOOD_MAINNET_RPC_URL),
      });
      return client.getTransactionReceipt({ hash });
    };
  }
}

export function buildSaleRecord(
  config: ApiConfig,
  input: CaptureSaleInput,
  receipt: TransactionReceipt,
  graph: GraphEvidence | Error,
  recordedAt: Date,
): SaleAuditRecord {
  const router = config.UNISWAP_UNIVERSAL_ROUTER_ADDRESS as EvmAddress;
  const usdg = config.INPUT_TOKEN_ADDRESS as EvmAddress;
  if (
    receipt.status !== "success" ||
    getAddress(receipt.from) !== getAddress(input.owner) ||
    !receipt.to ||
    getAddress(receipt.to) !== getAddress(router)
  ) {
    throw new Error("Sale receipt does not match the wallet and router");
  }
  const swap = receipt.logs.find(
    (log) => log.topics[0]?.toLowerCase() === swapTopic,
  );
  const poolId = swap?.topics[1];
  if (!swap || !poolId) {
    throw new Error("Sale receipt has no Uniswap V4 swap event");
  }
  const transfers = receipt.logs.flatMap((log) =>
    tokenTransfer(log, input.tokenIn, usdg, input.ticker),
  );
  const sold = transfers
    .filter(
      (transfer) =>
        same(transfer.token, input.tokenIn) &&
        same(transfer.from, input.owner),
    )
    .reduce((sum, transfer) => sum + BigInt(transfer.amount), 0n);
  const received = transfers
    .filter(
      (transfer) =>
        same(transfer.token, usdg) && same(transfer.to, input.owner),
    )
    .reduce((sum, transfer) => sum + BigInt(transfer.amount), 0n);
  if (sold !== BigInt(input.amountIn) || received === 0n) {
    throw new Error("Sale token transfers are incomplete");
  }
  const graphError = graph instanceof Error;
  const evidenceSource = graphError
    ? config.EQLTY_EVIDENCE_PROVIDER === "rpc"
      ? "robinhood-rpc"
      : "the-graph-substreams"
    : graph.source;
  const saleObserved =
    !graphError &&
    same(graph.transactionHash, input.transactionHash);
  const poolMatched =
    !graphError &&
    graph.poolIdentifier.toLowerCase() === poolId.toLowerCase();
  return {
    schema: "urn:eqlty:sale-audit:v1",
    recordedAt: recordedAt.toISOString(),
    owner: input.owner,
    ticker: input.ticker.toUpperCase(),
    transactionHash: input.transactionHash,
    approvalTransactionHash: input.approvalTransactionHash,
    trade: {
      chainId: 4663,
      direction: "sell",
      tokenIn: input.tokenIn,
      tokenInDecimals: input.tokenInDecimals,
      tokenOut: usdg,
      amountIn: input.amountIn,
      quotedAmountOut: input.quotedAmountOut,
      actualAmountOut: received.toString(),
      requestId: input.requestId,
      routing: input.routing,
      router,
    },
    graph: {
      request: {
        method:
          evidenceSource === "robinhood-rpc" ? "eth_getLogs" : "POST",
        endpoint: evidenceEndpoint(config, evidenceSource),
        authorization:
          evidenceSource === "robinhood-rpc"
            ? "Server managed"
            : "Bearer [server credential]",
        body: { ticker: input.ticker.toUpperCase(), chainId: "eip155:4663" },
      },
      response: {
        status: graphError
          ? "unavailable"
          : saleObserved
            ? "observed"
            : "indexed-nearby",
        source: evidenceSource,
        provider: graphError ? undefined : graph.stream.provider,
        package: graphError ? undefined : graph.stream.package,
        module: graphError ? undefined : graph.stream.module,
        evidenceTransaction: graphError
          ? undefined
          : graph.transactionHash as `0x${string}`,
        saleTransaction: input.transactionHash,
        saleObserved,
        evidenceBlock: graphError ? undefined : graph.blockNumber,
        processedBlock: graphError
          ? undefined
          : graph.stream.processedBlock,
        headBlock: graphError
          ? undefined
          : graph.stream.providerHeadBlock,
        lagBlocks: graphError ? undefined : graph.stream.lagBlocks,
        poolManager: graphError
          ? undefined
          : graph.poolAddress as EvmAddress,
        poolId: graphError ? undefined : graph.poolIdentifier,
        salePoolManager: swap.address as EvmAddress,
        salePoolId: poolId,
        poolMatched,
        capturedAt: graphError ? undefined : graph.capturedAt,
        error: graphError ? graph.message : undefined,
      },
    },
    receipt: {
      chainId: 4663,
      status: "success",
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      from: receipt.from as EvmAddress,
      to: receipt.to as EvmAddress,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      swapLogIndex: Number(swap.logIndex),
    },
    transfers,
  };
}

function evidenceEndpoint(
  config: ApiConfig,
  source: "the-graph-substreams" | "robinhood-rpc",
): string {
  if (source === "the-graph-substreams") {
    return config.EQLTY_GRAPH_ADAPTER_URL ??
      config.GRAPH_RISK_URL ??
      "unconfigured";
  }
  if (!config.ROBINHOOD_MAINNET_RPC_URL) return "unconfigured";
  try {
    return new URL(config.ROBINHOOD_MAINNET_RPC_URL).hostname;
  } catch {
    return "configured-rpc";
  }
}

function tokenTransfer(
  log: Log,
  stock: EvmAddress,
  usdg: EvmAddress,
  ticker: string,
): SaleAuditRecord["transfers"] {
  if (log.topics[0]?.toLowerCase() !== transferTopic) return [];
  try {
    const decoded = decodeEventLog({
      abi: transferAbi,
      data: log.data,
      topics: log.topics,
    });
    return [{
      token: log.address as EvmAddress,
      symbol: same(log.address, stock)
        ? ticker.toUpperCase()
        : same(log.address, usdg)
          ? "USDG"
          : "TOKEN",
      from: decoded.args.from as EvmAddress,
      to: decoded.args.to as EvmAddress,
      amount: decoded.args.value.toString(),
      logIndex: Number(log.logIndex),
    }];
  } catch {
    return [];
  }
}

function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
