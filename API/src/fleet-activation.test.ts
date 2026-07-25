import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { FleetActivationService } from "./fleet-activation.js";
import type { FleetRole, FleetRuntime } from "./fleet-types.js";

const owner =
  "0x1111111111111111111111111111111111111111" as const;
const roles: FleetRole[] = ["scout", "risk", "trader", "auditor"];

describe("fleet activation", () => {
  it("waits for real PerkOS agent ids before writing ENS", async () => {
    const provision = vi.fn();
    const service = new FleetActivationService(config(), {
      perkos: { activate: async () => runtime(false) },
      controlPlane: { resolve: vi.fn() },
      provisioner: { provision },
    });

    const activation = await service.activate({
      userId: "u-12345678",
      owner,
      perkosIdToken: "firebase-token",
    });

    expect(activation).toMatchObject({
      status: "provisioning",
      verified: false,
      rootName: "u-12345678.demo.eth",
    });
    expect(provision).not.toHaveBeenCalled();
  });

  it("reactivates an already verified fleet without writing", async () => {
    const provision = vi.fn();
    const service = new FleetActivationService(config(), {
      perkos: { activate: async () => runtime(true) },
      controlPlane: {
        resolve: async () => ({
          source: "durin",
          mode: "live",
          status: "active",
          rootName: "u-12345678.demo.eth",
          manifestHash: `0x${"ab".repeat(32)}` as const,
          resolvedAt: "2026-07-25T12:00:00.000Z",
          agentSettings: Object.fromEntries(
            roles.map((role) => [
              role,
              { perkosAgentId: `stored-${role}` },
            ]),
          ),
        }),
      },
      provisioner: { provision },
    });

    const activation = await service.activate({
      userId: "u-12345678",
      owner,
      perkosIdToken: "firebase-token",
    });

    expect(activation.status).toBe("reactivated");
    expect(activation.agents.scout).toBe("stored-scout");
    expect(provision).not.toHaveBeenCalled();
  });

  it("keeps the runtime available while ENS records are resolving", async () => {
    const provision = vi.fn();
    const service = new FleetActivationService(config(), {
      perkos: { activate: async () => runtime(true) },
      controlPlane: {
        resolve: async () => await new Promise<never>(() => undefined),
      },
      provisioner: { provision },
      ensResolveTimeoutMs: 1,
    });

    const activation = await service.activate({
      userId: "u-12345678",
      owner,
      perkosIdToken: "firebase-token",
    });

    expect(activation).toMatchObject({
      status: "provisioning",
      verified: false,
      rootName: "u-12345678.demo.eth",
      runtime: { status: "ready" },
    });
    expect(provision).not.toHaveBeenCalled();
  });

  it("provisions missing names and verifies them by rereading", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce({
        source: "durin",
        mode: "live",
        status: "unavailable",
        resolvedAt: "2026-07-25T12:00:00.000Z",
      })
      .mockResolvedValueOnce({
        source: "durin",
        mode: "live",
        status: "active",
        rootName: "u-12345678.demo.eth",
        manifestHash: `0x${"cd".repeat(32)}`,
        resolvedAt: "2026-07-25T12:00:01.000Z",
      });
    const provision = vi.fn().mockResolvedValue({
      transactions: [`0x${"ef".repeat(32)}`],
    });
    const service = new FleetActivationService(config(), {
      perkos: { activate: async () => runtime(true) },
      controlPlane: { resolve },
      provisioner: { provision },
    });

    const activation = await service.activate({
      userId: "u-12345678",
      owner,
      perkosIdToken: "firebase-token",
    });

    expect(activation).toMatchObject({
      status: "provisioned",
      verified: true,
      transactions: [`0x${"ef".repeat(32)}`],
    });
    expect(provision).toHaveBeenCalledWith({
      userId: "u-12345678",
      owner,
      agentIds: {
        scout: "agent-scout",
        risk: "agent-risk",
        trader: "agent-trader",
        auditor: "agent-auditor",
      },
    });
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

function config() {
  return loadConfig({ ENS_ROOT_NAME: "demo.eth" });
}

function runtime(realIds: boolean): FleetRuntime {
  return {
    provider: "perkos",
    mode: "live",
    status: realIds ? "ready" : "provisioning",
    agents: roles.map((role) => ({
      role,
      ...(realIds ? { agentId: `agent-${role}` } : {}),
      name: `eqlty-${role}-12345678`,
      runtime: "Hermes",
      state: realIds ? "ready" : "provisioning",
      plugins: [],
      oneclaw: "pending-agent-credential",
    })),
  };
}
