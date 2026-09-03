import { getAddress, toHex } from "viem";
import type { WalletAccess } from "../app/wallet-access-context";
import type {
  FleetFundingPayment,
  FleetFundingQuote,
} from "./fleet-types";

const robinhoodChainId = 4663;

export async function authorizeFleetFunding(input: {
  wallet: WalletAccess;
  quote: FleetFundingQuote;
}): Promise<FleetFundingPayment> {
  if (!input.wallet.address) {
    throw new Error("Connect the wallet that owns this fleet");
  }
  const { walletClient } =
    await input.wallet.getEvmClients(robinhoodChainId);
  if (
    !walletClient.account ||
    getAddress(walletClient.account.address) !==
      getAddress(input.wallet.address)
  ) {
    throw new Error("The active signer does not match this fleet");
  }

  const terms = input.quote.requirements;
  const validAfter = "0";
  const validBefore = String(
    Math.floor(Date.now() / 1_000) + terms.maxTimeoutSeconds,
  );
  const authorization = {
    from: getAddress(input.wallet.address),
    to: getAddress(terms.payTo),
    value: terms.maxAmountRequired,
    validAfter,
    validBefore,
    nonce: randomNonce(),
  };
  const signature = await walletClient.signTypedData({
    account: walletClient.account,
    domain: {
      name: terms.extra.name,
      version: terms.extra.version,
      chainId: robinhoodChainId,
      verifyingContract: getAddress(terms.asset),
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      ...authorization,
      value: BigInt(authorization.value),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
    },
  });

  return {
    x402Version: 1,
    scheme: "exact",
    network: "robinhood",
    payload: { signature, authorization },
  };
}

function randomNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}
