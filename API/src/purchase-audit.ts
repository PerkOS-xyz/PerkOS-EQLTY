import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  http,
  type Log,
  type TransactionReceipt,
} from "viem";
import type { ApiConfig } from "./config.js";
import { eqltyVaultAbi } from "./eqlty-vault-abi.js";
import type {
  ExecutionStrategy,
  TradeRun,
} from "./execution-types.js";
import { FirestoreAuditStore } from "./firestore-audit.js";
import type { EvmAddress } from "./market-types.js";
import { hashPayload } from "./proof-handoff.js";
import type {
  PurchaseAuditBundle,
  PurchaseAuditRecord,
} from "./purchase-audit-types.js";

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
  fetchFn?: typeof fetch;
  store?: Pick<FirestoreAuditStore, "read" | "save">;
  receipt?: (
    hash: `0x${string}`,
  ) => Promise<TransactionReceipt>;
};

export class PurchaseAuditService {
  private readonly store: Pick<FirestoreAuditStore, "read" | "save">;
  private readonly receipt: (
    hash: `0x${string}`,
  ) => Promise<TransactionReceipt>;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.store =
      dependencies.store ??
      new FirestoreAuditStore(config, dependencies.fetchFn);
    this.receipt =
      dependencies.receipt ?? this.createReceiptReader(config);
  }

  async capture(input: {
    owner: EvmAddress;
    idToken: string;
    run: TradeRun;
    strategy: ExecutionStrategy;
  }): Promise<PurchaseAuditBundle> {
    if (
      input.run.status !== "executed" ||
      !input.run.transactionHash ||
      !input.run.market ||
      !input.run.quote ||
      !input.strategy.onchain
    ) {
      throw new Error("Executed run evidence is incomplete");
    }
    const receipt = await this.receipt(input.run.transactionHash);
    const record = buildAuditRecord(
      this.config,
      input.owner,
      input.run,
      input.strategy,
      receipt,
    );
    const bundle: PurchaseAuditBundle = {
      ...record,
      bundleHash: hashPayload(record),
    };
    await this.store.save(input.owner, input.idToken, bundle);
    return bundle;
  }

  async read(
    owner: EvmAddress,
    idToken: string,
    transactionHash: `0x${string}`,
  ): Promise<PurchaseAuditBundle | undefined> {
    return this.store.read(owner, idToken, transactionHash);
  }

  private createReceiptReader(config: ApiConfig) {
    return async (hash: `0x${string}`): Promise<TransactionReceipt> => {
      if (!config.ROBINHOOD_MAINNET_RPC_URL) {
        throw new Error("Robinhood RPC is required for audit capture");
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

export function buildAuditRecord(
  config: ApiConfig,
  owner: EvmAddress,
  run: TradeRun,
  strategy: ExecutionStrategy,
  receipt: TransactionReceipt,
): PurchaseAuditRecord {
  const market = run.market!;
  const quote = run.quote!;
  const onchain = strategy.onchain!;
  const trade = tradeEvent(receipt.logs, config.EQLTY_VAULT_ADDRESS);
  const swap = receipt.logs.find(
    (log) => log.topics[0]?.toLowerCase() === swapTopic,
  );
  if (!trade || !swap || receipt.status !== "success") {
    throw new Error("Execution receipt does not contain verified trade logs");
  }
  const poolId = swap.topics[1];
  if (!poolId) throw new Error("Uniswap V4 swap pool id is missing");
  const ensStep = run.steps.find((step) => step.id === "ens");
  return {
    schema: "urn:eqlty:purchase-audit:v1",
    recordedAt: run.createdAt,
    owner,
    ticker: run.ticker,
    transactionHash: run.transactionHash!,
    strategy: {
      appId: strategy.id,
      onchainId: onchain.strategyId,
      agent: strategy.agent,
      vault: config.EQLTY_VAULT_ADDRESS as EvmAddress,
      inputToken: strategy.inputToken,
      outputToken: strategy.outputToken,
      router: strategy.router,
      amountIn: run.amountIn,
      maxSlippageBps: strategy.maxSlippageBps,
      expiresAt: strategy.expiresAt,
      setupTransactions: {
        creation: onchain.creationTransactionHash,
        approval: onchain.approvalTransactionHash,
        funding: onchain.fundingTransactionHash,
      },
    },
    ens: {
      status: "verified",
      manifestHash: ensStep?.evidence,
      detail: ensStep?.detail,
    },
    graph: {
      request: {
        method: "POST",
        endpoint:
          config.EQLTY_GRAPH_ADAPTER_URL ??
          config.GRAPH_RISK_URL ??
          "unconfigured",
        authorization: "Bearer [server credential]",
        body: { ticker: run.ticker, chainId: "eip155:4663" },
      },
      response: {
        source: "the-graph-substreams",
        evidenceScope: "pre-trade-market",
        provider: market.graphProvider,
        package: market.graphPackage,
        module: market.graphModule,
        evidenceTransaction: market.transactionHash,
        evidenceBlock: market.blockNumber,
        checkpointBlock: market.graphCheckpointBlock,
        processedBlock: market.graphProcessedBlock,
        headBlock: market.graphHeadBlock,
        lagBlocks: market.graphLagBlocks,
        poolManager: market.poolAddress,
        poolId: market.poolIdentifier,
        eventTopic: market.eventTopic,
        capturedAt: market.capturedAt,
      },
    },
    uniswap: {
      routing: quote.routing,
      requestId: quote.requestId,
      quotedAmountOut: quote.quotedAmountOut,
      router: strategy.router,
      poolManager: swap.address as EvmAddress,
      poolId,
      poolMatchedGraphEvidence:
        poolId.toLowerCase() === market.poolIdentifier.toLowerCase(),
      graphPoolRelationship:
        poolId.toLowerCase() === market.poolIdentifier.toLowerCase()
          ? "same-pool"
          : "independent-market-pool",
    },
    proofs: {
      decisionReceipt: run.decisionReceipt,
      proofBundleRoot: run.proofBundleRoot,
      signalHash: trade.signalHash,
      quoteHash: trade.quoteHash,
      handoffs: run.handoffs.map((handoff) => ({
        from: handoff.from,
        to: handoff.to,
        kind: handoff.kind,
        outputHash: handoff.outputHash,
      })),
    },
    receipt: {
      chainId: 4663,
      status: "success",
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      from: receipt.from as EvmAddress,
      to: receipt.to as EvmAddress | undefined,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      tradeLogIndex: trade.logIndex,
      swapLogIndex: Number(swap.logIndex),
    },
    transfers: receipt.logs.flatMap((log) =>
      tokenTransfer(log, strategy, run.ticker),
    ),
    workflow: {
      steps: run.steps,
      handoffs: run.handoffs,
      oneclaw: run.oneclaw,
    },
  };
}

function tradeEvent(
  logs: readonly Log[],
  vault?: string,
):
  | {
      signalHash: `0x${string}`;
      quoteHash: `0x${string}`;
      logIndex: number;
    }
  | undefined {
  for (const log of logs) {
    if (vault && log.address.toLowerCase() !== vault.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: eqltyVaultAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "TradeExecuted") continue;
      return {
        signalHash: decoded.args.signalHash,
        quoteHash: decoded.args.quoteHash,
        logIndex: Number(log.logIndex),
      };
    } catch {
      continue;
    }
  }
}

function tokenTransfer(
  log: Log,
  strategy: ExecutionStrategy,
  ticker: string,
): PurchaseAuditBundle["transfers"] {
  if (log.topics[0]?.toLowerCase() !== transferTopic) return [];
  try {
    const decoded = decodeEventLog({
      abi: transferAbi,
      data: log.data,
      topics: log.topics,
    });
    const token = log.address as EvmAddress;
    return [
      {
        token,
        symbol:
          token.toLowerCase() === strategy.inputToken.toLowerCase()
            ? "USDG"
            : token.toLowerCase() === strategy.outputToken.toLowerCase()
              ? ticker
              : "TOKEN",
        from: decoded.args.from as EvmAddress,
        to: decoded.args.to as EvmAddress,
        amount: decoded.args.value.toString(),
        logIndex: Number(log.logIndex),
      },
    ];
  } catch {
    return [];
  }
}
