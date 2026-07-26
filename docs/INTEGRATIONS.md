# Integration map

This map shows where each external technology contributes to the EQLTY
workflow. Paths and symbols are intended as quick entry points for reviewers.

## Runtime flow

```text
Dynamic wallet
  -> authenticated EQLTY session
  -> PerkOS Hermes fleet activation
  -> ENS policy resolved for the owner
  -> Robinhood Stock Token universe
  -> Uniswap V4 quote + The Graph evidence
  -> Scout -> Risk -> Trader -> Auditor proof
  -> EQLTY Vault execution when every live gate is configured
```

## Repository tree

```text
App/
  app/dynamic-wallet-provider.tsx   Dynamic wallet connection
  app/market-catalog.tsx            Stock Token universe and route status
  app/fleet-panel.tsx               Hermes lifecycle and 1Claw state
  app/goal-analyzer.tsx             Two-minute autonomous workflow
  app/proof-run-panel.tsx           Four-agent proof and verification logs
  app/history/[transactionHash]/    Stored purchase evidence for judges
API/
  src/stock-catalog.ts              Robinhood, Uniswap and Graph composition
  src/uniswap-client.ts             Uniswap Trading API quotes
  src/graph-evidence.ts             Substreams provenance and freshness
  src/ens-control-plane.ts          ENS policy resolution
  src/ens-policy-preparation.ts     Hash-bound settings changes
  src/perkos-fleet.ts               Hermes provisioning and wake-up
  src/autonomous-goals.ts           Repeated fleet evaluation
  src/proof-run.ts                  Ordered execution gates and proof bundle
  src/purchase-audit.ts             Receipt, pool and transfer reconciliation
  src/firestore-audit.ts            Wallet-scoped immutable audit storage
Contracts/
  src/EQLTYVault.sol                Guarded Stock Token execution
Plugins/
  EQLTY-Uniswap-Plugin/             Quote and execution agent skill
  EQLTY-The-Graph-Plugin/           Stock Token Substreams package and skill
  EQLTY-ENS-Plugin/                 Fleet identity and policy skill
```

## Sponsor proof

### Uniswap

| Evidence | Location |
|---|---|
| V4-only exact-input quote request on Robinhood Chain | `API/src/uniswap-client.ts:22-68` |
| Official 1D RWA market series | `API/src/uniswap-rwa-market.ts` |
| Real timestamp-based stock curves | `App/app/market-card.tsx` |
| Quote, reference price and route comparison | `API/src/stock-catalog.ts:80-161` |
| Quote handoff from Trader to Auditor | `API/src/proof-run.ts:227-255` |
| Executed PoolManager, poolId and receipt | `API/src/purchase-audit.ts` |
| Judge-facing purchase evidence | `App/app/history/[transactionHash]/page.tsx` |
| Reusable Hermes and OpenClaw commands | `Plugins/EQLTY-Uniswap-Plugin/skills/execute-stock-token-trade/scripts/uniswap-agent.mjs:48-145` |

The API keeps the Uniswap request ID and quoted output in the proof run. A dry
run is never described as an executed swap. The 1D chart uses Uniswap RWA
sparkline points; Substreams swaps remain separate execution evidence.

### The Graph

| Evidence | Location |
|---|---|
| Strict Substreams evidence and provider schema | `API/src/graph-evidence.ts:7-46` |
| Freshness, lag and ticker validation | `API/src/graph-evidence.ts:80-153` |
| Live Hermes Scout and Risk A2A consultation | `API/src/hermes-consultation.ts` |
| Agent response and evidence verification | `API/src/hermes-consultation-verifier.ts` |
| Graph risk handoff and transaction evidence | `API/src/proof-run.ts:204-226` |
| Stored request, stream, package and checkpoint | `API/src/purchase-audit.ts` |
| Judge-facing Substreams call and response | `App/app/history/[transactionHash]/page.tsx` |
| Agent decision log with event and block links | `App/app/decision-room.tsx` |
| Robinhood Uniswap V4 event module | `Plugins/EQLTY-The-Graph-Plugin/substreams/src/lib.rs:1-56` |
| Parameterized 94-pool agent tool | `Plugins/EQLTY-The-Graph-Plugin/skills/robinhood-stock-substreams/scripts/stock-substreams.mjs` |

RPC-only or cached data is not labeled as The Graph evidence. The risk gate
requires live provider provenance, a canonical transaction hash and acceptable
freshness.

### ENS

| Evidence | Location |
|---|---|
| Owner, manifest and four role records resolved from Durin | `API/src/ens-control-plane.ts:25-132` |
| Manifest expiry, version and settings-hash checks | `API/src/ens-policy.ts:115-181` |
| Per-user fleet and subname provisioning | `API/src/durin-provisioner.ts:45-177` |
| Hash-bound policy preparation | `API/src/ens-policy-preparation.ts:47-145` |
| Policy handoff inside the agent decision room | `App/app/decision-room.tsx` |
| Reusable fleet directory and preset tool | `Plugins/EQLTY-ENS-Plugin/skills/ens-agent-fleet/scripts/ens-fleet.mjs:93-242` |

ENS is the behavior source of truth. Policy preparation produces the next
manifest and role hashes but does not publish them before owner-wallet and
World authorization.

The testnet UI opens names in the current ENSv2 app at `app.ens.dev`. EQLTY's
control plane still uses the deployed Durin L2 registry and does not claim that
those records have already migrated to ENSv2. The hierarchical registry and
per-name resolver model are tracked as the migration path:
https://docs.ens.domains/contracts/ensv2/overview/

## Supporting infrastructure

| Technology | Responsibility | Location |
|---|---|---|
| Robinhood Chain | Stock Token assets, prices, chain IDs and receipts | `API/src/stock-catalog.ts:20-22`, `App/app/wallet-networks.ts`, `App/lib/execution-api.ts` |
| PerkOS | Create, locate and wake managed Hermes agents | `API/src/perkos-fleet.ts:36-223` |
| 1Claw | Bootstrap and claim a user-owned Trader wallet with Platform API | `API/src/oneclaw-fleet.ts`, `API/src/oneclaw-policy.ts`, `App/app/fleet-panel.tsx` |
| Dynamic | Single user wallet modal and message signing | `App/app/dynamic-wallet-provider.tsx:15-84` |
| EQLTY Vault | Limits, nonce protection, risk signature and router call | `Contracts/src/EQLTYVault.sol:214-289` |
| PerkOS Firestore | Wallet-scoped audit bundle keyed by purchase hash | `API/src/firestore-audit.ts` |

## Purchase audit bundle

Every successful purchase writes one document at:

```text
wallets/{owner}/eqlty_audits/{transactionHash}
```

The document contains the wallet setup transactions, ENS manifest hash,
Substreams request and response, stream package and module, Uniswap quote
request, router, PoolManager, poolId, proof commitments, confirmed receipt and
decoded ERC-20 transfers. Authorization headers are represented as redacted
metadata and credential values are never stored.

The chain remains the source of truth for execution. Firestore preserves the
human-readable inputs needed to explain why the transaction was allowed.

## Current readiness boundary

The following path is implemented and testable now:

1. wallet authentication;
2. fleet locate, provision or wake;
3. ENS policy resolution;
4. Robinhood Stock Token discovery;
5. Uniswap quote and The Graph evidence;
6. repeated two-minute recommendation;
7. wallet-owned strategy creation and funding;
8. guarded Uniswap execution;
9. wallet-scoped audit bundle and historical evidence page.

The proof panel exposes the indexed Swap event, source block, PoolManager,
Substreams JSON and final purchase receipt when present. Explorer links are
kept separate from quote request IDs and offchain proof hashes.

Purchases of 3 USDG or more remain fail-closed until the Trader rail is linked.
EQLTY follows the Platform API user upsert, template bootstrap and claim flow.
The Ethereum signing key remains inside the user's 1Claw account, while the
one-time execution credential passes directly to PerkOS.

Robinhood EIP-712 restrictions remain disabled for the MVP. Transaction
guardrails still limit the trader to Robinhood Chain, the EQLTY vault, Uniswap
contracts, USDG and six transactions per day.

World Selfie authorization remains required for future ENS settings
publication, not for reading the current policy or demonstrating a 1 USDG
purchase.
