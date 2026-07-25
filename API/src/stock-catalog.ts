import type { ApiConfig } from "./config.js";
import {
  GraphEvidenceService,
  type GraphEvidence,
} from "./graph-evidence.js";
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
  hasObservedV4Route,
  UNISWAP_V4_COVERAGE_OBSERVED_AT,
} from "./uniswap-coverage.js";

const assetsUrl = "https://api.robinhood.com/rhj/assets";
const pricesUrl = "https://api.robinhood.com/rhj/prices";
const cacheTtlMs = 60_000;
const availableDeviationBps = 100;
const maxDeviationBps = 300;

type Dependencies = {
  fetchFn?: typeof fetch;
  now?: () => number;
  uniswap?: Pick<UniswapClient, "quote" | "ready">;
  graph?: Pick<GraphEvidenceService, "evidence" | "ready">;
};

export class StockCatalogService {
  private cached?: { expiresAt: number; value: StockCatalog };
  private pending?: Promise<StockCatalog>;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly uniswap: Pick<UniswapClient, "quote" | "ready">;
  private readonly graph: Pick<GraphEvidenceService, "evidence" | "ready">;

  constructor(
    private readonly config: ApiConfig,
    dependencies: Dependencies = {},
  ) {
    this.fetchFn = dependencies.fetchFn ?? fetch;
    this.now = dependencies.now ?? Date.now;
    this.uniswap =
      dependencies.uniswap ?? new UniswapClient(config, this.fetchFn);
    this.graph =
      dependencies.graph ??
      new GraphEvidenceService(config, {
        fetchFn: this.fetchFn,
        now: this.now,
      });
  }

  async catalog(force = false): Promise<StockCatalog> {
    const now = this.now();
    if (!force && this.cached && this.cached.expiresAt > now) {
      return this.cached.value;
    }
    if (!force && this.pending) {
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
      this.graph.ready()
        ? this.graph.evidence(normalized)
        : Promise.reject(
            new Error("The Graph evidence provider is not configured"),
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
        (reason) => !reason.startsWith("No observed Uniswap"),
      );
      if (
        deviationBps !== undefined &&
        deviationBps > maxDeviationBps
      ) {
        reasons.push(
          `Price deviation ${deviationBps.toFixed(1)} bps exceeds policy`,
        );
      }
      const graphEvidence =
        graphResult.status === "fulfilled"
          ? summarizeGraph(graphResult.value)
          : undefined;
      if (graphResult.status === "rejected") {
        reasons.push(errorMessage(graphResult.reason));
      } else if (!graphResult.value.health.healthy) {
        reasons.push(
          ...graphResult.value.health.reasons.map(
            (reason) => `The Graph: ${reason}`,
          ),
        );
      }
      const status = classify(reasons, deviationBps);

      return {
        ...entry,
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
    const [assetsBody, pricesBody] = await Promise.all([
      this.fetchJson<{ assets?: RobinhoodAsset[] }>(assetsUrl),
      this.fetchJson<{ quotes?: RobinhoodQuote[] }>(pricesUrl),
    ]);
    const quotes = new Map(
      (pricesBody.quotes ?? []).map((quote) => [
        quote.tokenSymbol.toUpperCase(),
        quote,
      ]),
    );
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
  ): StockCatalogAsset {
    const ticker = asset.tokenSymbol.toUpperCase();
    const robinhoodStatus = normalizeStatus(asset.status);
    const tradability = normalizeTradability(asset);
    const uniswapRoutable = hasObservedV4Route(ticker);
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
    if (!uniswapRoutable) {
      reasons.push("No observed Uniswap V4 route");
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
      uniswapRouting: uniswapRoutable ? "V4 OBSERVED" : undefined,
      uniswapRouteVerifiedAt: uniswapRoutable
        ? UNISWAP_V4_COVERAGE_OBSERVED_AT
        : undefined,
      quotedAmountIn: this.config.MAINNET_QUOTE_AMOUNT,
      status: reasons.length === 0 ? "available" : "blocked",
      reasons,
      orchestrationReady: false,
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await this.fetchFn(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      throw new Error(`Robinhood API failed with status ${response.status}`);
    }
    return response.json() as Promise<T>;
  }
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
    transactionHash: evidence.transactionHash as `0x${string}`,
    capturedAt: evidence.capturedAt,
    processedBlock: evidence.stream.processedBlock,
    providerHeadBlock: evidence.stream.providerHeadBlock,
    lagBlocks: evidence.stream.lagBlocks,
    reasons: evidence.health.reasons,
  };
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
  return error instanceof Error ? error.message : "The Graph evidence failed";
}
