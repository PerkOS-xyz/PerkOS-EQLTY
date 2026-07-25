# EQLTY Robinhood Stock Token Substreams

This parameterized module filters Uniswap V4 Stock Token pools on Robinhood
Chain through The Graph Market.

Bind each pool ID to a ticker:

```text
v3=;v4=<pool-manager>:<pool-id>=<ticker>
```

`map_pool_events` preserves the canonical block number and timestamp, log
address, topics, transaction hash, raw data, ticker and pool identifier.

Build and package:

```bash
cargo build --target wasm32-unknown-unknown --release
substreams pack substreams.yaml
```

Raw RPC reads must not be described as The Graph evidence.
