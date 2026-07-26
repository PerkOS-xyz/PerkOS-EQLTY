# Developer feedback

Feedback from building EQLTY at ETHGlobal Lisbon 2026. Each section covers one
partner technology used in the product.

## Uniswap

EQLTY uses the Uniswap Trading API with a developer API key for stock token
discovery, V4 exact input quotes and CLASSIC swap calldata on Robinhood Chain
(chain id 4663). Full notes:
[UNISWAP_FEEDBACK.md](Plugins/EQLTY-Uniswap-Plugin/UNISWAP_FEEDBACK.md).

What worked well:

- Robinhood Chain and tokenized stocks use the same API surface as other
  supported networks.
- Quote responses include routing and request identifiers that fit an agent
  audit trail.
- Recommendation and transaction construction remain separate steps.

Friction and suggestions:

- Token discovery, token status and quote execution require different sources
  to build a complete stock token universe; a stock token catalog endpoint
  with canonical symbols, addresses and tradability status would help.
- An explorer URL and a normalized lifecycle in quote responses would remove
  guesswork.
- Documented Robinhood stock token examples with small USDG inputs and
  explicit token multipliers would shorten the first integration.

## The Graph

EQLTY built a parameterized Substreams package in Rust that filters Uniswap V4
stock token pool events on Robinhood Chain, with 94 pools bound to tickers.
The Risk agent treats Substreams provenance as load bearing: freshness, block
lag and canonical transaction hashes gate every recommendation, and the
markets page renders price series from the same evidence.

- Parameterized modules let us bind pools to tickers without redeploying the
  package. This pattern deserves first-class documentation.
- Writing a simple address and topic log filter still requires the full Rust
  and wasm toolchain; a hosted template for that common case would lower the
  barrier.
- The parameter binding syntax (`v4=<pool-manager>:<pool-id>=<ticker>`) was
  hard to discover from the docs.
- Clearer examples for streaming newer chains through The Graph Market would
  help the next team.

## ENS

ENS is the control plane of the agent fleet: each user gets a Durin L2
subname whose text records hold the owner, a hash bound manifest and per role
policy for the four agents. Editing a record changes agent behavior without
redeploying anything.

- Durin made per user L2 subnames practical; its documentation is sparse
  compared to core ENS.
- Writing several records means one `setText` call per key; guidance on
  batching would help.
- A lightweight convention for structured policy records (JSON manifests with
  versioning, expiry and hash binding) would make the control plane pattern
  much easier to reuse.
