"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadStockHistory,
  loadStockCatalog,
  loadStockSeries,
  type MarketDaySeriesEntry,
  type MarketSeriesResponse,
} from "../lib/market-api";
import type { StockCatalog } from "../lib/market-types";

export type ObservedPrice = {
  at: string;
  value: number;
  source?: "uniswap-rwa-1d" | "the-graph-substreams";
  blockNumber?: string;
  transactionHash?: `0x${string}`;
  poolIdentifier?: string;
};

export type MarketPriceHistory = Record<string, ObservedPrice[]>;
export type MarketDayHistory = Record<string, MarketDaySeriesEntry>;

const maxPoints = 36;

export function useMarketCatalog() {
  const [catalog, setCatalog] = useState<StockCatalog>();
  const [history, setHistory] = useState<MarketDayHistory>({});
  const [graphHistory, setGraphHistory] = useState<MarketPriceHistory>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [historyState, setHistoryState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [seriesState, setSeriesState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [request, setRequest] = useState(0);

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
        setLoading(false);
        const tickers = nextCatalog.assets
          .filter((asset) => asset.uniswapRoutable)
          .map((asset) => asset.ticker);
        if (tickers.length > 0) {
          setHistoryState("loading");
          setSeriesState("loading");
          const [dayResult, graphResult] = await Promise.allSettled([
            loadStockHistory(tickers, controller.signal),
            loadStockSeries(tickers, controller.signal),
          ]);
          if (dayResult.status === "fulfilled") {
            setHistory(
              Object.fromEntries(
                dayResult.value.series.map((entry) => [entry.ticker, entry]),
              ),
            );
            setHistoryState("ready");
          } else if (!controller.signal.aborted) {
            setHistoryState("unavailable");
          }
          if (graphResult.status === "fulfilled") {
            setGraphHistory(mergeGraphSeries(graphResult.value));
            setSeriesState("ready");
          } else if (!controller.signal.aborted) {
            setSeriesState("unavailable");
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

  return {
    catalog,
    history,
    graphHistory,
    loading,
    error,
    refresh,
    historyState,
    seriesState,
  };
}

function mergeGraphSeries(
  response: MarketSeriesResponse,
): MarketPriceHistory {
  const next: MarketPriceHistory = {};
  for (const entry of response.series) {
    next[entry.ticker] = entry.points
      .map((point) => ({
        at: point.at,
        value: point.price,
        source: "the-graph-substreams" as const,
        blockNumber: point.blockNumber,
        transactionHash: point.transactionHash,
        poolIdentifier: point.poolIdentifier,
      }))
      .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
      .slice(-maxPoints);
  }
  return next;
}
