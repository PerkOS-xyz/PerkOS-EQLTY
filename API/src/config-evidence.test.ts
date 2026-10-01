import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("swap evidence window", () => {
  it("looks back about three hours of Robinhood Chain blocks by default", () => {
    const config = loadConfig({});
    expect(config.EQLTY_RPC_EVIDENCE_LOOKBACK_BLOCKS).toBe(100_000);
    expect(config.EQLTY_RPC_EVIDENCE_BLOCK_RANGE).toBe(10_000);
  });

  it("allows a longer window for quiet hours", () => {
    expect(loadConfig({ EQLTY_RPC_EVIDENCE_LOOKBACK_BLOCKS: "1000000" }).EQLTY_RPC_EVIDENCE_LOOKBACK_BLOCKS).toBe(1_000_000);
  });
});
