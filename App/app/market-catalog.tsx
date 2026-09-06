"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { relativeTime } from "../lib/market-format";
import { GraphHealthPanel } from "./graph-health-panel";
import { MarketCard } from "./market-card";
import { useMarketCatalog } from "./use-market-catalog";

const featuredLimit = 18;
const autoplayMs = 5_000;

export function MarketCatalog() {
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
  const track = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  const featuredAssets = useMemo(
    () =>
      (catalog?.assets ?? [])
        .filter((asset) => asset.uniswapRoutable)
        .slice(0, featuredLimit),
    [catalog],
  );

  useEffect(() => {
    if (
      paused ||
      featuredAssets.length < 2 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const interval = window.setInterval(() => {
      if (!document.hidden) {
        moveCarousel(track.current, 1);
      }
    }, autoplayMs);
    return () => window.clearInterval(interval);
  }, [featuredAssets.length, paused]);

  return (
    <section className="marketCatalog">
      <header className="marketHeading">
        <div>
          <span className="eyebrow">Live market universe</span>
          <h2>Stock Tokens</h2>
          <p>
            Real Uniswap 1D market curves, live market coverage and{" "}
            {seriesState === "ready"
              ? "live onchain evidence"
              : graphIntegration?.status === "degraded"
                ? "fail-closed onchain evidence"
                : "verifiable execution evidence"}.
          </p>
        </div>
        <div className="marketHeadingActions">
          {catalog ? (
            <div className="marketSummary">
              <span>
                <b>{catalog.summary.total}</b>
                stocks
              </span>
              <span>
                <b>{catalog.summary.routed}</b>
                Uniswap markets
              </span>
              <span>
                <b>{catalog.summary.orchestrationReady}</b>
                decision ready
              </span>
            </div>
          ) : (
            <span className="marketLoading">
              {loading ? "Discovering markets" : "No market snapshot"}
            </span>
          )}
          <Link className="marketViewAll" href="/markets">
            View all
            <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

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

      <GraphHealthPanel
        compact
        health={graphIntegration}
        onRefresh={refresh}
      />

      <div
        className="marketCarousel"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setPaused(false);
          }
        }}
        onFocus={() => setPaused(true)}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onPointerCancel={() => setPaused(false)}
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
      >
        <button
          aria-label="Previous stock tokens"
          className="carouselControl previous"
          disabled={featuredAssets.length < 2}
          onClick={() => moveCarousel(track.current, -1)}
          type="button"
        >
          ‹
        </button>
        <div
          aria-label="Featured Robinhood stock tokens"
          aria-live="off"
          className="marketTrack"
          ref={track}
        >
          {loading &&
            Array.from({ length: 4 }).map((_, index) => (
              <div className="marketCardSkeleton" key={index} />
            ))}
          {!loading &&
            featuredAssets.map((asset) => (
              <MarketCard
                asset={asset}
                graphHistory={graphHistory[asset.ticker]}
                history={history[asset.ticker]}
                key={asset.ticker}
              />
            ))}
          {!loading && !error && featuredAssets.length === 0 && (
            <div className="marketEmpty">
              No Robinhood stock-token markets are currently observed by Uniswap.
            </div>
          )}
        </div>
        <button
          aria-label="Next stock tokens"
          className="carouselControl next"
          disabled={featuredAssets.length < 2}
          onClick={() => moveCarousel(track.current, 1)}
          type="button"
        >
          ›
        </button>
      </div>

      <footer className="marketCatalogFooter">
        <span>
          <i className={paused ? "paused" : ""} />
          {paused ? "Auto-scroll paused" : "Advances every 5 seconds"}
        </span>
        {catalog && <small>Observed {relativeTime(catalog.observedAt)}</small>}
        <small>
          1D history{" "}
          {historyState === "ready"
            ? "live"
            : historyState === "loading"
              ? "loading"
              : "unavailable"}
        </small>
        <small>
          Onchain evidence{" "}
          {graphIntegration?.status === "degraded"
            ? "degraded"
            : seriesState === "ready"
              ? "live"
              : "connecting"}
        </small>
      </footer>
    </section>
  );
}

function moveCarousel(track: HTMLDivElement | null, direction: -1 | 1): void {
  if (!track) {
    return;
  }
  const card = track.querySelector<HTMLElement>(".marketCard");
  const amount = (card?.offsetWidth ?? track.clientWidth * 0.82) + 14;
  const maximum = Math.max(0, track.scrollWidth - track.clientWidth);

  if (direction === 1 && track.scrollLeft + amount >= maximum - 8) {
    track.scrollTo({ behavior: "smooth", left: 0 });
    return;
  }
  if (direction === -1 && track.scrollLeft <= 8) {
    track.scrollTo({ behavior: "smooth", left: maximum });
    return;
  }
  track.scrollBy({ behavior: "smooth", left: amount * direction });
}
