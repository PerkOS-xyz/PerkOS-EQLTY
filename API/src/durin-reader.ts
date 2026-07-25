import {
  createPublicClient,
  getAddress,
  http,
  namehash,
  parseAbi,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import type { ApiConfig } from "./config.js";
import type { EvmAddress } from "./market-types.js";

const registryAbi = parseAbi([
  "function owner(bytes32 node) view returns (address)",
  "function addr(bytes32 node) view returns (address)",
  "function text(bytes32 node, string key) view returns (string)",
]);

export interface DurinReader {
  ready(): boolean;
  owner(name: string): Promise<EvmAddress>;
  address(name: string): Promise<EvmAddress>;
  text(name: string, key: string): Promise<string>;
}

export class ViemDurinReader implements DurinReader {
  private readonly client;
  private readonly registry?: EvmAddress;
  private networkVerified = false;

  constructor(private readonly config: ApiConfig) {
    const chain =
      config.EQLTY_ENS_RECORDS_CHAIN_ID === base.id
        ? base
        : baseSepolia;
    this.registry = config.EQLTY_ENS_L2_REGISTRY_ADDRESS;
    this.client = createPublicClient({
      chain,
      transport: http(config.EQLTY_ENS_RECORDS_RPC_URL),
    });
  }

  ready(): boolean {
    return Boolean(
      this.config.EQLTY_ENS_RECORDS_RPC_URL &&
        this.registry &&
        this.config.ENS_ROOT_NAME,
    );
  }

  async owner(name: string): Promise<EvmAddress> {
    return this.readAddress("owner", name);
  }

  async address(name: string): Promise<EvmAddress> {
    return this.readAddress("addr", name);
  }

  async text(name: string, key: string): Promise<string> {
    await this.verifyNetwork();
    return this.client.readContract({
      address: this.requiredRegistry(),
      abi: registryAbi,
      functionName: "text",
      args: [namehash(name), key],
    });
  }

  private async readAddress(
    functionName: "owner" | "addr",
    name: string,
  ): Promise<EvmAddress> {
    await this.verifyNetwork();
    const value = await this.client.readContract({
      address: this.requiredRegistry(),
      abi: registryAbi,
      functionName,
      args: [namehash(name)],
    });
    return getAddress(value);
  }

  private async verifyNetwork(): Promise<void> {
    if (this.networkVerified) return;
    if (!this.ready()) {
      throw new Error("ENS L2 records are not configured");
    }
    const chainId = await this.client.getChainId();
    if (chainId !== this.config.EQLTY_ENS_RECORDS_CHAIN_ID) {
      throw new Error(
        `ENS records RPC returned chain ${chainId}, expected ${this.config.EQLTY_ENS_RECORDS_CHAIN_ID}`,
      );
    }
    this.networkVerified = true;
  }

  private requiredRegistry(): EvmAddress {
    if (!this.registry) {
      throw new Error("ENS L2 registry address is not configured");
    }
    return this.registry;
  }
}
