import type { ApiConfig } from "./config.js";
import {
  type GraphEvidence,
} from "./graph-evidence.js";
import { MarketEvidenceService } from "./market-evidence.js";
import type {
  EvmAddress,
  RobinhoodAsset,
  RobinhoodQuote,
  StockAvailability,
  StockCatalog,
  StockCatalogAsset,
} from "./market-types.js";
import { UniswapClient } from "./uniswap-client.js";
import {
  UniswapRwaMarketService,
  type UniswapRwaCoverage,
} from "./uniswap-rwa-market.js";

const assetsUrl = "https://api.robinhood.com/rhj/assets";
const pricesUrl = "https://api.robinhood.com/rhj/prices";
const cacheTtlMs = 60_000;
const retryDelaysMs = [500, 1_500, 3_500] as const;
const availableDeviationBps = 100;
const maxDeviationBps = 300;

type Dependencies = {
  fetchFn?: typeof fetch;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  uniswap?: Pick<UniswapClient, "quote" | "ready">;
  uniswapMarket?: Pick<UniswapRwaMarketService, "coverage">;
  evidence?: Pick<MarketEvidenceService, "evidence" | "ready">;
  graph?: Pick<MarketEvidenceService, "evidence" | "ready">;
};

export class StockCatalogService {
  private cached?: { expiresAt: number; value: StockCatalog };
  private pending?: Promise<StockCatalog>;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly uniswap: Pick<UniswapClient, "quote" | "ready">;
  private readonly uniswapMarket: Pick<
    UniswapRwaMarketService,
    "coverage"
  >;
  private readonly evidence: Pick<
    MarketEvidenceService,
    "evidence" | "ready"
  >;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.fetchFn = dependencies.fetchFn ?? fetch;
    this.now = dependencies.now ?? Date.now;
    this.wait = dependencies.wait ?? delay;
    this.uniswap =
      dependencies.uniswap ?? new UniswapClient(config, this.fetchFn);
    this.uniswapMarket =
      dependencies.uniswapMarket ??
      new UniswapRwaMarketService(config, { fetch: this.fetchFn });
    this.evidence =
      dependencies.evidence ??
      dependencies.graph ??
      new MarketEvidenceService(config);
  }

  async catalog(force = false): Promise<StockCatalog> {
    const now = this.now();
    if (!force && this.cached && this.cached.expiresAt > now) {
      return this.cached.value;
    }
    if (this.pending) {
      return this.pending;
    }

    this.pending = this.refresh()
      .then((value) => {
        this.cached = {
          expiresAt: this.now() + cacheTtlMs,
          value,
        };
        return value;
      })
      .catch((error: unknown) => {
        if (this.cached) {
          return this.cached.value;
        }
        throw error;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  async assessTicker(
    ticker: string,
  ): Promise<StockCatalogAsset | undefined> {
    const normalized = ticker.trim().toUpperCase();
    const catalog = await this.catalog();
    const entry = catalog.assets.find((asset) => asset.ticker === normalized);
    if (!entry || !this.uniswap.ready()) {
      return entry;
    }

    const [quoteResult, graphResult] = await Promise.allSettled([
      this.uniswap.quote(
        entry.tokenAddress,
        catalog.quoteAmount,
      ),
      this.evidence.ready()
        ? this.evidence.evidence(normalized)
        : Promise.reject(
            new Error("Onchain evidence provider is not configured"),
          ),
    ]);
    if (quoteResult.status === "rejected") {
      return {
        ...entry,
        status: "blocked",
        reasons: [...entry.reasons, "Fresh Uniswap quote failed"],
        orchestrationReady: false,
      };
    }

    try {
      const quote = quoteResult.value;
      const inputUsd = Number(catalog.quoteAmount) / 1_000_000;
      const outputTokens = Number(quote.amountOut) / 1e18;
      const impliedPrice = inputUsd / outputTokens;
      const deviationBps =
        entry.referencePrice && Number.isFinite(impliedPrice)
          ? (Math.abs(impliedPrice - entry.referencePrice) /
              entry.referencePrice) *
            10_000
          : undefined;
      const reasons = entry.reasons.filter(
        (reason) =>
          !reason.startsWith("Not observed in the Uniswap") &&
          !reason.startsWith("Uniswap market coverage"),
      );
      if (
        deviationBps !== undefined &&
        deviationBps > maxDeviationBps
      ) {
        reasons.push(
          `Price deviation ${deviationBps.toFixed(1)} bps exceeds policy`,
        );
      }
      let graphEvidence =
        graphResult.status === "fulfilled"
          ? summarizeGraph(graphResult.value)
          : undefined;
      if (graphResult.status === "rejected") {
        reasons.push(errorMessage(graphResult.reason));
      } else {
        const graphPriceDeviationBps = priceDeviationBps(
          graphResult.value.lastSwapPrice,
          impliedPrice,
        );
        graphEvidence = {
          ...graphEvidence!,
          priceDeviationBps: graphPriceDeviationBps,
        };
        if (
          graphPriceDeviationBps >
          this.config.GRAPH_MAX_PRICE_DEVIATION_BPS
        ) {
          const reason =
            `swap price differs from the executable quote by ` +
            `${graphPriceDeviationBps.toFixed(1)} bps`;
          reasons.push(`${evidenceLabel(graphResult.value)}: ${reason}`);
          graphEvidence = {
            ...graphEvidence,
            healthy: false,
            reasons: [...graphEvidence.reasons, reason],
          };
        }
        if (!graphResult.value.health.healthy) {
          reasons.push(
            ...graphResult.value.health.reasons.map(
              (reason) =>
                `${evidenceLabel(graphResult.value)}: ${reason}`,
            ),
          );
        }
      }
      const status = classify(reasons, deviationBps);

      return {
        ...entry,
        uniswapCoverage: "quote_verified",
        uniswapRoutable: true,
        uniswapRouting: quote.routing,
        uniswapRouteVerifiedAt: new Date(this.now()).toISOString(),
        uniswapRequestId: quote.requestId,
        quotedAmountOut: quote.amountOut,
        uniswapImpliedPrice: impliedPrice,
        deviationBps,
        graphEvidence,
        status,
        reasons,
        orchestrationReady:
          status !== "blocked" && graphEvidence?.healthy === true,
      };
    } catch {
      return {
        ...entry,
        status: "blocked",
        reasons: [...entry.reasons, "Fresh Uniswap quote failed"],
        orchestrationReady: false,
      };
    }
  }

  private async refresh(): Promise<StockCatalog> {
    const uniswapCoveragePromise = this.uniswapMarket
      .coverage()
      .catch(() => undefined);
    const assetsBody = await this.fetchJson<{
      assets?: RobinhoodAsset[];
    }>(assetsUrl);
    const pricesBody = await this.fetchJson<{
      quotes?: RobinhoodQuote[];
    }>(pricesUrl);
    const uniswapCoverage = await uniswapCoveragePromise;
    const quotes = new Map(
      (pricesBody.quotes ?? []).map((quote) => [
        quote.tokenSymbol.toUpperCase(),
        quote,
      ]),
    );
    const observedRoutes = coverageAddresses(uniswapCoverage);
    const assets = (assetsBody.assets ?? [])
      .flatMap((asset): StockCatalogAsset[] => {
        const deployment = asset.deployments.find(
          (candidate) => candidate.chainId === 4663,
        );
        if (!deployment || !isAddress(deployment.contractAddress)) {
          return [];
        }
        return [
          this.catalogEntry(
            asset,
            deployment.contractAddress,
            quotes.get(asset.tokenSymbol.toUpperCase()),
            observedRoutes.has(deployment.contractAddress.toLowerCase()),
            uniswapCoverage?.observedAt,
          ),
        ];
      })
      .sort(compareAssets);

    return {
      chainId: 4663,
      quoteToken: "USDG",
      quoteAmount: this.config.MAINNET_QUOTE_AMOUNT,
      observedAt: new Date(this.now()).toISOString(),
      thresholds: {
        availableDeviationBps,
        maxDeviationBps,
        maxReferenceAgeSeconds: this.config.REFERENCE_MAX_AGE_SECONDS,
      },
      summary: summarize(assets),
      assets,
    };
  }

  private catalogEntry(
    asset: RobinhoodAsset,
    tokenAddress: EvmAddress,
    quote?: RobinhoodQuote,
    uniswapObserved = false,
    uniswapObservedAt?: string,
  ): StockCatalogAsset {
    const ticker = asset.tokenSymbol.toUpperCase();
    const robinhoodStatus = normalizeStatus(asset.status);
    const tradability = normalizeTradability(asset);
    const uniswapRoutable = uniswapObserved;
    const reasons: string[] = [];

    if (robinhoodStatus !== "ACTIVE") {
      reasons.push(`Robinhood status is ${robinhoodStatus}`);
    }
    if (tradability !== "TRADABLE") {
      reasons.push(`Robinhood tradability is ${tradability}`);
    }
    if (!quote) {
      reasons.push("Robinhood reference price is unavailable");
    }
    if (quote?.isTradingHalt) {
      reasons.push("Robinhood reports a trading halt");
    }
    if (
      quote &&
      this.now() - Date.parse(quote.generatedAt) >
        this.config.REFERENCE_MAX_AGE_SECONDS * 1_000
    ) {
      reasons.push("Robinhood reference price is stale");
    }
    if (!uniswapObservedAt) {
      reasons.push("Uniswap market coverage is unavailable");
    } else if (!uniswapRoutable) {
      reasons.push("Not observed in the Uniswap Robinhood market");
    }

    const referencePrice = quote
      ? Number(quote.ask) * Number(asset.currentMultiplier)
      : undefined;
    if (
      referencePrice !== undefined &&
      (!Number.isFinite(referencePrice) || referencePrice <= 0)
    ) {
      reasons.push("Robinhood reference price is invalid");
    }

    return {
      ticker,
      name: asset.tokenName,
      tokenAddress,
      logoUrl: asset.logoUrl,
      multiplier: asset.currentMultiplier,
      robinhoodStatus,
      tradability,
      explorerUrl:
        "https://docs.robinhood.com/chain/stock-token-apis/",
      priceSource: "robinhood-price-api",
      referencePrice,
      referenceUpdatedAt: quote?.generatedAt,
      uniswapRoutable,
      uniswapCoverage: !uniswapObservedAt
        ? "unavailable"
        : uniswapRoutable
          ? "market_observed"
          : "not_observed",
      uniswapMarketObservedAt: uniswapRoutable
        ? uniswapObservedAt
        : undefined,
      uniswapRouting: uniswapRoutable ? "RWA MARKET" : undefined,
      quotedAmountIn: this.config.MAINNET_QUOTE_AMOUNT,
      status: reasons.length === 0 ? "available" : "blocked",
      reasons,
      orchestrationReady: false,
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchFn(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (response.ok) {
        return response.json() as Promise<T>;
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= retryDelaysMs.length) {
        throw new Error(
          `Robinhood API failed with status ${response.status}`,
        );
      }
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      await this.wait(retryAfter ?? retryDelaysMs[attempt]!);
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 5_000);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(Math.max(timestamp - Date.now(), 0), 5_000);
}

function summarizeGraph(
  evidence: GraphEvidence,
): NonNullable<StockCatalogAsset["graphEvidence"]> {
  return {
    source: evidence.source,
    healthy: evidence.health.healthy,
    protocol: evidence.protocol,
    blockNumber: evidence.blockNumber,
    liquidityUsd: evidence.liquidityUsd,
    lastSwapPrice: evidence.lastSwapPrice,
    poolAddress: evidence.poolAddress as `0x${string}`,
    poolIdentifier: evidence.poolIdentifier,
    transactionHash: evidence.transactionHash as `0x${string}`,
    topic: evidence.topic as `0x${string}`,
    capturedAt: evidence.capturedAt,
    processedBlock: evidence.stream.processedBlock,
    providerHeadBlock: evidence.stream.providerHeadBlock,
    lagBlocks: evidence.stream.lagBlocks,
    provider: evidence.stream.provider,
    package: evidence.stream.package,
    module: evidence.stream.module,
    startedAt: evidence.stream.startedAt,
    updatedAt: evidence.stream.updatedAt,
    checkpointBlock: evidence.stream.checkpointBlock,
    reasons: evidence.health.reasons,
  };
}

function coverageAddresses(
  coverage?: UniswapRwaCoverage,
): Set<string> {
  return new Set(
    (coverage?.assets ?? []).map((asset) =>
      asset.tokenAddress.toLowerCase(),
    ),
  );
}

function normalizeStatus(status: string): string {
  return status.replace("ASSET_STATUS_", "").toUpperCase();
}

function normalizeTradability(asset: RobinhoodAsset): string {
  return (
    asset.tradingCapabilities?.market?.fractional ??
    asset.tradingCapabilities?.fractionalTradability ??
    "UNKNOWN"
  )
    .replace("TRADING_STATUS_", "")
    .toUpperCase();
}

function classify(
  reasons: string[],
  deviationBps?: number,
): StockAvailability {
  if (reasons.length > 0 || deviationBps === undefined) return "blocked";
  return deviationBps > availableDeviationBps ? "caution" : "available";
}

function compareAssets(
  left: StockCatalogAsset,
  right: StockCatalogAsset,
): number {
  const order = { available: 0, caution: 1, blocked: 2 };
  return order[left.status] - order[right.status] ||
    left.ticker.localeCompare(right.ticker);
}

function summarize(assets: StockCatalogAsset[]): StockCatalog["summary"] {
  return {
    total: assets.length,
    available: assets.filter((asset) => asset.status === "available").length,
    caution: assets.filter((asset) => asset.status === "caution").length,
    blocked: assets.filter((asset) => asset.status === "blocked").length,
    routed: assets.filter((asset) => asset.uniswapRoutable).length,
    orchestrationReady: assets.filter(
      (asset) => asset.orchestrationReady,
    ).length,
  };
}

function isAddress(value: string): value is EvmAddress {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Onchain evidence failed";
}

function evidenceLabel(evidence: GraphEvidence): string {
  return evidence.source === "the-graph-substreams"
    ? "The Graph"
    : "Onchain RPC";
}

function priceDeviationBps(price: number, reference: number): number {
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(reference) ||
    price <= 0 ||
    reference <= 0
  ) {
    return Number.POSITIVE_INFINITY;
  }
  return (Math.abs(price - reference) / reference) * 10_000;
}
