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
  app/proof-run-panel.tsx           Four-agent proof and transaction receipt
API/
  src/stock-catalog.ts              Robinhood, Uniswap and Graph composition
  src/uniswap-client.ts             Uniswap Trading API quotes
  src/graph-evidence.ts             Substreams provenance and freshness
  src/ens-control-plane.ts          ENS policy resolution
  src/ens-policy-preparation.ts     Hash-bound settings changes
  src/perkos-fleet.ts               Hermes provisioning and wake-up
  src/autonomous-goals.ts           Repeated fleet evaluation
  src/proof-run.ts                  Ordered execution gates and proof bundle
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
| Quote, reference price and route comparison | `API/src/stock-catalog.ts:80-161` |
| Quote handoff from Trader to Auditor | `API/src/proof-run.ts:220-248` |
| Reusable Hermes and OpenClaw commands | `Plugins/EQLTY-Uniswap-Plugin/skills/execute-stock-token-trade/scripts/uniswap-agent.mjs:48-145` |

The API keeps the Uniswap request ID and quoted output in the proof run. A dry
run is never described as an executed swap.

### The Graph

| Evidence | Location |
|---|---|
| Strict Substreams evidence and provider schema | `API/src/graph-evidence.ts:7-46` |
| Freshness, lag and ticker validation | `API/src/graph-evidence.ts:78-151` |
| Graph risk handoff and transaction evidence | `API/src/proof-run.ts:187-218` |
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
| Reusable fleet directory and preset tool | `Plugins/EQLTY-ENS-Plugin/skills/ens-agent-fleet/scripts/ens-fleet.mjs:93-242` |

ENS is the behavior source of truth. Policy preparation produces the next
manifest and role hashes but does not publish them before owner-wallet and
World authorization.

## Supporting infrastructure

| Technology | Responsibility | Location |
|---|---|---|
| Robinhood Chain | Stock Token assets, prices, chain IDs and receipts | `API/src/stock-catalog.ts:20-22`, `App/app/wallet-networks.ts`, `App/lib/execution-api.ts` |
| PerkOS | Create, locate and wake managed Hermes agents | `API/src/perkos-fleet.ts:36-223` |
| 1Claw | Report per-agent security links and block execution until all four are linked | `API/src/perkos-fleet.ts:124-166`, `API/src/autonomous-goals.ts:38-69` |
| Dynamic | Single user wallet modal and message signing | `App/app/dynamic-wallet-provider.tsx:15-84` |
| EQLTY Vault | Limits, nonce protection, risk signature and router call | `Contracts/src/EQLTYVault.sol:214-289` |

## Current readiness boundary

The following path is implemented and testable now:

1. wallet authentication;
2. fleet locate, provision or wake;
3. ENS policy resolution;
4. Robinhood Stock Token discovery;
5. Uniswap quote and The Graph evidence;
6. repeated two-minute recommendation;
7. four-agent proof bundle with a dry execution decision.

Live purchase submission remains fail-closed until all of these are connected:

- production 1Claw links for every role;
- live x401 and x402 authorization;
- the vault-backed `TradeExecutor`;
- deployed contract addresses and funded strategy;
- World Selfie authorization for ENS settings publication.

`API/src/proof-run.ts:250-267` enforces this boundary. A live demo must show
`status: executed` and a transaction hash before claiming funds moved.
