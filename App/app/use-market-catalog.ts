"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadStockCatalog,
  loadStockSeries,
  type MarketSeriesResponse,
} from "../lib/market-api";
import type { StockCatalog } from "../lib/market-types";

export type ObservedPrice = {
  at: string;
  value: number;
  source?: "robinhood-price-api" | "the-graph-substreams";
  blockNumber?: string;
  transactionHash?: `0x${string}`;
  poolIdentifier?: string;
};

export type MarketPriceHistory = Record<string, ObservedPrice[]>;

const historyKey = "eqlty.robinhood-price-history.v1";
const maxPoints = 36;
const maxAgeMs = 24 * 60 * 60 * 1_000;

export function useMarketCatalog() {
  const [catalog, setCatalog] = useState<StockCatalog>();
  const [history, setHistory] = useState<MarketPriceHistory>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [seriesState, setSeriesState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [request, setRequest] = useState(0);

  useEffect(() => {
    setHistory(readHistory());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading((current) => current || !catalog);
    setError(undefined);

    const load = async () => {
      try {
        const nextCatalog = await loadStockCatalog(
          request > 0,
          controller.signal,
        );
        setCatalog(nextCatalog);
        setHistory((current) => {
          const next = recordPrices(current, nextCatalog);
          writeHistory(next);
          return next;
        });
        const tickers = nextCatalog.assets
          .filter((asset) => asset.uniswapRoutable)
          .map((asset) => asset.ticker);
        if (tickers.length > 0) {
          setSeriesState("loading");
          try {
            const series = await loadStockSeries(
              tickers,
              controller.signal,
            );
            setHistory((current) => {
              const next = mergeGraphSeries(current, series);
              writeHistory(next);
              return next;
            });
            setSeriesState("ready");
          } catch {
            if (!controller.signal.aborted) {
              setSeriesState("unavailable");
            }
          }
        }
      } catch (cause: unknown) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : "Market data unavailable",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };
    void load();

    return () => controller.abort();
  }, [request]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden) {
        setRequest((current) => current + 1);
      }
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const refresh = useCallback(() => {
    setRequest((current) => current + 1);
  }, []);

  return { catalog, history, loading, error, refresh, seriesState };
}

function recordPrices(
  current: MarketPriceHistory,
  catalog: StockCatalog,
): MarketPriceHistory {
  const cutoff = Date.now() - maxAgeMs;
  const next: MarketPriceHistory = {};

  for (const asset of catalog.assets) {
    const existing = (current[asset.ticker] ?? []).filter(
      (point) => Date.parse(point.at) >= cutoff,
    );
    const value = asset.referencePrice;
    const at = asset.referenceUpdatedAt;
    if (
      value !== undefined &&
      Number.isFinite(value) &&
      value > 0 &&
      at &&
      Number.isFinite(Date.parse(at)) &&
      !existing.some((point) => point.at === at)
    ) {
      existing.push({ at, value, source: "robinhood-price-api" });
    }
    if (existing.length > 0) {
      next[asset.ticker] = existing
        .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
        .slice(-maxPoints);
    }
  }

  return next;
}

function mergeGraphSeries(
  current: MarketPriceHistory,
  response: MarketSeriesResponse,
): MarketPriceHistory {
  const next = { ...current };
  for (const entry of response.series) {
    const observed = [
      ...(next[entry.ticker] ?? []),
      ...entry.points.map((point) => ({
        at: point.at,
        value: point.price,
        source: "the-graph-substreams" as const,
        blockNumber: point.blockNumber,
        transactionHash: point.transactionHash,
        poolIdentifier: point.poolIdentifier,
      })),
    ];
    const unique = new Map(
      observed.map((point) => [
        `${point.at}:${point.transactionHash ?? point.source ?? "quote"}`,
        point,
      ]),
    );
    next[entry.ticker] = [...unique.values()]
      .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
      .slice(-maxPoints);
  }
  return next;
}

function readHistory(): MarketPriceHistory {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(historyKey) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const cutoff = Date.now() - maxAgeMs;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([ticker, value]) => {
        if (!Array.isArray(value) || !/^[A-Z][A-Z0-9.-]{0,11}$/.test(ticker)) {
          return [];
        }
        const points = value
          .filter(isObservedPrice)
          .filter((point) => Date.parse(point.at) >= cutoff)
          .slice(-maxPoints);
        return points.length > 0 ? [[ticker, points]] : [];
      }),
    );
  } catch {
    return {};
  }
}

function writeHistory(history: MarketPriceHistory): void {
  try {
    localStorage.setItem(historyKey, JSON.stringify(history));
  } catch {
    // Market data remains available when browser storage is disabled.
  }
}

function isObservedPrice(value: unknown): value is ObservedPrice {
  if (!value || typeof value !== "object") {
    return false;
  }
  const point = value as Partial<ObservedPrice>;
  return (
    typeof point.at === "string" &&
    Number.isFinite(Date.parse(point.at)) &&
    typeof point.value === "number" &&
    Number.isFinite(point.value) &&
    point.value > 0
  );
}
