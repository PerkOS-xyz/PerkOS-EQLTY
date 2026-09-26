# Uniswap Developer Feedback

## Integration used

EQLTY uses the Uniswap Trading API with a developer API key for live token
discovery, quotes limited to Uniswap v4 pools and the swap calldata built from
them on Robinhood Chain (`4663`). The application preserves the returned
calldata and submits it only after its independent policy and evidence gates
pass. Every Trading API request also carries the `X-Agent-Info` header with a
`decision_origin` set by the calling code path (`human_mediated` when a person
starts and approves the action, `autonomous` for the read-only quote the desk
agents request). The agent quote endpoint returns the gateway's
`x-agent-info-status` value with each answer.

Desk agents can also ask EQLTY for the swap an owner's own wallet sends once
the owner approves an order (`POST /api/agent/swap`, sent as
`human_mediated`). EQLTY holds no key for that wallet and signs nothing: it
returns the Universal Router calldata with the wallet's minimum output from
`aggregatedOutputs`, and when the quote carries `permitData` it answers with
the Permit2 allowance the wallet sets on chain before asking again.

## What worked well

- Robinhood Chain and tokenized stocks use the same API surface as other
  supported networks.
- Quote responses include routing and request identifiers for an agent audit
  trail.
- Recommendation and transaction construction remain separate steps.

## Friction encountered

- Token discovery, token status and quote execution require different sources
  to build a complete Stock Token universe.
- A successful route does not establish liquidity freshness or authorization,
  so EQLTY adds The Graph and ENS checks.
- CLASSIC and UniswapX routes have different submission lifecycles; EQLTY
  quotes with `protocols: ["V4"]` only, so v2, v3 and UniswapX routes are not
  considered yet.

## Suggested improvements

- Publish a Stock Token catalog endpoint with canonical symbols, addresses and
  tradability status.
- Include an explorer URL and normalized lifecycle in quote responses.
- Document Robinhood Stock Token examples with small USDG inputs and explicit
  token multipliers.
