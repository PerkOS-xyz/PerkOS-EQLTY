import {
  encodeAbiParameters,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import type { GraphEvidence } from "./graph-evidence.js";
import {
  buildSaleRecord,
  SaleAuditService,
  type CaptureSaleInput,
} from "./sale-audit.js";

const owner = "0x1111111111111111111111111111111111111111";
const stock = "0x2222222222222222222222222222222222222222";
const usdg = "0x3333333333333333333333333333333333333333";
const router = "0x4444444444444444444444444444444444444444";
const poolManager =
  "0x5555555555555555555555555555555555555555";
const transactionHash = `0x${"66".repeat(32)}` as const;
const blockHash = `0x${"77".repeat(32)}` as const;
const poolId = `0x${"88".repeat(32)}` as const;
const swapTopic =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";
const transferTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const config = loadConfig({
  INPUT_TOKEN_ADDRESS: usdg,
  UNISWAP_UNIVERSAL_ROUTER_ADDRESS: router,
  EQLTY_GRAPH_ADAPTER_URL:
    "https://eqlty-graph.perkos.xyz/api/graph-risk",
});

describe("SaleAuditService", () => {
  it("verifies and stores a wallet sale with Graph evidence", async () => {
    const save = vi.fn(async () => undefined);
    const service = new SaleAuditService(config, {
      store: {
        save,
        list: async () => ({ entries: [] }),
      },
      graph: { evidence: async () => graphEvidence() },
      receipt: async () => receipt(),
      now: () => new Date("2026-07-25T22:00:00.000Z"),
    });

    const bundle = await service.capture(captureInput());

    expect(bundle).toMatchObject({
      schema: "urn:eqlty:sale-audit:v1",
      owner,
      ticker: "AMZN",
      transactionHash,
      trade: {
        direction: "sell",
        actualAmountOut: "995000",
        router,
      },
      graph: {
        response: {
          status: "observed",
          saleObserved: true,
          poolMatched: true,
          salePoolId: poolId,
        },
      },
      receipt: { status: "success", blockNumber: "19420100" },
    });
    expect(bundle.bundleHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(bundle.transfers).toEqual([
      expect.objectContaining({
        symbol: "AMZN",
        from: owner,
        amount: "4299000000000000",
      }),
      expect.objectContaining({
        symbol: "USDG",
        to: owner,
        amount: "995000",
      }),
    ]);
    expect(save).toHaveBeenCalledWith(
      owner,
      "firebase-id-token",
      bundle,
    );
  });

  it("rejects a receipt without a Uniswap V4 swap event", () => {
    const invalid = receipt();
    invalid.logs = invalid.logs.slice(1);

    expect(() =>
      buildSaleRecord(
        config,
        captureInput(),
        invalid,
        graphEvidence(),
        new Date(),
      ),
    ).toThrow("no Uniswap V4 swap event");
  });
});

function captureInput(): CaptureSaleInput {
  return {
    owner,
    idToken: "firebase-id-token",
    ticker: "AMZN",
    tokenIn: stock,
    tokenInDecimals: 18,
    amountIn: "4299000000000000",
    quotedAmountOut: "990000",
    requestId: "sale-request-1",
    routing: "CLASSIC",
    transactionHash,
  };
}

function graphEvidence(): GraphEvidence {
  return {
    source: "the-graph-substreams",
    ticker: "AMZN",
    chainId: "eip155:4663",
    protocol: "v4",
    blockNumber: "19420100",
    liquidityUsd: 100_000,
    lastSwapPrice: 231.45,
    poolAddress: poolManager,
    poolIdentifier: poolId,
    transactionHash,
    topic: swapTopic,
    capturedAt: "2026-07-25T21:59:59.000Z",
    evaluatedAt: "2026-07-25T22:00:00.000Z",
    stream: {
      mode: "live",
      provider: "https://mainnet.eth.streamingfast.io",
      package: "eqlty_robinhood_stock_v4@v0.1.0",
      module: "map_pool_events",
      startedAt: "2026-07-25T21:00:00.000Z",
      updatedAt: "2026-07-25T22:00:00.000Z",
      checkpointBlock: "19420099",
      processedBlock: "19420100",
      providerHeadBlock: "19420101",
      lagBlocks: 1,
    },
    health: {
      healthy: true,
      heartbeatAgeSeconds: 0,
      swapAgeSeconds: 1,
      reasons: [],
    },
  };
}

function receipt(): TransactionReceipt {
  const logs = [
    log(poolManager, [swapTopic, poolId], "0x", 10),
    transferLog(
      stock,
      owner,
      poolManager,
      4_299_000_000_000_000n,
      11,
    ),
    transferLog(usdg, poolManager, owner, 995_000n, 12),
  ];
  return {
    blockHash,
    blockNumber: 19_420_100n,
    contractAddress: null,
    cumulativeGasUsed: 500_000n,
    effectiveGasPrice: 1_000_000n,
    from: owner,
    gasUsed: 400_000n,
    logs,
    logsBloom: `0x${"0".repeat(512)}`,
    status: "success",
    to: router,
    transactionHash,
    transactionIndex: 1,
    type: "eip1559",
  } as TransactionReceipt;
}

function transferLog(
  token: string,
  from: string,
  to: string,
  amount: bigint,
  index: number,
): Log {
  return log(
    token,
    [
      transferTopic,
      addressTopic(from),
      addressTopic(to),
    ],
    encodeAbiParameters([{ type: "uint256" }], [amount]),
    index,
  );
}

function addressTopic(address: string): Hex {
  return `0x${"0".repeat(24)}${address.slice(2)}` as Hex;
}

function log(
  address: string,
  topics: [] | [Hex, ...Hex[]],
  data: Hex,
  logIndex: number,
): Log {
  return {
    address: address as `0x${string}`,
    blockHash,
    blockNumber: 19_420_100n,
    data,
    logIndex,
    removed: false,
    topics,
    transactionHash,
    transactionIndex: 1,
  };
}
