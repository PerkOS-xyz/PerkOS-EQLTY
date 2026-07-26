"use client";

import { useId, useState } from "react";
import { transactionUrl } from "../lib/execution-api";
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
  const latestGraphPoint = [...history]
    .reverse()
    .find(
      (point) =>
        point.source === "the-graph-substreams" &&
        point.transactionHash,
    );

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
        {latestGraphPoint?.transactionHash ? (
          <a
            className="verified"
            href={transactionUrl(latestGraphPoint.transactionHash)}
            rel="noreferrer"
            target="_blank"
          >
            <i />
            The Graph block {latestGraphPoint.blockNumber}
          </a>
        ) : asset.graphEvidence ? (
          <span className={asset.graphEvidence.healthy ? "verified" : ""}>
            <i />
            The Graph block {asset.graphEvidence.blockNumber}
          </span>
        ) : null}
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
  const path = smoothPath(valid);
  const graphPoints = valid.filter(
    (point) => point.source === "the-graph-substreams",
  ).length;
  const quotePoints = valid.length - graphPoints;

  return (
    <div
      aria-label={`${ticker} observed market prices`}
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
          ? "Collecting real market history"
          : graphPoints > 0
            ? `${graphPoints} The Graph swaps · ${quotePoints} Robinhood quotes`
            : `${quotePoints} Robinhood quotes · The Graph series pending`}
      </span>
    </div>
  );
}

export function smoothPath(points: ObservedPrice[]): string {
  if (points.length < 2) {
    return "";
  }
  const coordinates = points.map((point, index) => ({
    x: (index / (points.length - 1)) * 240,
    y: pointY(point.value, points),
  }));
  if (coordinates.length === 2) {
    return `M${coordinates[0]!.x} ${coordinates[0]!.y} L${coordinates[1]!.x} ${coordinates[1]!.y}`;
  }
  let path = `M${coordinates[0]!.x.toFixed(2)} ${coordinates[0]!.y.toFixed(2)}`;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const previous = coordinates[index - 1] ?? coordinates[index]!;
    const current = coordinates[index]!;
    const next = coordinates[index + 1]!;
    const following = coordinates[index + 2] ?? next;
    const lower = Math.min(current.y, next.y);
    const upper = Math.max(current.y, next.y);
    const firstControlY = clamp(
      current.y + (next.y - previous.y) / 6,
      lower,
      upper,
    );
    const secondControlY = clamp(
      next.y - (following.y - current.y) / 6,
      lower,
      upper,
    );
    path += ` C${(current.x + (next.x - previous.x) / 6).toFixed(2)} ${firstControlY.toFixed(2)} ${(next.x - (following.x - current.x) / 6).toFixed(2)} ${secondControlY.toFixed(2)} ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }
  return path;
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
