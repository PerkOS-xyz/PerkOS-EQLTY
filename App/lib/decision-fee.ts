import { getAddress, toHex } from "viem";
import type { WalletAccess } from "../app/wallet-access-context";
import type {
  DecisionFeePaymentPayload,
  DecisionFeeRequirements,
} from "./goal-types";

const robinhoodChainId = 4663;

export async function authorizeDecisionFee(input: {
  wallet: WalletAccess;
  goalId: string;
  requirements: DecisionFeeRequirements;
  resourceUrl: string;
}): Promise<DecisionFeePaymentPayload> {
  if (!input.wallet.address) {
    throw new Error("Connect the wallet that owns this decision");
  }
  const { walletClient } =
    await input.wallet.getEvmClients(robinhoodChainId);
  if (
    !walletClient.account ||
    getAddress(walletClient.account.address) !==
      getAddress(input.wallet.address)
  ) {
    throw new Error("The active signer does not match this decision");
  }
  const validAfter = "0";
  const validBefore = String(
    Math.floor(Date.now() / 1_000) +
      input.requirements.maxTimeoutSeconds,
  );
  const nonce = randomNonce();
  const authorization = {
    from: getAddress(input.wallet.address),
    to: getAddress(input.requirements.payTo),
    value: input.requirements.amount,
    validAfter,
    validBefore,
    nonce,
  };
  const signature = await walletClient.signTypedData({
    account: walletClient.account,
    domain: {
      name: input.requirements.extra.name,
      version: input.requirements.extra.version,
      chainId: robinhoodChainId,
      verifyingContract: getAddress(input.requirements.asset),
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
    x402Version: 2,
    resource: {
      url: input.resourceUrl,
      description: "EQLTY verified agent decision",
      mimeType: "application/json",
    },
    accepted: input.requirements,
    payload: {
      signature,
      authorization,
    },
    extensions: {},
  };
}

function randomNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}
