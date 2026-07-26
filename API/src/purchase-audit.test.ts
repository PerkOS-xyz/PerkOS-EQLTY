import {
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { eqltyVaultAbi } from "./eqlty-vault-abi.js";
import type {
  ExecutionStrategy,
  TradeRun,
} from "./execution-types.js";
import { PurchaseAuditService } from "./purchase-audit.js";

const owner = "0x1111111111111111111111111111111111111111";
const vault = "0x2222222222222222222222222222222222222222";
const trader = "0x3333333333333333333333333333333333333333";
const input = "0x4444444444444444444444444444444444444444";
const output = "0x5555555555555555555555555555555555555555";
const router = "0x6666666666666666666666666666666666666666";
const poolManager = "0x7777777777777777777777777777777777777777";
const hash = `0x${"88".repeat(32)}` as const;
const poolId = `0x${"99".repeat(32)}` as const;
const signalHash = `0x${"aa".repeat(32)}` as const;
const quoteHash = `0x${"bb".repeat(32)}` as const;
const swapTopic =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";

describe("PurchaseAuditService", () => {
  it("stores and reads an immutable wallet scoped audit bundle", async () => {
    let storedBody = "";
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchFn = (async (
      url: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      requests.push([url, init]);
      if (init?.method === "POST") {
        storedBody = String(init.body);
        return new Response("{}", { status: 200 });
      }
      return new Response(storedBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const service = new PurchaseAuditService(
      loadConfig({
        EQLTY_VAULT_ADDRESS: vault,
        EQLTY_GRAPH_ADAPTER_URL:
          "https://eqlty-graph.perkos.xyz/api/graph-risk",
      }),
      {
        fetchFn,
        receipt: async () => receipt(),
      },
    );

    const bundle = await service.capture({
      owner,
      idToken: "firebase-id-token",
      run: run(),
      strategy: strategy(),
    });
    const loaded = await service.read(owner, "firebase-id-token", hash);

    expect(bundle.schema).toBe("urn:eqlty:purchase-audit:v1");
    expect(bundle.uniswap).toMatchObject({
      poolManager,
      poolId,
      poolMatchedGraphEvidence: true,
    });
    expect(bundle.graph.request).toMatchObject({
      method: "POST",
      body: { ticker: "AMZN", chainId: "eip155:4663" },
    });
    expect(bundle.proofs).toMatchObject({ signalHash, quoteHash });
    expect(bundle.transfers).toHaveLength(1);
    expect(loaded).toMatchObject({
      bundleHash: bundle.bundleHash,
      owner,
      transactionHash: hash,
    });
    expect(requests).toHaveLength(2);
    const post = requests[0]!;
    expect(String(post[0])).toContain(
      `/wallets/${owner}/eqlty_audits?documentId=${hash.slice(2)}`,
    );
    expect(storedBody).not.toContain("firebase-id-token");
    expect(storedBody).toContain("Bearer [server credential]");
  });
});

function strategy(): ExecutionStrategy {
  return {
    id: "strategy-app-1",
    ticker: "AMZN",
    owner,
    agent: trader,
    inputToken: input,
    outputToken: output,
    router,
    maxAmountPerTrade: "1000000",
    maxTotalSpend: "1000000",
    spent: "0",
    maxSlippageBps: 100,
    expiresAt: "2026-07-30T00:00:00.000Z",
    status: "active",
    humanProof: {
      provider: "owner-wallet-session",
      status: "verified",
      proofHash: signalHash,
    },
    executionMode: "full",
    onchain: {
      chainId: 4663,
      strategyId: "2",
      creationTransactionHash: signalHash,
      approvalTransactionHash: quoteHash,
      fundingTransactionHash: hash,
    },
  };
}

function run(): TradeRun {
  return {
    id: "run-1",
    strategyId: "strategy-app-1",
    ticker: "AMZN",
    amountIn: "1000000",
    executeRequested: true,
    status: "executed",
    createdAt: "2026-07-25T20:00:00.000Z",
    transactionHash: hash,
    steps: [
      {
        id: "ens",
        label: "ENS fleet policy",
        status: "passed",
        mode: "live",
        detail: "Policy v1 resolved from eqlty.eth.",
        evidence: signalHash,
        at: "2026-07-25T20:00:00.000Z",
      },
    ],
    handoffs: [
      {
        id: "risk-decision",
        from: "risk",
        to: "trader",
        kind: "risk-decision",
        mode: "live",
        status: "sealed",
        outputHash: signalHash,
        at: "2026-07-25T20:00:01.000Z",
      },
    ],
    oneclaw: {
      required: false,
      linked: true,
      minimumAmount: "3000000",
      executionAuthorized: true,
    },
    proofBundleRoot: quoteHash,
    market: {
      liquidityUsd: 100_000,
      lastSwapPrice: 232,
      oraclePrice: 231,
      graphMode: "live",
      blockNumber: "19420000",
      graphProvider: "https://mainnet.eth.streamingfast.io",
      graphPackage: "eqlty_robinhood_stock_v4@v0.1.0",
      graphModule: "map_pool_events",
      graphCheckpointBlock: "19420001",
      graphProcessedBlock: "19420001",
      graphHeadBlock: "19420002",
      graphLagBlocks: 1,
      poolAddress: poolManager,
      poolIdentifier: poolId,
      transactionHash: signalHash,
      eventTopic: swapTopic,
      capturedAt: "2026-07-25T19:59:59.000Z",
    },
    quote: {
      routing: "CLASSIC",
      quotedAmountOut: "4299000000000000",
      requestId: "quote-request-1",
      mode: "live",
    },
  };
}

function receipt(): TransactionReceipt {
  const tradeTopics = encodeEventTopics({
    abi: eqltyVaultAbi,
    eventName: "TradeExecuted",
    args: {
      strategyId: 2n,
      nonce: 0n,
      signalHash,
    },
  });
  const tradeData = encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
    ],
    [quoteHash, 1_000_000n, 4_299_000_000_000_000n, router],
  );
  const transferTopics = [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    `0x${"0".repeat(24)}${vault.slice(2)}`,
    `0x${"0".repeat(24)}${poolManager.slice(2)}`,
  ] as [Hex, Hex, Hex];
  const logs = [
    log(vault, tradeTopics as Log["topics"], tradeData, 10),
    log(poolManager, [swapTopic, poolId], "0x", 11),
    log(
      input,
      transferTopics,
      encodeAbiParameters([{ type: "uint256" }], [1_000_000n]),
      12,
    ),
  ];
  return {
    blockHash: signalHash,
    blockNumber: 19_420_100n,
    contractAddress: null,
    cumulativeGasUsed: 500_000n,
    effectiveGasPrice: 1_000_000n,
    from: trader,
    gasUsed: 400_000n,
    logs,
    logsBloom: `0x${"0".repeat(512)}`,
    status: "success",
    to: vault,
    transactionHash: hash,
    transactionIndex: 1,
    type: "eip1559",
  } as TransactionReceipt;
}

function log(
  address: string,
  topics: [] | [Hex, ...Hex[]],
  data: `0x${string}`,
  logIndex: number,
): Log {
  return {
    address: address as `0x${string}`,
    blockHash: signalHash,
    blockNumber: 19_420_100n,
    data,
    logIndex,
    removed: false,
    topics,
    transactionHash: hash,
    transactionIndex: 1,
  };
}
