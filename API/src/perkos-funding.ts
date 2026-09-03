import { getAddress } from "viem";
import type { ApiConfig } from "./config.js";
import type { EvmAddress } from "./market-types.js";

const fundingPath = "/billing/deposit/x402";
export const defaultFleetFundingUsdG = 0.5;

export type FleetFundingRequirements = {
  scheme: "exact";
  network: "robinhood";
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: "application/json";
  payTo: EvmAddress;
  maxTimeoutSeconds: number;
  asset: EvmAddress;
  extra: {
    name: string;
    version: string;
  };
};

export type FleetFundingQuote = {
  amount: string;
  symbol: "USDG";
  network: "eip155:4663";
  requirements: FleetFundingRequirements;
};

export type FleetFundingPayment = {
  x402Version: 1;
  scheme: "exact";
  network: "robinhood";
  payload: {
    signature: `0x${string}`;
    authorization: {
      from: EvmAddress;
      to: EvmAddress;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: `0x${string}`;
    };
  };
};

export type FleetFundingReceipt = {
  wallet: EvmAddress;
  creditsUsd: number;
  deposited: number;
  network: "robinhood";
  transaction: `0x${string}`;
};

type Dependencies = {
  fetchFn?: typeof fetch;
};

export class PerkosFundingService {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.fetchFn = dependencies.fetchFn ?? fetch;
  }

  async quote(
    requestedAmount = defaultFleetFundingUsdG,
  ): Promise<FleetFundingQuote> {
    const amount = normalizeAmount(requestedAmount);
    const response = await this.deposit(amount);
    const body: unknown = await response.json().catch(() => undefined);
    if (response.status !== 402) {
      throw new Error("PerkOS did not return fleet funding terms");
    }
    const requirements = parseRequirements(body);
    return {
      amount: String(amount),
      symbol: "USDG",
      network: "eip155:4663",
      requirements,
    };
  }

  async settle(
    owner: EvmAddress,
    payment: FleetFundingPayment,
  ): Promise<FleetFundingReceipt> {
    const amount = Number(payment.payload.authorization.value) / 1_000_000;
    const quote = await this.quote(amount);
    validatePayment(owner, payment, quote.requirements);
    const encoded = Buffer.from(JSON.stringify(payment)).toString("base64");
    const response = await this.deposit(amount, encoded);
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new Error(perkosMessage(body, response.status));
    }
    const receipt = parseReceipt(body);
    if (getAddress(receipt.wallet) !== getAddress(owner)) {
      throw new Error("PerkOS credited a different wallet");
    }
    return receipt;
  }

  private deposit(amount: number, payment?: string): Promise<Response> {
    return this.fetchFn(
      new URL(fundingPath, `${this.config.PERKOS_API_URL.replace(/\/$/, "")}/`),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(payment ? { "payment-signature": payment } : {}),
        },
        body: JSON.stringify({ network: "robinhood", amount }),
        signal: AbortSignal.timeout(60_000),
      },
    );
  }
}

function normalizeAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000) {
    throw new Error("Fleet funding amount is outside the supported range");
  }
  return Number(value.toFixed(6));
}

function parseRequirements(body: unknown): FleetFundingRequirements {
  if (!isRecord(body) || !Array.isArray(body.accepts)) {
    throw new Error("PerkOS returned invalid fleet funding terms");
  }
  const value = body.accepts.find(
    (candidate) => isRecord(candidate) && candidate.network === "robinhood",
  );
  if (
    !isRecord(value) ||
    value.scheme !== "exact" ||
    typeof value.maxAmountRequired !== "string" ||
    typeof value.resource !== "string" ||
    typeof value.description !== "string" ||
    value.mimeType !== "application/json" ||
    typeof value.payTo !== "string" ||
    typeof value.asset !== "string" ||
    typeof value.maxTimeoutSeconds !== "number" ||
    !isRecord(value.extra) ||
    typeof value.extra.name !== "string" ||
    typeof value.extra.version !== "string"
  ) {
    throw new Error("PerkOS returned incomplete fleet funding terms");
  }
  return {
    scheme: "exact",
    network: "robinhood",
    maxAmountRequired: value.maxAmountRequired,
    resource: value.resource,
    description: value.description,
    mimeType: "application/json",
    payTo: getAddress(value.payTo),
    maxTimeoutSeconds: value.maxTimeoutSeconds,
    asset: getAddress(value.asset),
    extra: { name: value.extra.name, version: value.extra.version },
  };
}

function validatePayment(
  owner: EvmAddress,
  payment: FleetFundingPayment,
  requirements: FleetFundingRequirements,
): void {
  const authorization = payment.payload.authorization;
  if (
    payment.x402Version !== 1 ||
    payment.scheme !== "exact" ||
    payment.network !== requirements.network ||
    getAddress(authorization.from) !== getAddress(owner) ||
    getAddress(authorization.to) !== getAddress(requirements.payTo) ||
    authorization.value !== requirements.maxAmountRequired
  ) {
    throw new Error("Fleet funding authorization does not match the quote");
  }
  const now = BigInt(Math.floor(Date.now() / 1_000));
  const validAfter = BigInt(authorization.validAfter);
  const validBefore = BigInt(authorization.validBefore);
  if (
    validAfter > now ||
    validBefore <= now ||
    validBefore > now + BigInt(requirements.maxTimeoutSeconds)
  ) {
    throw new Error("Fleet funding authorization has expired");
  }
}

function parseReceipt(body: unknown): FleetFundingReceipt {
  if (
    !isRecord(body) ||
    body.ok !== true ||
    typeof body.wallet !== "string" ||
    typeof body.creditsUsd !== "number" ||
    typeof body.deposited !== "number" ||
    body.network !== "robinhood" ||
    typeof body.transaction !== "string"
  ) {
    throw new Error("PerkOS returned an invalid funding receipt");
  }
  return {
    wallet: getAddress(body.wallet),
    creditsUsd: body.creditsUsd,
    deposited: body.deposited,
    network: "robinhood",
    transaction: body.transaction as `0x${string}`,
  };
}

function perkosMessage(body: unknown, status: number): string {
  if (isRecord(body)) {
    if (typeof body.message === "string") return body.message;
    if (typeof body.error === "string") return body.error;
    if (isRecord(body.error) && typeof body.error.message === "string") {
      return body.error.message;
    }
  }
  return `PerkOS funding failed with status ${status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
