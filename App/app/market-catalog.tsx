"use client";

import { useEffect, useMemo, useState } from "react";
import { loadStockCatalog } from "../lib/market-api";
import { money, relativeTime } from "../lib/market-format";
import type {
  StockAvailability,
  StockCatalog,
} from "../lib/market-types";

type Filter = "all" | StockAvailability;

const filters: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "available", label: "Ready" },
  { value: "caution", label: "Review" },
  { value: "blocked", label: "Blocked" },
];

export function MarketCatalog() {
  const [catalog, setCatalog] = useState<StockCatalog>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [request, setRequest] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);

    loadStockCatalog(request > 0, controller.signal)
      .then(setCatalog)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : "Market data unavailable",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [request]);

  const matchingAssets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (catalog?.assets ?? []).filter((asset) => {
      const matchesFilter = filter === "all" || asset.status === filter;
      const matchesQuery =
        !normalized ||
        asset.ticker.toLowerCase().includes(normalized) ||
        asset.name.toLowerCase().includes(normalized);
      return matchesFilter && matchesQuery;
    });
  }, [catalog, filter, query]);

  const visibleAssets =
    query || expanded ? matchingAssets : matchingAssets.slice(0, 6);

  return (
    <section className="marketCatalog">
      <header className="marketHeading">
        <div>
          <span className="eyebrow">Live market universe</span>
          <h2>Robinhood stock tokens</h2>
          <p>Availability and routes are verified before a fleet decision.</p>
        </div>
        {catalog ? (
          <div className="marketSummary">
            <span>
              <b>{catalog.summary.total}</b>
              stocks
            </span>
            <span>
              <b>{catalog.summary.routed}</b>
              routes
            </span>
            <span className="blocked">
              <b>{catalog.summary.blocked}</b>
              blocked
            </span>
          </div>
        ) : (
          <span className="marketLoading">
            {loading ? "Discovering markets" : "No market snapshot"}
          </span>
        )}
      </header>

      <div className="marketControls">
        <input
          aria-label="Search stock tokens"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search ticker or company"
          type="search"
          value={query}
        />
        <div aria-label="Filter by availability" role="group">
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
        {catalog && (
          <small>Observed {relativeTime(catalog.observedAt)}</small>
        )}
      </div>

      {error && (
        <div className="marketError">
          <div>
            <strong>Live markets are not available</strong>
            <span>{error}</span>
          </div>
          <button onClick={() => setRequest((value) => value + 1)} type="button">
            Try again
          </button>
        </div>
      )}

      <div aria-label="Stock token market catalog" className="marketTable">
        <div className="marketRow marketLabels">
          <span>Asset</span>
          <span>Reference</span>
          <span>Uniswap</span>
          <span>Price check</span>
          <span>Status</span>
        </div>

        {loading &&
          Array.from({ length: 4 }).map((_, index) => (
            <div className="marketSkeleton" key={index} />
          ))}

        {!loading &&
          visibleAssets.map((asset) => (
            <article className={`marketRow ${asset.status}`} key={asset.ticker}>
              <span className="marketAsset" data-label="Asset">
                <i>{asset.ticker.slice(0, 1)}</i>
                <span>
                  <strong>{asset.ticker}</strong>
                  <small>{asset.name}</small>
                </span>
              </span>
              <a
                data-label="Reference"
                href={
                  asset.explorerUrl ??
                  "https://docs.robinhood.com/chain/stock-token-apis/"
                }
                rel="noreferrer"
                target="_blank"
              >
                <strong>{money(asset.referencePrice)}</strong>
                <small>Robinhood price</small>
              </a>
              <span data-label="Uniswap">
                <strong>
                  {asset.uniswapImpliedPrice === undefined
                    ? asset.uniswapRoutable
                      ? "V4 route"
                      : "No route"
                    : money(asset.uniswapImpliedPrice)}
                </strong>
                <small>
                  {asset.uniswapRouting ??
                    (asset.uniswapRoutable ? "Verified" : "Unavailable")}
                </small>
              </span>
              <span className="priceCheck" data-label="Price check">
                <strong>
                  {asset.deviationBps === undefined
                    ? "—"
                    : `${asset.deviationBps.toFixed(0)} bps`}
                </strong>
                <small>{asset.reasons[0] ?? "Aligned"}</small>
              </span>
              <span data-label="Status">
                <b>{statusLabel(asset.status)}</b>
                <small>
                  {asset.orchestrationReady
                    ? "Fleet ready"
                    : "Not ready for execution"}
                </small>
              </span>
            </article>
          ))}

        {!loading && !error && matchingAssets.length === 0 && (
          <div className="marketEmpty">No assets match this view.</div>
        )}
      </div>

      {!query && matchingAssets.length > 6 && (
        <button
          className="marketExpand"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded
            ? "Show fewer stocks"
            : `Browse all ${matchingAssets.length} stocks`}
        </button>
      )}
    </section>
  );
}

function statusLabel(status: StockAvailability): string {
  if (status === "available") {
    return "Ready";
  }
  if (status === "caution") {
    return "Review";
  }
  return "Blocked";
}
