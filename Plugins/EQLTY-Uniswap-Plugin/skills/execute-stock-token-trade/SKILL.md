---
name: execute-stock-token-trade
description: Discover, quote and execute guarded Robinhood Stock Token swaps through the Uniswap API. Use when an agent needs live route evidence, a dry-run recommendation, or an explicitly authorized purchase on Robinhood Chain.
---

# Execute Stock Token Trade

## Procedure

1. Resolve the ticker from the live catalog:

   ```bash
   node "{baseDir}/scripts/uniswap-agent.mjs" catalog AMZN
   ```

2. Run a dry evaluation before requesting execution:

   ```bash
   node "{baseDir}/scripts/uniswap-agent.mjs" run <strategy-id> <atomic-usdg>
   ```

3. Require passed steps for strategy limits, the current ENS fleet policy,
   The Graph risk evidence, the Uniswap quote and the fleet spending rails.
4. Inspect each evidence mode. Do not submit a transaction when any required
   execution input is in preview mode.
5. Verify Robinhood Chain `4663`, the configured token pair and the exact
   Uniswap router before approving calldata.
6. Execute only after the user requests a live purchase and every adapter is
   live:

   ```bash
   node "{baseDir}/scripts/uniswap-agent.mjs" \
     run <strategy-id> <atomic-usdg> --execute --confirm=ROBINHOOD_MAINNET
   ```

7. Return the run ID, Uniswap request ID, status and transaction explorer URL.
   If blocked, return the exact failed gate without loosening the policy.

Read [execution-gates.md](references/execution-gates.md) before live submission.

## Guardrails

- Do not use the Robinhood brokerage MCP as a Robinhood Chain executor.
- Do not modify calldata returned by the Uniswap API.
- Do not bypass the EQLTY Vault with a direct wallet transaction.
- Do not replace an unavailable ticker with a different asset.
- Do not reuse a stale ENS policy or ignore a paused fleet.
- Do not describe an approved dry run as a transaction.

## Verification

For live execution, require `status: executed`, a passed live `execute` step and
a non-empty transaction hash. For a dry run, report `status: approved` and state
that no transaction was sent.
