import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { executionTraderAddress } from "./execution-addresses.js";

describe("execution addresses", () => {
  it("derives the live trader without exposing its private key", () => {
    const config = loadConfig({
      EQLTY_TRADER_PRIVATE_KEY:
        "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412e0367bd93f203c",
      ENS_TRADER_ADDRESS:
        "0x1111111111111111111111111111111111111111",
    });

    expect(executionTraderAddress(config)?.toLowerCase()).toBe(
      "0xf513c94b7d4679e94a7f9fd4206e9ebff1f1597c",
    );
  });
});
