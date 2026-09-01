# EQLTY Uniswap Plugin

Reusable Hermes and OpenClaw tooling for Robinhood Stock Token discovery,
Uniswap API quotes and guarded execution on Robinhood Chain.

## What it proves

- The Stock Token universe is discovered from live Robinhood and Uniswap data.
- Market observation and executable V4 quote verification are separate states.
- Quote routing and calldata originate from the Uniswap API.
- ENS policy, The Graph evidence and 1Claw controls gate execution.
- A dry run never claims funds moved.
- A successful live run returns a transaction hash and explorer URL.

## Commands

```bash
node skills/execute-stock-token-trade/scripts/uniswap-agent.mjs catalog AMZN
node skills/execute-stock-token-trade/scripts/uniswap-agent.mjs run <strategy-id> 1000000
```

Live submission requires an explicit confirmation:

```bash
node skills/execute-stock-token-trade/scripts/uniswap-agent.mjs \
  run <strategy-id> 1000000 --execute --confirm=ROBINHOOD_MAINNET
```

Set `EQLTY_AGENT_API_URL` when the API is not running at
`http://localhost:4021`. Authenticated commands also require
`EQLTY_SESSION_COOKIE`; never commit or print that value.

See [Uniswap feedback](./UNISWAP_FEEDBACK.md) for integration notes.
