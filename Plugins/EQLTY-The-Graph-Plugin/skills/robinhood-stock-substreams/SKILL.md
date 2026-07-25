---
name: robinhood-stock-substreams
description: Query and stream live Robinhood Stock Token Uniswap V4 evidence through The Graph Substreams. Use when an agent must resolve a ticker to an observed pool, check provider freshness and swap evidence, enforce a market-data risk gate, or cite a Robinhood Chain transaction before recommending a trade.
---

# Robinhood Stock Substreams

## Procedure

1. Resolve the requested ticker against the observed pool registry:

   ```bash
   node "{baseDir}/scripts/stock-substreams.mjs" pool AMZN
   ```

2. Request normalized evidence through the authenticated EQLTY adapter:

   ```bash
   node "{baseDir}/scripts/stock-substreams.mjs" snapshot AMZN
   ```

3. Require `health.healthy: true`. Treat a stale heartbeat, stale swap,
   excessive block lag or ticker mismatch as a hard failure.
4. Cite the block number, transaction hash, pool identifier, block timestamp,
   provider and package in the result.
5. Use direct streaming when raw provider evidence is required:

   ```bash
   node "{baseDir}/scripts/stock-substreams.mjs" \
     stream AMZN --start -500 --blocks 500
   ```

6. Keep the evidence separate from authorization. A healthy snapshot supports a
   recommendation but does not permit a trade.

Read [schema.md](references/schema.md) before integrating the output.

## Commands

```bash
node "{baseDir}/scripts/stock-substreams.mjs" catalog
node "{baseDir}/scripts/stock-substreams.mjs" pool NVDA
node "{baseDir}/scripts/stock-substreams.mjs" snapshot NVDA \
  --max-heartbeat 120 --max-swap-age 3600 --max-lag 5
```

The `stream` command requires `substreams` and `SUBSTREAMS_API_TOKEN`. It binds
the selected ticker and V4 pool to the packaged `map_pool_events` parameter.

## Guardrails

- Do not print `SUBSTREAMS_API_TOKEN` or `EQLTY_SESSION_COOKIE`.
- Do not silently relax freshness or lag thresholds.
- Do not call cached, mocked or RPC-only data The Graph evidence.
- Do not treat registry presence as proof of current liquidity.
- Do not authorize a purchase from evidence alone.
