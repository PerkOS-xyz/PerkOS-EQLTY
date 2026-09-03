import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import {
  executionAccountForStrategy,
  executionTraderAddress,
  gasSponsorAccount,
  isExecutionTraderAddress,
} from "./execution-addresses.js";

const sharedKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412e0367bd93f203c";
const masterKey =
  "0x8b3a350cf5c34c9194ca3a545d0c3e06f4b7e6e67e8d9e5a2d4f34d4f994a08a";
const ownerA = "0x1111111111111111111111111111111111111111";
const ownerB = "0x2222222222222222222222222222222222222222";

describe("execution addresses", () => {
  it("derives the shared trader without exposing its private key", () => {
    const config = loadConfig({
      EQLTY_SERVER_WALLET_MODE: "shared",
      EQLTY_TRADER_PRIVATE_KEY: sharedKey,
      ENS_TRADER_ADDRESS:
        "0x1111111111111111111111111111111111111111",
    });

    expect(executionTraderAddress(config)?.toLowerCase()).toBe(
      "0xf513c94b7d4679e94a7f9fd4206e9ebff1f1597c",
    );
  });

  it("derives a stable isolated wallet for each owner", () => {
    const config = loadConfig({
      EQLTY_SERVER_WALLET_MODE: "per-user",
      EQLTY_SERVER_WALLET_MASTER_KEY: masterKey,
      EQLTY_TRADER_PRIVATE_KEY: sharedKey,
      EQLTY_VAULT_ADDRESS:
        "0x033f13BC2CCB53dbfBEef7594668F9cfa4A70833",
    });

    const first = executionTraderAddress(config, ownerA);
    const repeated = executionTraderAddress(config, ownerA);
    const second = executionTraderAddress(config, ownerB);

    expect(first).toBe(repeated);
    expect(first).not.toBe(second);
    expect(first?.toLowerCase()).not.toBe(
      executionTraderAddress(config)?.toLowerCase(),
    );
  });

  it("keeps historical shared strategies executable", () => {
    const config = loadConfig({
      EQLTY_SERVER_WALLET_MODE: "per-user",
      EQLTY_SERVER_WALLET_MASTER_KEY: masterKey,
      EQLTY_TRADER_PRIVATE_KEY: sharedKey,
      EQLTY_VAULT_ADDRESS:
        "0x033f13BC2CCB53dbfBEef7594668F9cfa4A70833",
    });
    const isolated = executionTraderAddress(config, ownerA)!;
    const shared = executionTraderAddress(config)!;

    expect(isExecutionTraderAddress(config, ownerA, isolated)).toBe(true);
    expect(isExecutionTraderAddress(config, ownerA, shared)).toBe(true);
    expect(
      executionAccountForStrategy(config, ownerA, isolated).address,
    ).toBe(isolated);
    expect(
      executionAccountForStrategy(config, ownerA, shared).address,
    ).toBe(shared);
    expect(() =>
      executionAccountForStrategy(config, ownerA, ownerB),
    ).toThrow("does not match");
  });

  it("supports a separate gas sponsor key", () => {
    const config = loadConfig({
      EQLTY_TRADER_PRIVATE_KEY: sharedKey,
      EQLTY_GAS_SPONSOR_PRIVATE_KEY: masterKey,
    });

    expect(gasSponsorAccount(config)?.address).not.toBe(
      executionTraderAddress(config),
    );
  });
});
