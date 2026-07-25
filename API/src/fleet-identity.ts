import { keccak256, stringToHex } from "viem";
import type { EvmAddress } from "./market-types.js";

export function fleetUserIdForWallet(address: EvmAddress): string {
  const normalized = address.toLowerCase();
  const digest = keccak256(
    stringToHex(`eqlty:fleet-owner:v1:${normalized}`),
  );
  return `u-${digest.slice(2, 22)}`;
}
