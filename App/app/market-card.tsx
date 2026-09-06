"use client";

import { useId, useState } from "react";
import { transactionUrl } from "../lib/execution-api";
import { money } from "../lib/market-format";
import type { MarketDaySeriesEntry } from "../lib/market-api";
import type {
  StockAvailability,
  StockCatalogAsset,
} from "../lib/market-types";
import type { ObservedPrice } from "./use-market-catalog";

export function MarketCard({
  asset,
  history,
  graphHistory = [],
}: {
  asset: StockCatalogAsset;
  history?: MarketDaySeriesEntry;
  graphHistory?: ObservedPrice[];
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const latestGraphPoint = [...graphHistory]
    .reverse()
    .find(
      (point) =>
        point.source === "the-graph-substreams" &&
        point.transactionHash,
    );
  const uniswapCoverage =
    asset.uniswapCoverage ??
    (asset.uniswapRoutable ? "market_observed" : "not_observed");

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
          {coverageBadge(uniswapCoverage)}
        </span>
      </header>

      <PriceHistory series={history} ticker={asset.ticker} />

      <div className="marketCardQuote">
        <span>
          <strong>{money(history?.priceUsd ?? asset.referencePrice)}</strong>
          <small>Uniswap RWA market</small>
        </span>
        <span>
          {history?.priceChange24hPct === undefined ? (
            <b>{statusLabel(asset.status)}</b>
          ) : (
            <b className={history.priceChange24hPct < 0 ? "negative" : "positive"}>
              {history.priceChange24hPct < 0 ? "▼" : "▲"}{" "}
              {Math.abs(history.priceChange24hPct).toFixed(2)}%
            </b>
          )}
          <small>24 hour change</small>
        </span>
      </div>

      <footer>
        <span className={asset.uniswapRoutable ? "verified" : ""}>
          <i />
          {coverageLabel(uniswapCoverage, asset.uniswapRouting)}
        </span>
        {latestGraphPoint?.transactionHash ? (
          <a
            className="verified"
            href={transactionUrl(latestGraphPoint.transactionHash)}
            rel="noreferrer"
            target="_blank"
          >
            <i />
            Onchain block {latestGraphPoint.blockNumber}
          </a>
        ) : asset.graphEvidence ? (
          <span className={asset.graphEvidence.healthy ? "verified" : ""}>
            <i />
            Onchain block {asset.graphEvidence.blockNumber}
          </span>
        ) : null}
      </footer>
    </article>
  );
}

function coverageBadge(
  coverage: NonNullable<StockCatalogAsset["uniswapCoverage"]>,
): string {
  if (coverage === "quote_verified") return "V4 live";
  if (coverage === "market_observed") return "Uniswap";
  if (coverage === "unavailable") return "Checking";
  return "Not observed";
}

function coverageLabel(
  coverage: NonNullable<StockCatalogAsset["uniswapCoverage"]>,
  routing?: string,
): string {
  if (coverage === "quote_verified") {
    return `Uniswap ${routing ?? "V4"} quote verified`;
  }
  if (coverage === "market_observed") return "Uniswap market observed";
  if (coverage === "unavailable") return "Uniswap coverage unavailable";
  return "Uniswap market not observed";
}

function PriceHistory({
  series,
  ticker,
}: {
  series?: MarketDaySeriesEntry;
  ticker: string;
}) {
  const id = useId().replace(/:/g, "");
  const valid = (series?.points ?? []).filter(
    (point) => Number.isFinite(point.value) && point.value > 0,
  );
  const path = smoothPath(valid);
  const negative = (series?.priceChange24hPct ?? 0) < 0;

  return (
    <div
      aria-label={`${ticker} real one day market price`}
      className={`priceHistory ${valid.length < 2 ? "collecting" : ""} ${
        negative ? "negative" : "positive"
      }`}
    >
      <svg aria-hidden="true" role="img" viewBox="0 0 240 78">
        <defs>
          <linearGradient id={`market-fill-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.24" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="chartGrid" d="M0 20H240M0 39H240M0 58H240" />
        {valid.length === 0 ? null : valid.length === 1 ? (
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
          ? "1D market history unavailable"
          : `${valid.length} real points · Uniswap 1D`}
      </span>
    </div>
  );
}

export function smoothPath(points: ObservedPrice[]): string {
  if (points.length < 2) {
    return "";
  }
  const coordinates = points.map((point, index) => ({
    x: pointX(point, points, index),
    y: pointY(point.value, points),
  }));
  if (coordinates.length === 2) {
    return `M${coordinates[0]!.x} ${coordinates[0]!.y} L${coordinates[1]!.x} ${coordinates[1]!.y}`;
  }
  let path = `M${coordinates[0]!.x.toFixed(2)} ${coordinates[0]!.y.toFixed(2)}`;
  const curve = (1 - 0.9) / 6;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const previous = coordinates[index - 1] ?? coordinates[index]!;
    const current = coordinates[index]!;
    const next = coordinates[index + 1]!;
    const following = coordinates[index + 2] ?? next;
    const lower = Math.min(current.y, next.y);
    const upper = Math.max(current.y, next.y);
    const firstControlY = clamp(
      current.y + (next.y - previous.y) * curve,
      lower,
      upper,
    );
    const secondControlY = clamp(
      next.y - (following.y - current.y) * curve,
      lower,
      upper,
    );
    path += ` C${(current.x + (next.x - previous.x) * curve).toFixed(2)} ${firstControlY.toFixed(2)} ${(next.x - (following.x - current.x) * curve).toFixed(2)} ${secondControlY.toFixed(2)} ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }
  return path;
}

function pointX(
  point: ObservedPrice,
  points: ObservedPrice[],
  index: number,
): number {
  const timestamps = points.map((entry) => Date.parse(entry.at));
  const minimum = Math.min(...timestamps);
  const maximum = Math.max(...timestamps);
  const timestamp = Date.parse(point.at);
  if (
    !Number.isFinite(timestamp) ||
    !Number.isFinite(minimum) ||
    maximum === minimum
  ) {
    return (index / (points.length - 1)) * 240;
  }
  return ((timestamp - minimum) / (maximum - minimum)) * 240;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
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
