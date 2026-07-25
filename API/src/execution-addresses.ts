import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ApiConfig } from "./config.js";
import type { EvmAddress } from "./market-types.js";

export function executionTraderAddress(
  config: ApiConfig,
): EvmAddress | undefined {
  if (config.EQLTY_TRADER_PRIVATE_KEY) {
    return privateKeyToAccount(
      config.EQLTY_TRADER_PRIVATE_KEY as Hex,
    ).address;
  }
  return config.ENS_TRADER_ADDRESS as EvmAddress | undefined;
}
