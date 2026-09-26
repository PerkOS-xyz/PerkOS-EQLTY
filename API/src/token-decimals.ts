import { createPublicClient, http } from "viem";
import type { ApiConfig } from "./config.js";
import type { EvmAddress } from "./market-types.js";

const decimalsAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

/**
 * ERC-20 decimals() read on Robinhood Chain, once per token for the life of
 * the process. The stock catalog comes live from Robinhood, so a token's
 * decimals are read from its contract instead of being assumed. A failed read
 * is not kept, so the next request tries again.
 */
export class TokenDecimalsReader {
  private readonly known = new Map<string, Promise<number>>();

  constructor(
    private readonly config: ApiConfig,
    private readonly fetchFn?: typeof fetch,
  ) {}

  ready(): boolean {
    return Boolean(this.config.ROBINHOOD_MAINNET_RPC_URL);
  }

  decimals(token: EvmAddress): Promise<number> {
    const key = token.toLowerCase();
    let pending = this.known.get(key);
    if (!pending) {
      pending = this.read(token);
      this.known.set(key, pending);
      pending.catch(() => {
        this.known.delete(key);
      });
    }
    return pending;
  }

  private async read(token: EvmAddress): Promise<number> {
    const rpcUrl = this.config.ROBINHOOD_MAINNET_RPC_URL;
    if (!rpcUrl) {
      throw new Error("Robinhood Chain RPC is not configured");
    }
    const client = createPublicClient({
      transport: http(rpcUrl, {
        timeout: 12_000,
        ...(this.fetchFn ? { fetchFn: this.fetchFn } : {}),
      }),
    });
    if ((await client.getChainId()) !== 4663) {
      throw new Error("Token decimals RPC is not Robinhood Chain");
    }
    return client.readContract({
      address: token,
      abi: decimalsAbi,
      functionName: "decimals",
    });
  }
}
