import {
  createPublicClient,
  defineChain,
  formatUnits,
  http,
} from "viem";
import type { ApiConfig } from "./config.js";
import type { EvmAddress, StockCatalogAsset } from "./market-types.js";
import type {
  PurchaseHistory,
  PurchaseHistoryService,
} from "./purchase-history.js";
import type { StockCatalogService } from "./stock-catalog.js";

const tokenAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

export type TokenBalance = {
  token: EvmAddress;
  rawBalance: string;
  decimals: number;
};

export type BalanceSnapshot = {
  checkedTokens: number;
  unreadableTokens: number;
  balances: TokenBalance[];
};

export type PortfolioHolding = {
  ticker: string;
  name: string;
  tokenAddress: EvmAddress;
  logoUrl?: string;
  balance: string;
  decimals: number;
  currentPriceUsd?: number;
  priceUpdatedAt?: string;
  marketValueUsd?: number;
  averageCostUsd?: number;
  costBasisUsd?: number;
  unrealizedGainUsd?: number;
  unrealizedGainPercent?: number;
  purchaseCount: number;
  costStatus: "verified" | "partial" | "unavailable";
};

export type Portfolio = {
  source: "robinhood-chain";
  status: "ready" | "pending";
  owner: EvmAddress;
  observedAt: string;
  coverage: {
    checkedTokens: number;
    unreadableTokens: number;
    pricedPositions: number;
    verifiedCostPositions: number;
  };
  summary: {
    positions: number;
    marketValueUsd: number;
    costBasisUsd: number;
    unrealizedGainUsd: number;
  };
  holdings: PortfolioHolding[];
};

export type PortfolioBalanceReader = {
  read(
    owner: EvmAddress,
    tokens: EvmAddress[],
  ): Promise<BalanceSnapshot>;
};

type Dependencies = {
  history: Pick<PurchaseHistoryService, "list">;
  catalog: Pick<StockCatalogService, "catalog">;
  balances?: PortfolioBalanceReader;
};

export class PortfolioService {
  private readonly balances: PortfolioBalanceReader;

  constructor(
    private readonly config: ApiConfig,
    private readonly dependencies: Dependencies,
  ) {
    this.balances =
      dependencies.balances ?? new ViemPortfolioBalanceReader(config);
  }

  async read(owner: EvmAddress): Promise<Portfolio> {
    const observedAt = new Date().toISOString();
    if (!this.config.ROBINHOOD_MAINNET_RPC_URL) {
      return pendingPortfolio(owner, observedAt);
    }

    const [history, catalog] = await Promise.all([
      this.dependencies.history.list(owner),
      this.dependencies.catalog.catalog(),
    ]);
    if (history.status === "pending") {
      return pendingPortfolio(owner, observedAt);
    }

    const snapshot = await this.balances.read(
      owner,
      catalog.assets.map((asset) => asset.tokenAddress),
    );
    const purchases = groupPurchases(history);
    const assets = new Map(
      catalog.assets.map((asset) => [
        asset.tokenAddress.toLowerCase(),
        asset,
      ]),
    );
    const holdings = snapshot.balances
      .flatMap((balance): PortfolioHolding[] => {
        if (BigInt(balance.rawBalance) === 0n) {
          return [];
        }
        const asset = assets.get(balance.token.toLowerCase());
        if (!asset) {
          return [];
        }
        return [
          createHolding(
            asset,
            balance,
            purchases.get(balance.token.toLowerCase()),
          ),
        ];
      })
      .sort(
        (left, right) =>
          (right.marketValueUsd ?? 0) - (left.marketValueUsd ?? 0) ||
          left.ticker.localeCompare(right.ticker),
      );

    return {
      source: "robinhood-chain",
      status: "ready",
      owner,
      observedAt,
      coverage: {
        checkedTokens: snapshot.checkedTokens,
        unreadableTokens: snapshot.unreadableTokens,
        pricedPositions: holdings.filter(
          (holding) => holding.currentPriceUsd !== undefined,
        ).length,
        verifiedCostPositions: holdings.filter(
          (holding) => holding.costStatus === "verified",
        ).length,
      },
      summary: {
        positions: holdings.length,
        marketValueUsd: sum(holdings, "marketValueUsd"),
        costBasisUsd: sum(holdings, "costBasisUsd"),
        unrealizedGainUsd: sum(holdings, "unrealizedGainUsd"),
      },
      holdings,
    };
  }
}

class ViemPortfolioBalanceReader implements PortfolioBalanceReader {
  constructor(private readonly config: ApiConfig) {}

  async read(
    owner: EvmAddress,
    tokens: EvmAddress[],
  ): Promise<BalanceSnapshot> {
    const rpcUrl = this.config.ROBINHOOD_MAINNET_RPC_URL;
    if (!rpcUrl) {
      throw new Error("Portfolio RPC is not configured");
    }
    const chain = defineChain({
      id: 4663,
      name: "Robinhood Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const client = createPublicClient({
      chain,
      transport: http(rpcUrl, { batch: true, timeout: 12_000 }),
    });
    if ((await client.getChainId()) !== 4663) {
      throw new Error("Portfolio RPC is not Robinhood Chain");
    }

    const uniqueTokens = [
      ...new Map(tokens.map((token) => [token.toLowerCase(), token])).values(),
    ];
    const held: Array<{ token: EvmAddress; rawBalance: bigint }> = [];
    let unreadableTokens = 0;
    for (let index = 0; index < uniqueTokens.length; index += 40) {
      const chunk = uniqueTokens.slice(index, index + 40);
      const results = await Promise.allSettled(
        chunk.map((token) =>
          client.readContract({
            address: token,
            abi: tokenAbi,
            functionName: "balanceOf",
            args: [owner],
          }),
        ),
      );
      results.forEach((result, resultIndex) => {
        const token = chunk[resultIndex];
        if (!token || result.status === "rejected") {
          unreadableTokens += 1;
        } else if (result.value > 0n) {
          held.push({ token, rawBalance: result.value });
        }
      });
    }

    const balances: TokenBalance[] = [];
    for (let index = 0; index < held.length; index += 40) {
      const chunk = held.slice(index, index + 40);
      const results = await Promise.allSettled(
        chunk.map(({ token }) =>
          client.readContract({
            address: token,
            abi: tokenAbi,
            functionName: "decimals",
          }),
        ),
      );
      results.forEach((result, resultIndex) => {
        const item = chunk[resultIndex];
        if (!item || result.status === "rejected") {
          unreadableTokens += 1;
        } else {
          balances.push({
            token: item.token,
            rawBalance: String(item.rawBalance),
            decimals: result.value,
          });
        }
      });
    }

    return {
      checkedTokens: uniqueTokens.length,
      unreadableTokens,
      balances,
    };
  }
}

type PurchaseTotals = {
  rawAmountOut: bigint;
  costUsd: number;
  count: number;
};

function groupPurchases(
  history: PurchaseHistory,
): Map<string, PurchaseTotals> {
  const grouped = new Map<string, PurchaseTotals>();
  for (const entry of history.entries) {
    const key = entry.outputToken.toLowerCase();
    const current = grouped.get(key) ?? {
      rawAmountOut: 0n,
      costUsd: 0,
      count: 0,
    };
    current.rawAmountOut += BigInt(entry.amountOut);
    current.costUsd += Number(entry.amountIn) / 1_000_000;
    current.count += 1;
    grouped.set(key, current);
  }
  return grouped;
}

function createHolding(
  asset: StockCatalogAsset,
  balance: TokenBalance,
  purchases?: PurchaseTotals,
): PortfolioHolding {
  const quantity = Number(formatUnits(BigInt(balance.rawBalance), balance.decimals));
  const marketValueUsd =
    asset.referencePrice === undefined
      ? undefined
      : quantity * asset.referencePrice;
  const acquiredQuantity = purchases
    ? Number(formatUnits(purchases.rawAmountOut, balance.decimals))
    : 0;
  const averageCostUsd =
    purchases && acquiredQuantity > 0
      ? purchases.costUsd / acquiredQuantity
      : undefined;
  const costStatus =
    !purchases || acquiredQuantity === 0
      ? "unavailable"
      : BigInt(balance.rawBalance) <= purchases.rawAmountOut
        ? "verified"
        : "partial";
  const costBasisUsd =
    costStatus === "verified" && averageCostUsd !== undefined
      ? averageCostUsd * quantity
      : undefined;
  const unrealizedGainUsd =
    marketValueUsd !== undefined && costBasisUsd !== undefined
      ? marketValueUsd - costBasisUsd
      : undefined;
  const unrealizedGainPercent =
    unrealizedGainUsd !== undefined && costBasisUsd && costBasisUsd > 0
      ? (unrealizedGainUsd / costBasisUsd) * 100
      : undefined;

  return {
    ticker: asset.ticker,
    name: asset.name,
    tokenAddress: asset.tokenAddress,
    logoUrl: asset.logoUrl,
    balance: formatUnits(BigInt(balance.rawBalance), balance.decimals),
    decimals: balance.decimals,
    currentPriceUsd: asset.referencePrice,
    priceUpdatedAt: asset.referenceUpdatedAt,
    marketValueUsd,
    averageCostUsd,
    costBasisUsd,
    unrealizedGainUsd,
    unrealizedGainPercent,
    purchaseCount: purchases?.count ?? 0,
    costStatus,
  };
}

function pendingPortfolio(
  owner: EvmAddress,
  observedAt: string,
): Portfolio {
  return {
    source: "robinhood-chain",
    status: "pending",
    owner,
    observedAt,
    coverage: {
      checkedTokens: 0,
      unreadableTokens: 0,
      pricedPositions: 0,
      verifiedCostPositions: 0,
    },
    summary: {
      positions: 0,
      marketValueUsd: 0,
      costBasisUsd: 0,
      unrealizedGainUsd: 0,
    },
    holdings: [],
  };
}

function sum(
  holdings: PortfolioHolding[],
  field: "marketValueUsd" | "costBasisUsd" | "unrealizedGainUsd",
): number {
  return holdings.reduce((total, holding) => total + (holding[field] ?? 0), 0);
}
