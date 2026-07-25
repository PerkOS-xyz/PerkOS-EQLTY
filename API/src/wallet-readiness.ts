import {
  createPublicClient,
  defineChain,
  http,
  type Address,
} from "viem";
import type { ApiConfig } from "./config.js";
import type { EvmAddress } from "./market-types.js";

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

type Dependencies = {
  nativeBalance?: (owner: Address) => Promise<bigint>;
  usdGBalance?: (owner: Address) => Promise<bigint>;
  vaultReady?: (vault: Address) => Promise<boolean>;
};

export type WalletReadiness = {
  chainId: 4663;
  network: "Robinhood Chain";
  wallet: EvmAddress;
  vault: EvmAddress;
  nativeBalance: string;
  usdGBalance: string;
  amountIn: string;
  ready: boolean;
  checks: {
    gas: boolean;
    funds: boolean;
    vault: boolean;
  };
};

export class WalletReadinessService {
  private readonly nativeBalance: (owner: Address) => Promise<bigint>;
  private readonly usdGBalance: (owner: Address) => Promise<bigint>;
  private readonly vaultReady: (vault: Address) => Promise<boolean>;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    const rpcUrl = config.ROBINHOOD_MAINNET_RPC_URL;
    const chain = defineChain({
      id: 4663,
      name: "Robinhood Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: {
        default: { http: rpcUrl ? [rpcUrl] : [] },
      },
    });
    const client = rpcUrl
      ? createPublicClient({ chain, transport: http(rpcUrl) })
      : undefined;
    this.nativeBalance =
      dependencies.nativeBalance ??
      (async (owner) => {
        if (!client) throw new Error("Robinhood RPC is not configured");
        return client.getBalance({ address: owner });
      });
    this.usdGBalance =
      dependencies.usdGBalance ??
      (async (owner) => {
        if (!client) throw new Error("Robinhood RPC is not configured");
        return client.readContract({
          address: config.INPUT_TOKEN_ADDRESS as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner],
        });
      });
    this.vaultReady =
      dependencies.vaultReady ??
      (async (vault) => {
        if (!client) throw new Error("Robinhood RPC is not configured");
        const code = await client.getCode({ address: vault });
        return Boolean(code && code !== "0x");
      });
  }

  async read(
    owner: EvmAddress,
    amountIn: string,
  ): Promise<WalletReadiness> {
    if (
      this.config.ROBINHOOD_CHAIN_ID !== 4663 ||
      !this.config.EQLTY_VAULT_ADDRESS
    ) {
      throw new Error("Robinhood wallet execution is not configured");
    }
    const vault = this.config.EQLTY_VAULT_ADDRESS as EvmAddress;
    const [nativeBalance, usdGBalance, vaultReady] = await Promise.all([
      this.nativeBalance(owner),
      this.usdGBalance(owner),
      this.vaultReady(vault),
    ]);
    const checks = {
      gas: nativeBalance > 0n,
      funds: usdGBalance >= BigInt(amountIn),
      vault: vaultReady,
    };
    return {
      chainId: 4663,
      network: "Robinhood Chain",
      wallet: owner,
      vault,
      nativeBalance: nativeBalance.toString(),
      usdGBalance: usdGBalance.toString(),
      amountIn,
      ready: checks.gas && checks.funds && checks.vault,
      checks,
    };
  }
}
