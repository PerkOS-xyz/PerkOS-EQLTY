# Uniswap Developer Feedback

## Integration used

EQLTY uses the Uniswap Trading API with a developer API key for live token
discovery, quotes and CLASSIC swap calldata on Robinhood Chain (`4663`). The
application preserves the returned calldata and submits it only after its
independent policy and evidence gates pass.

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
- CLASSIC and UniswapX routes have different submission lifecycles; this plugin
  supports the CLASSIC path first.

## Suggested improvements

- Publish a Stock Token catalog endpoint with canonical symbols, addresses and
  tradability status.
- Include an explorer URL and normalized lifecycle in quote responses.
- Document Robinhood Stock Token examples with small USDG inputs and explicit
  token multipliers.
