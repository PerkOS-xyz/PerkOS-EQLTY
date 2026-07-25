# Stock Substreams evidence schema

The `snapshot` command emits `urn:eqlty:stock-substreams-agent:v1`.

| Field | Meaning |
| --- | --- |
| `ticker` | Normalized Robinhood Stock Token symbol |
| `chainId` | CAIP-2 Robinhood Mainnet identifier |
| `market.protocol` | Indexed Uniswap pool version |
| `market.lastSwapPrice` | Price derived from the indexed Swap |
| `market.liquidityUsd` | Virtual liquidity at the indexed state |
| `evidence.blockNumber` | Canonical block processed by Substreams |
| `evidence.transactionHash` | Transaction containing the indexed event |
| `evidence.poolIdentifier` | V4 pool ID or V3 pool address |
| `evidence.capturedAt` | Canonical block timestamp |
| `stream.provider` | The Graph Market provider |
| `stream.processedBlock` | Last block processed by the sink |
| `stream.providerHeadBlock` | Observed Robinhood Chain head |
| `stream.lagBlocks` | Provider or sink lag |
| `health.healthy` | Independent fail-closed result |
| `health.reasons` | Explicit failures for agent reasoning |

The CLI recomputes heartbeat age, swap age and block lag instead of trusting
only the adapter's health flag.

Default bounds:

- provider heartbeat: 3,600 seconds;
- latest swap: 86,400 seconds;
- provider lag: 20 blocks.

Override thresholds only when the active policy explicitly requires it:

```bash
node "{baseDir}/scripts/stock-substreams.mjs" snapshot NVDA \
  --max-heartbeat 120 --max-swap-age 3600 --max-lag 5
```

The bundled pool registry uses
`urn:eqlty:robinhood-stock-v4-pools:v1`. It records observed discovery and is
not an oracle or allowlist.
