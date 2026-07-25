import type { TypedDataDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ApiConfig } from "./config.js";
import type {
  EvmAddress,
  PreparedUniswapSwap,
  UniswapQuote,
} from "./market-types.js";

const maxAttempts = 3;
type JsonRecord = Record<string, unknown>;

export class UniswapClient {
  constructor(
    private readonly config: ApiConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  ready(): boolean {
    return Boolean(
      this.config.UNISWAP_API_KEY &&
        this.config.SWAPPER_ADDRESS,
    );
  }

  async quote(
    tokenOut: EvmAddress,
    amount: string,
  ): Promise<UniswapQuote> {
    if (!this.config.UNISWAP_API_KEY || !this.config.SWAPPER_ADDRESS) {
      throw new Error("Uniswap quoting is not configured");
    }

    const { body, requestId } = await this.requestQuote({
      tokenOut,
      amount,
      swapper: this.config.SWAPPER_ADDRESS as EvmAddress,
      slippageTolerance: 1,
    });
    return parseQuote(body, requestId);
  }

  executionReady(): boolean {
    return Boolean(
      this.config.UNISWAP_API_KEY &&
        this.config.EQLTY_VAULT_ADDRESS &&
        this.config.EQLTY_RISK_SIGNER_PRIVATE_KEY,
    );
  }

  async prepareSwap(input: {
    tokenOut: EvmAddress;
    amount: string;
    maxSlippageBps: number;
  }): Promise<PreparedUniswapSwap> {
    const vault = this.config.EQLTY_VAULT_ADDRESS as
      | EvmAddress
      | undefined;
    const riskKey = this.config.EQLTY_RISK_SIGNER_PRIVATE_KEY;
    if (!this.config.UNISWAP_API_KEY || !vault || !riskKey) {
      throw new Error("Uniswap execution is not configured");
    }
    if (
      this.config.UNISWAP_CHAIN_ID !== 4663 ||
      this.config.ROBINHOOD_CHAIN_ID !== 4663
    ) {
      throw new Error("Live swaps require Robinhood Chain mainnet");
    }

    const { body, requestId } = await this.requestQuote({
      tokenOut: input.tokenOut,
      amount: input.amount,
      swapper: vault,
      slippageTolerance: input.maxSlippageBps / 100,
    });
    const parsed = parseQuote(body, requestId);
    if (!parsed.requestId) {
      throw new Error("Uniswap quote returned no request identifier");
    }
    const quote = record(body.quote, "Uniswap quote");
    const permitData =
      body.permitData === null || body.permitData === undefined
        ? undefined
        : record(body.permitData, "Uniswap permit data");
    let signature: `0x${string}` | undefined;

    if (permitData) {
      validateExecutionQuote({
        quote,
        permitData,
        vault,
        tokenIn: this.config.INPUT_TOKEN_ADDRESS as EvmAddress,
        tokenOut: input.tokenOut,
        amount: input.amount,
        router: this.config.UNISWAP_UNIVERSAL_ROUTER_ADDRESS as EvmAddress,
        permit2: this.config.UNISWAP_PERMIT2_ADDRESS as EvmAddress,
      });
      signature = await signPermit(
        permitData,
        riskKey as `0x${string}`,
      );
    }

    const response = await this.fetchFn(
      `${this.config.UNISWAP_API_URL}/swap`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(
          permitData
            ? { quote, signature, permitData }
            : { quote },
        ),
        signal: AbortSignal.timeout(12_000),
      },
    );
    const swapBody: unknown = await response
      .json()
      .catch(() => undefined);
    if (!response.ok || !isRecord(swapBody)) {
      throw new Error(
        `Uniswap swap build failed with status ${response.status}`,
      );
    }
    const transaction = record(
      swapBody.swap ?? swapBody.transaction,
      "Uniswap swap transaction",
    );
    const prepared = parseTransaction(transaction);
    validateTransaction({
      transaction: prepared,
      vault,
      router: this.config.UNISWAP_UNIVERSAL_ROUTER_ADDRESS as EvmAddress,
    });

    return {
      amountOut: parsed.amountOut,
      requestId: parsed.requestId,
      routing: parsed.routing,
      rawQuote: quote,
      transaction: prepared,
    };
  }

  private async requestQuote(input: {
    tokenOut: EvmAddress;
    amount: string;
    swapper: EvmAddress;
    slippageTolerance: number;
  }): Promise<{
    body: JsonRecord;
    requestId: string | null;
  }> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await this.fetchFn(
        `${this.config.UNISWAP_API_URL}/quote`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({
            tokenIn: this.config.INPUT_TOKEN_ADDRESS,
            tokenOut: input.tokenOut,
            amount: input.amount,
            type: "EXACT_INPUT",
            swapper: input.swapper,
            tokenInChainId: 4663,
            tokenOutChainId: 4663,
            slippageTolerance: input.slippageTolerance,
            routingPreference: "BEST_PRICE",
            protocols: ["V4"],
            permitAmount: "EXACT",
          }),
          signal: AbortSignal.timeout(12_000),
        },
      );

      if (response.status === 429 && attempt < maxAttempts) {
        await response.body?.cancel();
        await wait(retryDelay(response, attempt));
        continue;
      }

      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok || !isRecord(body)) {
        throw new Error(`Uniswap quote failed with status ${response.status}`);
      }
      return {
        body,
        requestId: response.headers.get("x-request-id"),
      };
    }

    throw new Error("Uniswap quote retry limit reached");
  }

  private headers(): Record<string, string> {
    if (!this.config.UNISWAP_API_KEY) {
      throw new Error("Uniswap API key is missing");
    }
    return {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": this.config.UNISWAP_API_KEY,
      "x-universal-router-version": "2.1.1",
    };
  }
}

function parseQuote(
  body: unknown,
  headerRequestId: string | null,
): UniswapQuote {
  if (!isRecord(body)) {
    throw new Error("Uniswap quote response is invalid");
  }
  const quote = isRecord(body.quote) ? body.quote : {};
  const output = isRecord(quote.output) ? quote.output : {};
  const amountOut = String(output.amount ?? quote.amountOut ?? "");

  if (!/^[1-9]\d*$/.test(amountOut)) {
    throw new Error("Uniswap quote returned no output amount");
  }

  const requestId =
    headerRequestId ||
    (typeof body.requestId === "string" ? body.requestId : undefined);
  const routing =
    typeof body.routing === "string"
      ? body.routing
      : typeof quote.routing === "string"
        ? quote.routing
        : "V4";

  return {
    amountOut,
    requestId,
    routing,
  };
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter * 1_000, 3_000)
    : attempt * 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

async function signPermit(
  permitData: JsonRecord,
  privateKey: `0x${string}`,
): Promise<`0x${string}`> {
  const domain = record(permitData.domain, "Permit2 domain");
  const types = record(permitData.types, "Permit2 types") as Record<
    string,
    readonly { name: string; type: string }[]
  >;
  const message = record(permitData.values, "Permit2 values");
  const primaryType = Object.keys(types).find(
    (name) => name !== "EIP712Domain",
  );
  if (!primaryType) {
    throw new Error("Permit2 primary type is missing");
  }
  return privateKeyToAccount(privateKey).signTypedData({
    domain: domain as TypedDataDomain,
    types,
    primaryType,
    message,
  });
}

function validateExecutionQuote(input: {
  quote: JsonRecord;
  permitData: JsonRecord;
  vault: EvmAddress;
  tokenIn: EvmAddress;
  tokenOut: EvmAddress;
  amount: string;
  router: EvmAddress;
  permit2: EvmAddress;
}): void {
  const quoteInput = record(input.quote.input, "Uniswap quote input");
  const output = record(input.quote.output, "Uniswap quote output");
  const domain = record(input.permitData.domain, "Permit2 domain");
  const values = record(input.permitData.values, "Permit2 values");
  const details = record(values.details, "Permit2 details");

  if (!same(input.quote.swapper, input.vault)) {
    throw new Error("Uniswap quote swapper is not the EQLTY vault");
  }
  if (
    !same(quoteInput.token, input.tokenIn) ||
    String(quoteInput.amount) !== input.amount
  ) {
    throw new Error("Uniswap quote input does not match the strategy");
  }
  if (
    !same(output.token, input.tokenOut) ||
    !same(output.recipient, input.vault)
  ) {
    throw new Error("Uniswap quote output does not return to the vault");
  }
  if (
    Number(input.quote.tokenInChainId ?? input.quote.chainId) !== 4663 ||
    Number(input.quote.tokenOutChainId ?? input.quote.chainId) !== 4663
  ) {
    throw new Error("Uniswap quote is not on Robinhood Chain");
  }
  if (
    Number(domain.chainId) !== 4663 ||
    !same(domain.verifyingContract, input.permit2)
  ) {
    throw new Error("Permit2 domain is not canonical");
  }
  if (
    !same(details.token, input.tokenIn) ||
    String(details.amount) !== input.amount
  ) {
    throw new Error("Permit2 amount is not exact");
  }
  if (!same(values.spender, input.router)) {
    throw new Error("Permit2 spender is not the authorized router");
  }
}

function parseTransaction(
  transaction: JsonRecord,
): PreparedUniswapSwap["transaction"] {
  const data = String(transaction.data ?? "");
  if (!/^0x[0-9a-fA-F]+$/.test(data) || data === "0x") {
    throw new Error("Uniswap transaction has no calldata");
  }
  const to = String(transaction.to ?? "");
  const from = String(transaction.from ?? "");
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(to) ||
    !/^0x[0-9a-fA-F]{40}$/.test(from)
  ) {
    throw new Error("Uniswap transaction addresses are invalid");
  }
  return {
    to: to as EvmAddress,
    from: from as EvmAddress,
    data: data as `0x${string}`,
    value: String(transaction.value ?? "0"),
    chainId: Number(transaction.chainId),
  };
}

function validateTransaction(input: {
  transaction: PreparedUniswapSwap["transaction"];
  vault: EvmAddress;
  router: EvmAddress;
}): void {
  if (!same(input.transaction.to, input.router)) {
    throw new Error("Uniswap transaction targets an unauthorized router");
  }
  if (!same(input.transaction.from, input.vault)) {
    throw new Error("Uniswap transaction sender is not the EQLTY vault");
  }
  if (input.transaction.chainId !== 4663) {
    throw new Error("Uniswap transaction is not on Robinhood Chain");
  }
  if (BigInt(input.transaction.value) !== 0n) {
    throw new Error("USDG execution cannot include native value");
  }
}

function same(left: unknown, right: string): boolean {
  return String(left ?? "").toLowerCase() === right.toLowerCase();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
