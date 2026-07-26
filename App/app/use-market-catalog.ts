"use client";

import { useCallback, useEffect, useState } from "react";
import { loadStockCatalog } from "../lib/market-api";
import type { StockCatalog } from "../lib/market-types";

export type ObservedPrice = {
  at: string;
  value: number;
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
  const [request, setRequest] = useState(0);

  useEffect(() => {
    setHistory(readHistory());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading((current) => current || !catalog);
    setError(undefined);

    loadStockCatalog(request > 0, controller.signal)
      .then((nextCatalog) => {
        setCatalog(nextCatalog);
        setHistory((current) => {
          const next = recordPrices(current, nextCatalog);
          writeHistory(next);
          return next;
        });
      })
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

  return { catalog, history, loading, error, refresh };
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
      existing.push({ at, value });
    }
    if (existing.length > 0) {
      next[asset.ticker] = existing
        .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
        .slice(-maxPoints);
    }
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
