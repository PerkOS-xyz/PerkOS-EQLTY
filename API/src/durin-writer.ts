import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  namehash,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import type { ApiConfig } from "./config.js";
import type { EvmAddress } from "./market-types.js";

const registryAbi = parseAbi([
  "function baseNode() view returns (bytes32)",
  "function registrars(address registrar) view returns (bool)",
  "function createSubnode(bytes32 node, string label, address owner, bytes[] data) returns (bytes32)",
  "function setAddr(bytes32 node, address address_)",
  "function setText(bytes32 node, string key, string value)",
]);

export type DurinNodeInput = {
  parentNode: `0x${string}`;
  label: string;
  name: string;
  owner: EvmAddress;
  address: EvmAddress;
  text: string;
};

export interface DurinWriter {
  ready(): boolean;
  registrar(): EvmAddress | undefined;
  baseNode(): Promise<`0x${string}`>;
  registrarApproved(): Promise<boolean>;
  createNode(input: DurinNodeInput): Promise<`0x${string}`>;
}

export class ViemDurinWriter implements DurinWriter {
  private readonly chain;
  private readonly publicClient;
  private readonly walletClient;
  private readonly registry?: EvmAddress;
  private readonly account;
  private networkVerified = false;

  constructor(private readonly config: ApiConfig) {
    this.chain =
      config.EQLTY_ENS_RECORDS_CHAIN_ID === base.id
        ? base
        : baseSepolia;
    this.registry = config.EQLTY_ENS_L2_REGISTRY_ADDRESS as
      | EvmAddress
      | undefined;
    this.account = config.EQLTY_ENS_REGISTRAR_PRIVATE_KEY
      ? privateKeyToAccount(
          config.EQLTY_ENS_REGISTRAR_PRIVATE_KEY as `0x${string}`,
        )
      : undefined;
    const transport = http(config.EQLTY_ENS_RECORDS_RPC_URL);
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport,
    });
    this.walletClient = createWalletClient({
      chain: this.chain,
      transport,
    });
  }

  ready(): boolean {
    return Boolean(
      this.config.EQLTY_ENS_RECORDS_RPC_URL &&
        this.registry &&
        this.account &&
        this.config.ENS_ROOT_NAME,
    );
  }

  registrar(): EvmAddress | undefined {
    return this.account
      ? (getAddress(this.account.address) as EvmAddress)
      : undefined;
  }

  async baseNode(): Promise<`0x${string}`> {
    await this.verifyNetwork();
    return this.publicClient.readContract({
      address: this.requiredRegistry(),
      abi: registryAbi,
      functionName: "baseNode",
    });
  }

  async registrarApproved(): Promise<boolean> {
    await this.verifyNetwork();
    return this.publicClient.readContract({
      address: this.requiredRegistry(),
      abi: registryAbi,
      functionName: "registrars",
      args: [this.requiredAccount().address],
    });
  }

  async createNode(input: DurinNodeInput): Promise<`0x${string}`> {
    await this.verifyNetwork();
    if (namehash(input.name) === input.parentNode) {
      throw new Error("Durin child name cannot equal its parent");
    }
    const childNode = namehash(input.name);
    const data = [
      encodeFunctionData({
        abi: registryAbi,
        functionName: "setAddr",
        args: [childNode, input.address],
      }),
      encodeFunctionData({
        abi: registryAbi,
        functionName: "setText",
        args: [childNode, "agent-context", input.text],
      }),
    ];
    const hash = await this.walletClient.writeContract({
      account: this.requiredAccount(),
      address: this.requiredRegistry(),
      abi: registryAbi,
      functionName: "createSubnode",
      args: [input.parentNode, input.label, input.owner, data],
      chain: this.chain,
      gas: 5_000_000n,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
    });
    if (receipt.status !== "success") {
      throw new Error(`Durin transaction ${hash} reverted`);
    }
    return hash;
  }

  private async verifyNetwork(): Promise<void> {
    if (this.networkVerified) return;
    if (!this.ready()) {
      throw new Error("ENS registrar is not configured");
    }
    const chainId = await this.publicClient.getChainId();
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

  private requiredAccount() {
    if (!this.account) {
      throw new Error("ENS registrar wallet is not configured");
    }
    return this.account;
  }
}
