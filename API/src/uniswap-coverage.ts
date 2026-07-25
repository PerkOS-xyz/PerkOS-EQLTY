export const UNISWAP_V4_COVERAGE_OBSERVED_AT =
  "2026-07-25T03:51:45.000Z";

export const UNISWAP_V4_UNAVAILABLE_TICKERS = new Set([
  "CRWD",
  "SATS",
]);

export function hasObservedV4Route(ticker: string): boolean {
  return !UNISWAP_V4_UNAVAILABLE_TICKERS.has(
    ticker.trim().toUpperCase(),
  );
}
