import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters } from "viem";
import { loadConfig } from "./config.js";
import { RpcEvidenceService } from "./rpc-evidence.js";

const poolId = `0x${"22".repeat(32)}` as const;
const transactionHash = `0x${"33".repeat(32)}` as const;
const swapTopic =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f" as const;
const poolManager =
  "0x8366a39cc670b4001a1121b8f6a443a643e40951" as const;
const stock =
  "0x12f190a9F9d7D37a250758b26824B97CE941bF54" as const;
const now = Date.parse("2026-09-06T12:00:00.000Z");

describe("Robinhood RPC evidence", () => {
  it("reports a current onchain checkpoint without exposing the RPC key", async () => {
    const client = rpcClient();
    const service = new RpcEvidenceService(config(), {
      client,
      now: () => now,
      registry: registry(),
    });

    await expect(service.status()).resolves.toMatchObject({
      configured: true,
      status: "ready",
      evidenceProvider: "robinhood-rpc",
      providerName: "rpc.example",
      processedBlock: "10000",
      providerHeadBlock: "10000",
      lagBlocks: 0,
      observedTickers: 1,
    });
    expect(JSON.stringify(await service.status())).not.toContain("private-key");
  });

  it("finds and decodes the latest registered V4 pool swap", async () => {
    const client = rpcClient();
    const service = new RpcEvidenceService(config(), {
      client,
      now: () => now,
      registry: registry(),
    });

    const evidence = await service.evidence("amzn");

    expect(client.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        address: poolManager,
        args: { id: poolId },
        fromBlock: 9_001n,
        toBlock: 10_000n,
      }),
    );
    expect(evidence).toMatchObject({
      source: "robinhood-rpc",
      ticker: "AMZN",
      protocol: "v4",
      blockNumber: "9995",
      lastSwapPrice: 100,
      poolAddress: poolManager,
      poolIdentifier: poolId,
      transactionHash,
      stream: {
        module: "eth_getLogs",
        processedBlock: "10000",
        providerHeadBlock: "10000",
        lagBlocks: 0,
      },
      health: { healthy: true, reasons: [] },
    });
  });

  it("reuses the short evidence cache", async () => {
    const client = rpcClient();
    const service = new RpcEvidenceService(config(), {
      client,
      now: () => now,
      registry: registry(),
    });

    await service.evidence("AMZN");
    await service.evidence("AMZN");

    expect(client.getLogs).toHaveBeenCalledTimes(1);
  });

  it("fails closed when no recent pool event exists", async () => {
    const client = rpcClient();
    client.getLogs.mockResolvedValue([]);
    const service = new RpcEvidenceService(config(), {
      client,
      now: () => now,
      registry: registry(),
    });

    await expect(service.evidence("AMZN")).rejects.toThrow(
      "no recent onchain swap evidence",
    );
    expect(client.getLogs).toHaveBeenCalledTimes(5);
  });
});

function config() {
  return loadConfig({
    ROBINHOOD_MAINNET_RPC_URL:
      "https://rpc.example/v2/private-key",
    EQLTY_EVIDENCE_PROVIDER: "rpc",
    EQLTY_RPC_EVIDENCE_LOOKBACK_BLOCKS: "5000",
    EQLTY_RPC_EVIDENCE_BLOCK_RANGE: "1000",
    GRAPH_MAX_SWAP_AGE_SECONDS: "3600",
  });
}

function registry() {
  return {
    chainId: 4663 as const,
    poolManager,
    assets: {
      AMZN: { ticker: "AMZN", tokenAddress: stock, poolId },
    },
  };
}

function rpcClient() {
  return {
    getChainId: vi.fn(async () => 4663),
    getBlockNumber: vi.fn(async () => 10_000n),
    getBlock: vi.fn(async () => ({ timestamp: BigInt(now / 1_000 - 30) })),
    getLogs: vi.fn(async () => [
      {
        address: poolManager,
        blockNumber: 9_995n,
        data: swapData(),
        logIndex: 7,
        topics: [swapTopic, poolId],
        transactionHash,
      },
    ]),
  };
}

function swapData() {
  return encodeAbiParameters(
    [
      { type: "int128" },
      { type: "int128" },
      { type: "uint160" },
      { type: "uint128" },
      { type: "int24" },
      { type: "uint24" },
    ],
    [
      -10_000_000_000_000_000n,
      1_000_000n,
      2n ** 96n,
      1_000_000_000_000_000_000n,
      0,
      3_000,
    ],
  );
}
