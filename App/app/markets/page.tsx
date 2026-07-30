"use client";

import { useMemo, useState } from "react";
import { AppHeader } from "../app-header";
import { MarketCard } from "../market-card";
import { relativeTime } from "../../lib/market-format";
import type { StockAvailability } from "../../lib/market-types";
import { useMarketCatalog } from "../use-market-catalog";

type Filter = "all" | "routed" | "decision" | StockAvailability;

const filters: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All stocks" },
  { value: "routed", label: "Uniswap V4" },
  { value: "decision", label: "Decision ready" },
  { value: "available", label: "Price aligned" },
  { value: "caution", label: "Review" },
  { value: "blocked", label: "Blocked" },
];

export default function MarketsPage() {
  const {
    catalog,
    history,
    graphHistory,
    graphIntegration,
    loading,
    error,
    refresh,
    historyState,
    seriesState,
  } = useMarketCatalog();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const assets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (catalog?.assets ?? []).filter((asset) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "routed"
          ? asset.uniswapRoutable
          : filter === "decision"
            ? asset.orchestrationReady
            : asset.status === filter);
      const matchesQuery =
        !normalized ||
        asset.ticker.toLowerCase().includes(normalized) ||
        asset.name.toLowerCase().includes(normalized);
      return matchesFilter && matchesQuery;
    });
  }, [catalog, filter, query]);

  return (
    <div className="shell">
      <AppHeader active="markets" />
      <main className="marketPage">
        <section className="marketPageHero">
          <div>
            <span className="eyebrow">Robinhood Chain markets</span>
            <h1>Explore stock tokens</h1>
            <p>
              Live reference prices from Robinhood, observed Uniswap V4 routes
              and The Graph evidence when a fleet completes its assessment.
            </p>
          </div>
          {catalog && (
            <div className="marketPageMetrics">
              <span>
                <small>Stock tokens</small>
                <strong>{catalog.summary.total}</strong>
              </span>
              <span>
                <small>V4 routes</small>
                <strong>{catalog.summary.routed}</strong>
              </span>
              <span>
                <small>Decision ready</small>
                <strong>{catalog.summary.orchestrationReady}</strong>
              </span>
              <span>
                <small>Price aligned</small>
                <strong>{catalog.summary.available}</strong>
              </span>
            </div>
          )}
        </section>

        <section className="marketSourceNotice">
          <span>
            <i />
            1D market
            <b>
              Uniswap RWA{" "}
              {historyState === "ready"
                ? "live"
                : historyState === "loading"
                  ? "loading"
                  : "unavailable"}
            </b>
          </span>
          <span>
            <i />
            Routes
            <b>Uniswap V4</b>
          </span>
          <span>
            <i />
            Swap history
            <b>
              The Graph{" "}
              {graphIntegration?.status === "degraded"
                ? graphHealthLabel(graphIntegration.reason)
                : seriesState === "ready"
                ? "live"
                : seriesState === "loading"
                  ? "connecting"
                  : "unavailable"}
            </b>
          </span>
          <p>
            Every 1D chart point comes from Uniswap RWA market data. The Graph
            swaps are shown separately as indexed execution evidence. No
            synthetic history is displayed.
          </p>
        </section>

        <section className="marketDirectory">
          <header className="marketDirectoryHeader">
            <div>
              <h2>All stock tokens</h2>
              <small>
                {catalog
                  ? `${assets.length} results · observed ${relativeTime(
                      catalog.observedAt,
                    )}`
                  : "Loading the market universe"}
              </small>
            </div>
            <button onClick={refresh} type="button">
              Refresh data
            </button>
          </header>

          <div className="marketControls">
            <label>
              <span>Search markets</span>
              <input
                aria-label="Search stock tokens"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search ticker or company"
                type="search"
                value={query}
              />
            </label>
            <div aria-label="Filter markets" role="group">
              {filters.map((item) => (
                <button
                  className={filter === item.value ? "selected" : ""}
                  key={item.value}
                  onClick={() => setFilter(item.value)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="marketError">
              <div>
                <strong>Live markets are not available</strong>
                <span>{error}</span>
              </div>
              <button onClick={refresh} type="button">
                Try again
              </button>
            </div>
          )}

          <div aria-busy={loading} className="marketGrid">
            {loading &&
              Array.from({ length: 8 }).map((_, index) => (
                <div className="marketCardSkeleton" key={index} />
              ))}
            {!loading &&
              assets.map((asset) => (
                <MarketCard
                  asset={asset}
                  graphHistory={graphHistory[asset.ticker]}
                  history={history[asset.ticker]}
                  key={asset.ticker}
                />
              ))}
          </div>

          {!loading && !error && assets.length === 0 && (
            <div className="marketEmpty">No assets match this view.</div>
          )}
        </section>
      </main>
    </div>
  );
}

function graphHealthLabel(
  reason:
    | "not-configured"
    | "unreachable"
    | "not-running"
    | "quota-exhausted"
    | "provider-error"
    | "lagging"
    | undefined,
): string {
  if (reason === "quota-exhausted") return "degraded · quota exhausted";
  if (reason === "lagging") return "degraded · syncing";
  if (reason === "not-configured") return "not configured";
  return "degraded";
}
