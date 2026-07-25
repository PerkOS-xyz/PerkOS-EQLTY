import { describe, expect, it } from "vitest";
import { encodeAbiParameters } from "viem";
import {
  decodeGraphSwap,
  type GraphPool,
  type GraphStreamEvent,
} from "./graph-adapter-decode.js";

describe("Graph adapter", () => {
  it("decodes a ticker-bound Uniswap V4 swap", () => {
    const pool: GraphPool = {
      ticker: "NVDA",
      tokenAddress: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
      poolId: `0x${"11".repeat(32)}`,
    };
    const event: GraphStreamEvent = {
      address: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
      topics: [
        "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
        pool.poolId,
      ],
      transactionHash: `0x${"22".repeat(32)}`,
      data: encodeAbiParameters(
        [
          { type: "int128" },
          { type: "int128" },
          { type: "uint160" },
          { type: "uint128" },
          { type: "int24" },
          { type: "uint24" },
        ],
        [
          1_000_000n,
          -5_000_000_000_000_000n,
          2n ** 96n,
          1_000_000_000_000n,
          0,
          3_000,
        ],
      ),
      ticker: "NVDA",
      poolIdentifier: pool.poolId,
      protocol: "v4",
    };

    const evidence = decodeGraphSwap(
      pool,
      event,
      "100",
      "2026-07-25T20:00:00.000Z",
      event.address,
    );

    expect(evidence.ticker).toBe("NVDA");
    expect(evidence.lastSwapPrice).toBe(200);
    expect(evidence.transactionHash).toBe(event.transactionHash);
    expect(evidence.liquidityUsd).toBeGreaterThan(0);
  });
});
