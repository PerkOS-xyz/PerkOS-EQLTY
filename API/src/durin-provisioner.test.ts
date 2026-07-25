import { namehash } from "viem";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { DurinFleetProvisioner } from "./durin-provisioner.js";
import type { DurinReader } from "./durin-reader.js";
import type {
  DurinNodeInput,
  DurinWriter,
} from "./durin-writer.js";
import type { EvmAddress } from "./market-types.js";

const zeroAddress =
  "0x0000000000000000000000000000000000000000" as EvmAddress;
const owner =
  "0x1111111111111111111111111111111111111111" as EvmAddress;
const registrar =
  "0x2222222222222222222222222222222222222222" as EvmAddress;
const roleAddresses = {
  scout: "0x3333333333333333333333333333333333333333",
  risk: "0x4444444444444444444444444444444444444444",
  trader: "0x5555555555555555555555555555555555555555",
  auditor: "0x6666666666666666666666666666666666666666",
};
const agentIds = {
  scout: "agent-scout",
  risk: "agent-risk",
  trader: "agent-trader",
  auditor: "agent-auditor",
};

describe("Durin fleet provisioner", () => {
  it("creates missing nodes and becomes idempotent after verification", async () => {
    const records = new MemoryRecords();
    const writer = new MemoryWriter(records);
    const provisioner = new DurinFleetProvisioner(config(), {
      reader: records,
      writer,
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    });

    const first = await provisioner.provision({
      userId: "u-12345678",
      owner,
      agentIds,
    });
    const second = await provisioner.provision({
      userId: "u-12345678",
      owner,
      agentIds,
    });

    expect(first.created).toEqual([
      "u-12345678.demo.eth",
      "scout.u-12345678.demo.eth",
      "risk.u-12345678.demo.eth",
      "trader.u-12345678.demo.eth",
      "auditor.u-12345678.demo.eth",
    ]);
    expect(first.transactions).toHaveLength(5);
    expect(first.verified).toBe(true);
    expect(second.created).toEqual([]);
    expect(second.transactions).toEqual([]);
    expect(second.bundle.manifestHash).toBe(first.bundle.manifestHash);
    expect(writer.calls).toBe(5);
  });

  it("refuses unapproved registrars and conflicting records", async () => {
    const records = new MemoryRecords();
    const writer = new MemoryWriter(records);
    writer.approved = false;
    const provisioner = new DurinFleetProvisioner(config(), {
      reader: records,
      writer,
    });

    await expect(
      provisioner.provision({
        userId: "u-12345678",
        owner,
        agentIds,
      }),
    ).rejects.toThrow("is not approved");

    writer.approved = true;
    await provisioner.provision({
      userId: "u-12345678",
      owner,
      agentIds,
    });
    records.texts.set(
      "scout.u-12345678.demo.eth",
      '{"changed":true}',
    );
    await expect(
      provisioner.provision({
        userId: "u-12345678",
        owner,
        agentIds,
      }),
    ).rejects.toThrow("cannot be overwritten");
  });
});

function config() {
  return loadConfig({
    ENS_ROOT_NAME: "demo.eth",
    EQLTY_ENS_RECORDS_RPC_URL: "https://base-sepolia.example",
    EQLTY_ENS_L2_REGISTRY_ADDRESS:
      "0x7777777777777777777777777777777777777777",
    EQLTY_ENS_REGISTRAR_PRIVATE_KEY: `0x${"88".repeat(32)}`,
    ENS_SCOUT_ADDRESS: roleAddresses.scout,
    ENS_RISK_ADDRESS: roleAddresses.risk,
    ENS_TRADER_ADDRESS: roleAddresses.trader,
    ENS_AUDITOR_ADDRESS: roleAddresses.auditor,
  });
}

class MemoryRecords implements DurinReader {
  readonly owners = new Map<string, EvmAddress>();
  readonly addresses = new Map<string, EvmAddress>();
  readonly texts = new Map<string, string>();

  ready(): boolean {
    return true;
  }

  async owner(name: string): Promise<EvmAddress> {
    return this.owners.get(name) ?? zeroAddress;
  }

  async address(name: string): Promise<EvmAddress> {
    return this.addresses.get(name) ?? zeroAddress;
  }

  async text(name: string): Promise<string> {
    return this.texts.get(name) ?? "";
  }
}

class MemoryWriter implements DurinWriter {
  approved = true;
  calls = 0;

  constructor(private readonly records: MemoryRecords) {}

  ready(): boolean {
    return true;
  }

  registrar(): EvmAddress {
    return registrar;
  }

  async baseNode(): Promise<`0x${string}`> {
    return namehash("demo.eth");
  }

  async registrarApproved(): Promise<boolean> {
    return this.approved;
  }

  async createNode(input: DurinNodeInput): Promise<`0x${string}`> {
    this.calls += 1;
    this.records.owners.set(input.name, input.owner);
    this.records.addresses.set(input.name, input.address);
    this.records.texts.set(input.name, input.text);
    return `0x${this.calls.toString(16).padStart(64, "0")}`;
  }
}
