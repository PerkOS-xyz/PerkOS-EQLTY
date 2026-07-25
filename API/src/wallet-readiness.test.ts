import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
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
      },
    );

    await expect(service.read(owner, "1000000")).resolves.toMatchObject({
      wallet: owner,
      amountIn: "1000000",
      ready: true,
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
      },
    );

    expect((await service.read(owner, "1000000")).ready).toBe(false);
  });
});
