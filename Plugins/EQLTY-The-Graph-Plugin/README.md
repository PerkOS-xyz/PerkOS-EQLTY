# EQLTY The Graph Plugin

Reusable Hermes and OpenClaw tooling that turns a Robinhood Stock Token ticker
into machine-readable Uniswap V4 evidence through The Graph Substreams.

The plugin includes:

- a read-only agent skill;
- a deterministic evidence CLI;
- a ticker-to-pool registry;
- a parameterized Substreams package;
- the Rust and protobuf source used to build that package.

## Commands

```bash
node skills/robinhood-stock-substreams/scripts/stock-substreams.mjs catalog
node skills/robinhood-stock-substreams/scripts/stock-substreams.mjs pool AMZN
node skills/robinhood-stock-substreams/scripts/stock-substreams.mjs snapshot AMZN
```

Direct streaming uses the bundled package:

```bash
node skills/robinhood-stock-substreams/scripts/stock-substreams.mjs \
  stream AMZN --start -500 --blocks 500
```

Set `EQLTY_AGENT_API_URL` when the API is not running at
`http://localhost:4021`. Normalized snapshots require
`EQLTY_SESSION_COOKIE`. Direct streaming requires the `substreams` CLI and
`SUBSTREAMS_API_TOKEN`; neither secret is printed or stored by the plugin.

## Build the package

```bash
cd substreams
cargo build --target wasm32-unknown-unknown --release
substreams pack substreams.yaml
```
