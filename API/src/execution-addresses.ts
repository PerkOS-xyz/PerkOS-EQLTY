import { createHmac } from "node:crypto";
import type { Hex } from "viem";
import {
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import type { ApiConfig } from "./config.js";
import type { EvmAddress } from "./market-types.js";

const secp256k1Order = BigInt(
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
);

export function executionTraderAddress(
  config: ApiConfig,
  owner?: EvmAddress,
): EvmAddress | undefined {
  const account = executionTraderAccount(config, owner);
  if (account) return account.address;
  return config.ENS_TRADER_ADDRESS as EvmAddress | undefined;
}

export function executionTraderAccount(
  config: ApiConfig,
  owner?: EvmAddress,
): PrivateKeyAccount | undefined {
  if (config.EQLTY_SERVER_WALLET_MODE === "per-user" && owner) {
    const masterKey =
      config.EQLTY_SERVER_WALLET_MASTER_KEY ??
      config.EQLTY_TRADER_PRIVATE_KEY;
    if (masterKey) {
      return privateKeyToAccount(
        deriveServerWalletKey(config, masterKey as Hex, owner),
      );
    }
  }
  return sharedTraderAccount(config);
}

export function executionAccountForStrategy(
  config: ApiConfig,
  owner: EvmAddress,
  agent: EvmAddress,
): PrivateKeyAccount {
  const userAccount = executionTraderAccount(config, owner);
  if (sameAddress(userAccount?.address, agent)) return userAccount!;

  const sharedAccount = sharedTraderAccount(config);
  if (sameAddress(sharedAccount?.address, agent)) return sharedAccount!;

  throw new Error("The strategy agent does not match an EQLTY server wallet");
}

export function isExecutionTraderAddress(
  config: ApiConfig,
  owner: EvmAddress,
  agent: EvmAddress,
): boolean {
  return [
    executionTraderAddress(config, owner),
    sharedTraderAccount(config)?.address,
  ].some((candidate) => sameAddress(candidate, agent));
}

export function gasSponsorAccount(
  config: ApiConfig,
): PrivateKeyAccount | undefined {
  const privateKey =
    config.EQLTY_GAS_SPONSOR_PRIVATE_KEY ??
    config.EQLTY_TRADER_PRIVATE_KEY;
  return privateKey
    ? privateKeyToAccount(privateKey as Hex)
    : undefined;
}

function sharedTraderAccount(
  config: ApiConfig,
): PrivateKeyAccount | undefined {
  return config.EQLTY_TRADER_PRIVATE_KEY
    ? privateKeyToAccount(config.EQLTY_TRADER_PRIVATE_KEY as Hex)
    : undefined;
}

function deriveServerWalletKey(
  config: ApiConfig,
  masterKey: Hex,
  owner: EvmAddress,
): Hex {
  const context = [
    "eqlty-server-wallet-v1",
    config.ROBINHOOD_CHAIN_ID.toString(),
    config.EQLTY_VAULT_ADDRESS?.toLowerCase() ?? "unconfigured-vault",
    owner.toLowerCase(),
  ].join(":");
  for (let counter = 0; counter < 256; counter += 1) {
    const digest = createHmac(
      "sha256",
      Buffer.from(masterKey.slice(2), "hex"),
    )
      .update(`${context}:${counter}`)
      .digest("hex");
    const scalar = BigInt(`0x${digest}`);
    if (scalar > 0n && scalar < secp256k1Order) {
      return `0x${digest}`;
    }
  }
  throw new Error("Unable to derive the EQLTY server wallet");
}

function sameAddress(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}
