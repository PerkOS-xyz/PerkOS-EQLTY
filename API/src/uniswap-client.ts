import {
  decodeFunctionData,
  type TypedDataDomain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ApiConfig } from "./config.js";
import type {
  EvmAddress,
  PreparedUniswapSwap,
  UniswapTransaction,
  UniswapQuote,
  WalletBuySwap,
  WalletSwapQuote,
} from "./market-types.js";
import {
  agentInfoHeader,
  defaultDecisionOrigin,
  integrationName,
  type DecisionOrigin,
  type UniswapAttribution,
} from "./uniswap-attribution.js";

const maxAttempts = 3;
/** The protocols every quote request asks the Trading API for. */
export const quoteProtocols = ["V4"] as const;
/** Hooked pools route through contracts outside the vault route and the evidence set. */
export const quoteHooks = "V4_NO_HOOKS";
type JsonRecord = Record<string, unknown>;
const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * A quote for a wallet carried permitData, so the wallet has no Permit2
 * allowance for the router yet. EQLTY does not sign that permit for a wallet
 * it does not hold: the wallet sets the allowance on chain and asks again.
 */
export class Permit2AllowanceRequiredError extends Error {
  constructor(
    readonly token: EvmAddress,
    readonly spender: EvmAddress,
    readonly amount: string,
    readonly permit2: EvmAddress,
  ) {
    super("The wallet has no Permit2 allowance for the Universal Router");
    this.name = "Permit2AllowanceRequiredError";
  }
}

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
    decisionOrigin: DecisionOrigin = defaultDecisionOrigin,
  ): Promise<UniswapQuote> {
    if (!this.config.UNISWAP_API_KEY || !this.config.SWAPPER_ADDRESS) {
      throw new Error("Uniswap quoting is not configured");
    }

    const { body, requestId, agentInfoStatus } = await this.requestQuote({
      tokenIn: this.config.INPUT_TOKEN_ADDRESS as EvmAddress,
      tokenOut,
      amount,
      swapper: this.config.SWAPPER_ADDRESS as EvmAddress,
      slippageTolerance: 1,
      decisionOrigin,
    });
    return {
      ...parseQuote(body, requestId),
      ...quoteDetails(body),
      attribution: attribution(decisionOrigin, agentInfoStatus),
    };
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
    decisionOrigin?: DecisionOrigin;
  }): Promise<PreparedUniswapSwap> {
    const decisionOrigin = input.decisionOrigin ?? defaultDecisionOrigin;
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

    const { body, requestId, agentInfoStatus } = await this.requestQuote({
      tokenIn: this.config.INPUT_TOKEN_ADDRESS as EvmAddress,
      tokenOut: input.tokenOut,
      amount: input.amount,
      swapper: vault,
      slippageTolerance: input.maxSlippageBps / 100,
      decisionOrigin,
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
        headers: this.headers(decisionOrigin),
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
      attribution: attribution(
        decisionOrigin,
        agentInfoStatus,
        response.headers.get("x-agent-info-status"),
      ),
    };
  }

  /**
   * The sale quote goes back to the browser and returns through a strict
   * schema, so the X-Agent-Info status is kept on the built swap instead.
   */
  async prepareWalletSell(input: {
    ticker: string;
    tokenIn: EvmAddress;
    amount: string;
    swapper: EvmAddress;
    maxSlippageBps: number;
    decisionOrigin?: DecisionOrigin;
  }): Promise<WalletSwapQuote> {
    const decisionOrigin = input.decisionOrigin ?? defaultDecisionOrigin;
    const tokenOut = this.config.INPUT_TOKEN_ADDRESS as EvmAddress;
    if (!this.config.UNISWAP_API_KEY) {
      throw new Error("Uniswap wallet swaps are not configured");
    }
    assertRobinhoodChain(this.config);

    const approvalResponse = await this.fetchFn(
      `${this.config.UNISWAP_API_URL}/check_approval`,
      {
        method: "POST",
        headers: this.headers(decisionOrigin),
        body: JSON.stringify({
          walletAddress: input.swapper,
          token: input.tokenIn,
          tokenOut,
          amount: input.amount,
          chainId: 4663,
          tokenOutChainId: 4663,
        }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    const approvalBody: unknown = await approvalResponse
      .json()
      .catch(() => undefined);
    if (!approvalResponse.ok || !isRecord(approvalBody)) {
      throw new Error(
        `Uniswap approval check failed with status ${approvalResponse.status}`,
      );
    }
    const approval = approvalBody.approval
      ? parseTransaction(record(approvalBody.approval, "Uniswap approval"))
      : undefined;
    if (approval) {
      validateApprovalTransaction({
        transaction: approval,
        swapper: input.swapper,
        token: input.tokenIn,
        permit2: this.config.UNISWAP_PERMIT2_ADDRESS as EvmAddress,
        amount: input.amount,
      });
    }

    const { body, requestId } = await this.requestQuote({
      tokenIn: input.tokenIn,
      tokenOut,
      amount: input.amount,
      swapper: input.swapper,
      slippageTolerance: input.maxSlippageBps / 100,
      decisionOrigin,
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
    validateWalletQuote({
      quote,
      permitData,
      swapper: input.swapper,
      tokenIn: input.tokenIn,
      tokenOut,
      amount: input.amount,
      router: this.config.UNISWAP_UNIVERSAL_ROUTER_ADDRESS as EvmAddress,
      permit2: this.config.UNISWAP_PERMIT2_ADDRESS as EvmAddress,
    });

    return {
      chainId: 4663,
      direction: "sell",
      ticker: input.ticker.toUpperCase(),
      tokenIn: input.tokenIn,
      tokenOut,
      amountIn: input.amount,
      amountOut: parsed.amountOut,
      requestId: parsed.requestId,
      routing: parsed.routing,
      quotedAt: new Date().toISOString(),
      approval,
      permitData,
      rawQuote: quote,
    };
  }

  async buildWalletSell(input: {
    sell: WalletSwapQuote;
    swapper: EvmAddress;
    signature?: `0x${string}`;
    decisionOrigin?: DecisionOrigin;
  }): Promise<PreparedUniswapSwap> {
    const decisionOrigin = input.decisionOrigin ?? defaultDecisionOrigin;
    if (!this.config.UNISWAP_API_KEY) {
      throw new Error("Uniswap wallet swaps are not configured");
    }
    assertRobinhoodChain(this.config);
    validateWalletQuote({
      quote: input.sell.rawQuote,
      permitData: input.sell.permitData,
      swapper: input.swapper,
      tokenIn: input.sell.tokenIn,
      tokenOut: this.config.INPUT_TOKEN_ADDRESS as EvmAddress,
      amount: input.sell.amountIn,
      router: this.config.UNISWAP_UNIVERSAL_ROUTER_ADDRESS as EvmAddress,
      permit2: this.config.UNISWAP_PERMIT2_ADDRESS as EvmAddress,
    });
    if (input.sell.permitData && !input.signature) {
      throw new Error("The Permit2 signature is required");
    }

    const response = await this.fetchFn(
      `${this.config.UNISWAP_API_URL}/swap`,
      {
        method: "POST",
        headers: this.headers(decisionOrigin),
        body: JSON.stringify(
          input.sell.permitData
            ? {
                quote: input.sell.rawQuote,
                permitData: input.sell.permitData,
                signature: input.signature,
                simulateTransaction: true,
              }
            : {
                quote: input.sell.rawQuote,
                simulateTransaction: true,
              },
        ),
        signal: AbortSignal.timeout(12_000),
      },
    );
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !isRecord(body)) {
      throw new Error(
        `Uniswap wallet swap build failed with status ${response.status}`,
      );
    }
    const transaction = parseTransaction(
      record(body.swap ?? body.transaction, "Uniswap swap transaction"),
    );
    validateWalletTransaction({
      transaction,
      swapper: input.swapper,
      allowedTargets: [
        this.config.UNISWAP_UNIVERSAL_ROUTER_ADDRESS as EvmAddress,
      ],
    });
    return {
      amountOut: input.sell.amountOut,
      requestId: input.sell.requestId,
      routing: input.sell.routing,
      rawQuote: input.sell.rawQuote,
      transaction,
      attribution: attribution(
        decisionOrigin,
        response.headers.get("x-agent-info-status"),
      ),
    };
  }

  walletSwapReady(): boolean {
    return Boolean(this.config.UNISWAP_API_KEY);
  }

  /**
   * Quotes and builds a USDG to stock token swap for a wallet that pays with
   * its own USDG and sends the transaction itself. It signs nothing. When the
   * quote carries permitData it throws Permit2AllowanceRequiredError instead
   * of building, and the returned transaction must target the configured
   * Universal Router.
   */
  async prepareWalletBuy(input: {
    tokenOut: EvmAddress;
    amount: string;
    swapper: EvmAddress;
    maxSlippageBps: number;
    decisionOrigin?: DecisionOrigin;
  }): Promise<WalletBuySwap> {
    const decisionOrigin = input.decisionOrigin ?? defaultDecisionOrigin;
    const tokenIn = this.config.INPUT_TOKEN_ADDRESS as EvmAddress;
    const router = this.config.UNISWAP_UNIVERSAL_ROUTER_ADDRESS as EvmAddress;
    if (!this.config.UNISWAP_API_KEY) {
      throw new Error("Uniswap wallet swaps are not configured");
    }
    assertRobinhoodChain(this.config);

    const { body, requestId, agentInfoStatus } = await this.requestQuote({
      tokenIn,
      tokenOut: input.tokenOut,
      amount: input.amount,
      swapper: input.swapper,
      slippageTolerance: input.maxSlippageBps / 100,
      decisionOrigin,
    });
    const parsed = parseQuote(body, requestId);
    if (!parsed.requestId) {
      throw new Error("Uniswap quote returned no request identifier");
    }
    // /swap builds calldata for a CLASSIC quote; UniswapX routings are signed
    // orders that go to /order instead.
    const routing = body.routing;
    if (routing !== "CLASSIC") {
      throw new Error("Uniswap quote routing is not CLASSIC");
    }
    const quote = record(body.quote, "Uniswap quote");
    validateWalletBuyQuote({
      quote,
      swapper: input.swapper,
      tokenIn,
      tokenOut: input.tokenOut,
      amount: input.amount,
    });
    if (body.permitData !== null && body.permitData !== undefined) {
      throw permitAllowanceRequired({
        permitData: record(body.permitData, "Uniswap permit data"),
        tokenIn,
        amount: input.amount,
        router,
        permit2: this.config.UNISWAP_PERMIT2_ADDRESS as EvmAddress,
      });
    }
    const output = swapperOutput({
      quote,
      swapper: input.swapper,
      tokenOut: input.tokenOut,
      maxSlippageBps: input.maxSlippageBps,
    });

    const response = await this.fetchFn(
      `${this.config.UNISWAP_API_URL}/swap`,
      {
        method: "POST",
        headers: this.headers(decisionOrigin),
        body: JSON.stringify({ quote, simulateTransaction: true }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    const swapBody: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !isRecord(swapBody)) {
      throw new Error(
        `Uniswap swap build failed with status ${response.status}`,
      );
    }
    const transaction = parseTransaction(
      record(swapBody.swap, "Uniswap swap transaction"),
    );
    validateWalletBuyTransaction({
      transaction,
      swapper: input.swapper,
      router,
    });
    return {
      amountOut: output.amount,
      minAmountOut: output.minAmount,
      requestId: parsed.requestId,
      routing,
      transaction,
      attribution: attribution(
        decisionOrigin,
        agentInfoStatus,
        response.headers.get("x-agent-info-status"),
      ),
    };
  }

  private async requestQuote(input: {
    tokenIn: EvmAddress;
    tokenOut: EvmAddress;
    amount: string;
    swapper: EvmAddress;
    slippageTolerance: number;
    decisionOrigin: DecisionOrigin;
  }): Promise<{
    body: JsonRecord;
    requestId: string | null;
    agentInfoStatus: string | null;
  }> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await this.fetchFn(
        `${this.config.UNISWAP_API_URL}/quote`,
        {
          method: "POST",
          headers: this.headers(input.decisionOrigin),
          body: JSON.stringify({
            tokenIn: input.tokenIn,
            tokenOut: input.tokenOut,
            amount: input.amount,
            type: "EXACT_INPUT",
            swapper: input.swapper,
            tokenInChainId: 4663,
            tokenOutChainId: 4663,
            slippageTolerance: input.slippageTolerance,
            routingPreference: "BEST_PRICE",
            protocols: quoteProtocols,
            hooksOptions: quoteHooks,
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
        agentInfoStatus: response.headers.get("x-agent-info-status"),
      };
    }

    throw new Error("Uniswap quote retry limit reached");
  }

  private headers(decisionOrigin: DecisionOrigin): Record<string, string> {
    if (!this.config.UNISWAP_API_KEY) {
      throw new Error("Uniswap API key is missing");
    }
    return {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": this.config.UNISWAP_API_KEY,
      "x-universal-router-version": "2.1.1",
      "x-agent-info": agentInfoHeader({ decisionOrigin, integrationName }),
    };
  }
}

function assertRobinhoodChain(config: ApiConfig): void {
  if (
    config.UNISWAP_CHAIN_ID !== 4663 ||
    config.ROBINHOOD_CHAIN_ID !== 4663
  ) {
    throw new Error("Live swaps require Robinhood Chain mainnet");
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

/** Price impact, route, gas cost and routing as the Trading API reports them. */
function quoteDetails(
  body: JsonRecord,
): Pick<
  UniswapQuote,
  "priceImpactPct" | "route" | "gasFeeUsd" | "reportedRouting"
> {
  const quote = isRecord(body.quote) ? body.quote : {};
  return {
    priceImpactPct:
      typeof quote.priceImpact === "number" &&
      Number.isFinite(quote.priceImpact)
        ? quote.priceImpact
        : undefined,
    route: Array.isArray(quote.route) ? quote.route : undefined,
    gasFeeUsd:
      typeof quote.gasFeeUSD === "string" ? quote.gasFeeUSD : undefined,
    reportedRouting:
      typeof body.routing === "string"
        ? body.routing
        : typeof quote.routing === "string"
          ? quote.routing
          : undefined,
  };
}

/**
 * The origin an operation sent, with the first x-agent-info-status any of its
 * Trading API responses carried. Every call of one operation sends the same
 * header, so one status speaks for all of them.
 */
function attribution(
  decisionOrigin: DecisionOrigin,
  ...statuses: Array<string | null>
): UniswapAttribution {
  return {
    decisionOrigin,
    status: statuses.find((status) => status !== null) ?? null,
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
  const primaryType = [
    "PermitSingle",
    "PermitBatch",
    "PermitTransferFrom",
    "PermitBatchTransferFrom",
  ].find((name) => types[name]);
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

function validateWalletQuote(input: {
  quote: JsonRecord;
  permitData?: JsonRecord;
  swapper: EvmAddress;
  tokenIn: EvmAddress;
  tokenOut: EvmAddress;
  amount: string;
  router: EvmAddress;
  permit2: EvmAddress;
}): void {
  const quoteInput = record(input.quote.input, "Uniswap quote input");
  const output = record(input.quote.output, "Uniswap quote output");
  if (!same(input.quote.swapper, input.swapper)) {
    throw new Error("Uniswap quote swapper is not the connected wallet");
  }
  if (
    !same(quoteInput.token, input.tokenIn) ||
    String(quoteInput.amount) !== input.amount
  ) {
    throw new Error("Uniswap quote input does not match the sale");
  }
  if (
    !same(output.token, input.tokenOut) ||
    !same(output.recipient, input.swapper)
  ) {
    throw new Error("Uniswap quote output does not return to the wallet");
  }
  if (
    Number(input.quote.tokenInChainId ?? input.quote.chainId) !== 4663 ||
    Number(input.quote.tokenOutChainId ?? input.quote.chainId) !== 4663
  ) {
    throw new Error("Uniswap quote is not on Robinhood Chain");
  }
  if (!input.permitData) return;
  const domain = record(input.permitData.domain, "Permit2 domain");
  const values = record(input.permitData.values, "Permit2 values");
  const details = record(values.details, "Permit2 details");
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

function validateWalletBuyQuote(input: {
  quote: JsonRecord;
  swapper: EvmAddress;
  tokenIn: EvmAddress;
  tokenOut: EvmAddress;
  amount: string;
}): void {
  const quoteInput = record(input.quote.input, "Uniswap quote input");
  const output = record(input.quote.output, "Uniswap quote output");
  if (!same(input.quote.swapper, input.swapper)) {
    throw new Error("Uniswap quote swapper is not the requested wallet");
  }
  if (
    !same(quoteInput.token, input.tokenIn) ||
    String(quoteInput.amount) !== input.amount
  ) {
    throw new Error("Uniswap quote input does not match the order");
  }
  if (
    !same(output.token, input.tokenOut) ||
    !same(output.recipient, input.swapper)
  ) {
    throw new Error("Uniswap quote output does not return to the wallet");
  }
  if (
    Number(input.quote.tokenInChainId ?? input.quote.chainId) !== 4663 ||
    Number(input.quote.tokenOutChainId ?? input.quote.chainId) !== 4663
  ) {
    throw new Error("Uniswap quote is not on Robinhood Chain");
  }
}

/**
 * The allowance a wallet must set before its swap can be built, once the
 * permit the quote asked for is checked: canonical Permit2 on chain 4663, the
 * exact USDG amount, and the configured router as spender.
 */
function permitAllowanceRequired(input: {
  permitData: JsonRecord;
  tokenIn: EvmAddress;
  amount: string;
  router: EvmAddress;
  permit2: EvmAddress;
}): Permit2AllowanceRequiredError {
  const domain = record(input.permitData.domain, "Permit2 domain");
  const values = record(input.permitData.values, "Permit2 values");
  const details = record(values.details, "Permit2 details");
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
  return new Permit2AllowanceRequiredError(
    input.tokenIn,
    input.router,
    input.amount,
    input.permit2,
  );
}

/**
 * The wallet's own entry in aggregatedOutputs, the one with no fee tag. This
 * is how the Uniswap interface reads what a recipient will receive
 * (getQuoteOutputAmountUserWillReceive): amount is the quoted output and
 * minAmount the least the wallet receives.
 */
function swapperOutput(input: {
  quote: JsonRecord;
  swapper: EvmAddress;
  tokenOut: EvmAddress;
  maxSlippageBps: number;
}): { amount: string; minAmount: string } {
  const outputs = (
    Array.isArray(input.quote.aggregatedOutputs)
      ? input.quote.aggregatedOutputs
      : []
  )
    .filter(isRecord)
    .filter(
      (output) =>
        output.fee === undefined && same(output.recipient, input.swapper),
    );
  const output = outputs.length === 1 ? outputs[0] : undefined;
  if (!output || !same(output.token, input.tokenOut)) {
    throw new Error("Uniswap quote has no single output for the wallet");
  }
  const amount = String(output.amount ?? "");
  const minAmount = String(output.minAmount ?? "");
  if (!/^[1-9]\d*$/.test(amount) || !/^[1-9]\d*$/.test(minAmount)) {
    throw new Error("Uniswap quote returned no minimum output for the wallet");
  }
  // A minimum under the quoted output less the requested slippage would let
  // the swap settle for less than the caller asked to accept.
  const floor =
    (BigInt(amount) * BigInt(10_000 - input.maxSlippageBps)) / 10_000n;
  if (BigInt(minAmount) > BigInt(amount) || BigInt(minAmount) < floor) {
    throw new Error(
      "Uniswap minimum output does not match the requested slippage",
    );
  }
  return { amount, minAmount };
}

function validateWalletBuyTransaction(input: {
  transaction: UniswapTransaction;
  swapper: EvmAddress;
  router: EvmAddress;
}): void {
  if (!same(input.transaction.to, input.router)) {
    throw new Error(
      `Uniswap returned a transaction for ${input.transaction.to}, not the configured Universal Router ${input.router}`,
    );
  }
  if (!same(input.transaction.from, input.swapper)) {
    throw new Error("Uniswap transaction sender is not the requested wallet");
  }
  if (input.transaction.chainId !== 4663) {
    throw new Error("Uniswap transaction is not on Robinhood Chain");
  }
  if (BigInt(input.transaction.value) !== 0n) {
    throw new Error("A USDG purchase cannot include native value");
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

function validateWalletTransaction(input: {
  transaction: UniswapTransaction;
  swapper: EvmAddress;
  allowedTargets: EvmAddress[];
}): void {
  if (
    !input.allowedTargets.some((target) =>
      same(input.transaction.to, target),
    )
  ) {
    throw new Error("Uniswap transaction targets an unauthorized contract");
  }
  if (!same(input.transaction.from, input.swapper)) {
    throw new Error("Uniswap transaction sender is not the connected wallet");
  }
  if (input.transaction.chainId !== 4663) {
    throw new Error("Uniswap transaction is not on Robinhood Chain");
  }
  if (BigInt(input.transaction.value) !== 0n) {
    throw new Error("Token sale cannot include native value");
  }
}

function validateApprovalTransaction(input: {
  transaction: UniswapTransaction;
  swapper: EvmAddress;
  token: EvmAddress;
  permit2: EvmAddress;
  amount: string;
}): void {
  validateWalletTransaction({
    transaction: input.transaction,
    swapper: input.swapper,
    allowedTargets: [input.token],
  });
  let decoded: ReturnType<typeof decodeFunctionData>;
  try {
    decoded = decodeFunctionData({
      abi: erc20ApproveAbi,
      data: input.transaction.data,
    });
  } catch {
    throw new Error("Uniswap approval calldata is invalid");
  }
  const [spender, amount] = decoded.args as readonly [
    EvmAddress,
    bigint,
  ];
  if (!same(spender, input.permit2)) {
    throw new Error("Uniswap approval spender is not canonical Permit2");
  }
  if (amount < BigInt(input.amount)) {
    throw new Error("Uniswap approval amount is insufficient");
  }
}

function same(left: unknown, right: string): boolean {
  return String(left ?? "").toLowerCase() === right.toLowerCase();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
