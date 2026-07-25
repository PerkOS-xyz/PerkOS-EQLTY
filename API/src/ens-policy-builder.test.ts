import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { buildEnsFleetBundle } from "./ens-policy-builder.js";
import { hashEnsRecord, parseManifest } from "./ens-policy.js";

const agentIds = {
  scout: "agent-scout",
  risk: "agent-risk",
  trader: "agent-trader",
  auditor: "agent-auditor",
};

describe("ENS policy builder", () => {
  it("builds hash-bound settings for every Hermes role", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const config = loadConfig({
      ENS_ROOT_NAME: "demo.eth",
      ENS_POLICY_ALLOWED_TICKERS: "nvda, AMZN,NVDA,orcl",
      ENS_POLICY_TTL_SECONDS: "3600",
    });
    const bundle = buildEnsFleetBundle(config, {
      userId: "u-12345678",
      agentIds,
      now,
    });

    expect(bundle.names.user).toBe("u-12345678.demo.eth");
    expect(bundle.manifest.policy.allowedTickers).toEqual([
      "NVDA",
      "AMZN",
      "ORCL",
    ]);
    expect(bundle.manifest.expiresAt).toBe(
      "2026-07-25T13:00:00.000Z",
    );
    expect(bundle.agents.trader.settings).toMatchObject({
      perkosAgentId: "agent-trader",
      behavior: {
        actions: ["swap-uniswap"],
      },
      security: {
        provider: "1claw",
        enforcement: "required-before-spend",
      },
    });

    for (const [role, reference] of Object.entries(
      bundle.manifest.agentSettings ?? {},
    )) {
      expect(reference.hash).toBe(
        bundle.agents[role as keyof typeof agentIds].settingsHash,
      );
    }
    expect(bundle.manifestHash).toBe(
      hashEnsRecord(bundle.manifestJson),
    );
    expect(
      parseManifest(
        bundle.manifestJson,
        bundle.names.user,
        4663,
        3600,
        now,
      ),
    ).toEqual(bundle.manifest);
  });

  it("requires an ENS root and a nonempty ticker policy", () => {
    expect(() =>
      buildEnsFleetBundle(loadConfig({}), {
        userId: "u-12345678",
        agentIds,
      }),
    ).toThrow("ENS root name is not configured");

    expect(() =>
      buildEnsFleetBundle(
        loadConfig({
          ENS_ROOT_NAME: "demo.eth",
          ENS_POLICY_ALLOWED_TICKERS: " , ",
        }),
        { userId: "u-12345678", agentIds },
      ),
    ).toThrow("at least one ticker");
  });
});
