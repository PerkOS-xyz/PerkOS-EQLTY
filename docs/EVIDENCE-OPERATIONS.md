# Onchain evidence operations

EQLTY requires fresh Uniswap V4 Swap evidence before an asset can advance to a
recommendation. The provider is selected server-side and is always identified
in the public health response and stored audit bundle.

## Direct Robinhood RPC

Direct RPC is the default MVP provider. It uses bounded `eth_getLogs` requests
for the exact pool ID in the versioned pool registry.

```text
EQLTY_EVIDENCE_PROVIDER=rpc
ROBINHOOD_MAINNET_RPC_URL=<server secret>
EQLTY_RPC_EVIDENCE_LOOKBACK_BLOCKS=5000
EQLTY_RPC_EVIDENCE_BLOCK_RANGE=1000
EQLTY_RPC_EVIDENCE_CACHE_SECONDS=30
```

The URL remains server-only. Public responses expose only the provider
hostname, event transaction, block, pool ID and freshness result.

## The Graph Substreams

The hosted adapter can be restored without changing the product workflow:

```text
EQLTY_EVIDENCE_PROVIDER=graph
GRAPH_RISK_URL=<adapter origin>
GRAPH_API_TOKEN=<server secret>
```

The adapter must pass the readiness gates in
[`GRAPH-OPERATIONS.md`](GRAPH-OPERATIONS.md) before recommendations resume.

## Verification

```bash
curl -sS https://eqlty-api.perkos.xyz/api/config \
  | jq '.integrationHealth.marketEvidence'
```

A ready result identifies either `robinhood-rpc` or
`the-graph-substreams`. Missing configuration, stale events and malformed
provenance fail closed; the API never silently switches providers.
