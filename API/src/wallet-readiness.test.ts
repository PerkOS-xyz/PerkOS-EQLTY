import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import {
  executionTraderAddress,
  gasSponsorAccount,
} from "./execution-addresses.js";
import { WalletReadinessService } from "./wallet-readiness.js";

const owner =
  "0xc2564e41B7F5Cb66d2d99466450CfebcE9e8228f" as const;

describe("wallet readiness", () => {
  it("reports enough gas, USDG and deployed vault code", async () => {
    const service = new WalletReadinessService(
      loadConfig({
        EQLTY_VAULT_ADDRESS:
          "0x033f13BC2CCB53dbfBEef7594668F9cfa4A70833",
      }),
      {
        nativeBalance: async () => 3_700_000_000_000_000n,
        usdGBalance: async () => 7_963_158n,
        vaultReady: async () => true,
        gasPrice: async () => 300_000_000n,
        now: () => new Date("2026-09-07T18:00:00.000Z"),
      },
    );

    await expect(service.read(owner, "1000000")).resolves.toMatchObject({
      wallet: owner,
      amountIn: "1000000",
      ready: true,
      costEstimate: {
        model: "observed-mainnet-v1",
        ownerSetupGas: {
          gasUnits: "338080",
          estimatedCostWei: "121708800000000",
        },
        sponsoredExecutionGas: {
          gasUnits: "323495",
          estimatedCostWei: "116458200000000",
        },
        estimatedAt: "2026-09-07T18:00:00.000Z",
      },
      checks: {
        gas: true,
        funds: true,
        vault: true,
      },
    });
  });

  it("blocks preparation when the wallet cannot cover the purchase", async () => {
    const service = new WalletReadinessService(
      loadConfig({
        EQLTY_VAULT_ADDRESS:
          "0x033f13BC2CCB53dbfBEef7594668F9cfa4A70833",
      }),
      {
        nativeBalance: async () => 1n,
        usdGBalance: async () => 999_999n,
        vaultReady: async () => true,
        gasPrice: async () => 300_000_000n,
      },
    );

    expect((await service.read(owner, "1000000")).ready).toBe(false);
  });

  it("blocks preparation when the agent wallet has no gas and the sponsor cannot top it up", async () => {
    const config = loadConfig({
      EQLTY_VAULT_ADDRESS: "0x033f13BC2CCB53dbfBEef7594668F9cfa4A70833",
      EQLTY_SERVER_WALLET_MASTER_KEY: `0x${"11".repeat(32)}`,
      EQLTY_GAS_SPONSOR_PRIVATE_KEY: `0x${"22".repeat(32)}`,
    });
    const serverWallet = executionTraderAddress(config, owner)!.toLowerCase();
    const sponsor = gasSponsorAccount(config)!.address.toLowerCase();
    const service = (sponsorBalance: bigint) =>
      new WalletReadinessService(config, {
        nativeBalance: async (address) => {
          const key = address.toLowerCase();
          if (key === serverWallet) return 0n;
          if (key === sponsor) return sponsorBalance;
          return 3_700_000_000_000_000n;
        },
        usdGBalance: async () => 7_963_158n,
        vaultReady: async () => true,
        gasPrice: async () => 300_000_000n,
      });

    const short = await service(200_000_000_000_000n).read(owner, "1000000");
    expect(short.checks.execution).toBe(false);
    expect(short.ready).toBe(false);

    const funded = await service(10_000_000_000_000_000n).read(owner, "1000000");
    expect(funded.checks.execution).toBe(true);
    expect(funded.ready).toBe(true);
  });
});
