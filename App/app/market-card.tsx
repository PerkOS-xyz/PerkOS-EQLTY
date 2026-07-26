"use client";

import { useId, useState } from "react";
import { money, relativeTime } from "../lib/market-format";
import type {
  StockAvailability,
  StockCatalogAsset,
} from "../lib/market-types";
import type { ObservedPrice } from "./use-market-catalog";

export function MarketCard({
  asset,
  history = [],
}: {
  asset: StockCatalogAsset;
  history?: ObservedPrice[];
}) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <article className={`marketCard ${asset.status}`}>
      <header>
        <span className="stockLogo">
          {asset.logoUrl && !imageFailed ? (
            <img
              alt=""
              onError={() => setImageFailed(true)}
              src={asset.logoUrl}
            />
          ) : (
            asset.ticker.slice(0, 1)
          )}
        </span>
        <span className="marketCardIdentity">
          <strong>{cleanName(asset.name)}</strong>
          <small>
            {asset.ticker}
            <i>Robinhood</i>
          </small>
        </span>
        <span className={`routeState ${asset.uniswapRoutable ? "ready" : ""}`}>
          {asset.uniswapRoutable ? "V4" : "No route"}
        </span>
      </header>

      <PriceHistory points={history} ticker={asset.ticker} />

      <div className="marketCardQuote">
        <span>
          <strong>{money(asset.referencePrice)}</strong>
          <small>Robinhood reference</small>
        </span>
        <span>
          <b>{statusLabel(asset.status)}</b>
          <small>
            {asset.referenceUpdatedAt
              ? relativeTime(asset.referenceUpdatedAt)
              : "Price unavailable"}
          </small>
        </span>
      </div>

      <footer>
        <span className={asset.uniswapRoutable ? "verified" : ""}>
          <i />
          Uniswap {asset.uniswapRouting ?? "not observed"}
        </span>
        {asset.graphEvidence && (
          <span className={asset.graphEvidence.healthy ? "verified" : ""}>
            <i />
            The Graph block {asset.graphEvidence.blockNumber}
          </span>
        )}
      </footer>
    </article>
  );
}

function PriceHistory({
  points,
  ticker,
}: {
  points: ObservedPrice[];
  ticker: string;
}) {
  const id = useId().replace(/:/g, "");
  const valid = points.filter(
    (point) => Number.isFinite(point.value) && point.value > 0,
  );
  const path = linePath(valid);

  return (
    <div
      aria-label={`${ticker} Robinhood price observations`}
      className={`priceHistory ${valid.length < 2 ? "collecting" : ""}`}
    >
      <svg aria-hidden="true" role="img" viewBox="0 0 240 78">
        <defs>
          <linearGradient id={`market-fill-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.24" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="chartGrid" d="M0 20H240M0 39H240M0 58H240" />
        {valid.length === 1 ? (
          <circle cx="120" cy="39" r="3.5" />
        ) : (
          <>
            <path
              className="chartArea"
              d={`${path} L240 78 L0 78 Z`}
              fill={`url(#market-fill-${id})`}
            />
            <path className="chartLine" d={path} />
            <circle
              className="chartLast"
              cx="240"
              cy={pointY(valid.at(-1)!.value, valid)}
              r="3"
            />
          </>
        )}
      </svg>
      <span>
        {valid.length < 2
          ? "Collecting real price history"
          : `${valid.length} Robinhood quotes · 24h browser window`}
      </span>
    </div>
  );
}

function linePath(points: ObservedPrice[]): string {
  if (points.length < 2) {
    return "";
  }
  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 240;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${pointY(
        point.value,
        points,
      ).toFixed(2)}`;
    })
    .join(" ");
}

function pointY(value: number, points: ObservedPrice[]): number {
  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (maximum === minimum) {
    return 39;
  }
  return 68 - ((value - minimum) / (maximum - minimum)) * 58;
}

function cleanName(value: string): string {
  return value
    .replace(/\s*[·•-]\s*Robinhood Token$/i, "")
    .replace(/\s*Robinhood Token$/i, "");
}

export function statusLabel(status: StockAvailability): string {
  if (status === "available") {
    return "Ready";
  }
  if (status === "caution") {
    return "Review";
  }
  return "Blocked";
}
