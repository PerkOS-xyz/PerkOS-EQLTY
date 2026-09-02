import type { EvmAddress } from "./market-types.js";

export type DecisionFeeStatus =
  | "preview"
  | "payment-required"
  | "settled"
  | "waived"
  | "failed";

export type DecisionFeeRequirements = {
  scheme: "exact";
  network: "eip155:4663";
  amount: string;
  asset: EvmAddress;
  payTo: EvmAddress;
  maxTimeoutSeconds: number;
  extra: {
    name: "Global Dollar";
    version: "1";
  };
};

export type DecisionFeeAuthorization = {
  from: EvmAddress;
  to: EvmAddress;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
};

export type DecisionFeePaymentPayload = {
  x402Version: 2;
  resource: {
    url: string;
    description: string;
    mimeType: "application/json";
  };
  accepted: DecisionFeeRequirements;
  payload: {
    signature: `0x${string}`;
    authorization: DecisionFeeAuthorization;
  };
  extensions: Record<string, unknown>;
};

export type DecisionFeeReceipt = {
  payer: EvmAddress;
  amount: string;
  asset: EvmAddress;
  network: "eip155:4663";
  decisionReceiptRoot?: `0x${string}`;
  authorizationNonce: `0x${string}`;
  transaction?: `0x${string}`;
  explorerUrl?: string;
  requestId?: string;
  settledAt: string;
};

export type DecisionFee = {
  mode: "preview" | "live";
  status: DecisionFeeStatus;
  scheme: "exact";
  amount: string;
  maximumAmount: string;
  decimals: 6;
  symbol: "USDG";
  reason: string;
  decisionReceiptRoot?: `0x${string}`;
  requirements?: DecisionFeeRequirements;
  receipt?: DecisionFeeReceipt;
  error?: string;
};
