# EQLTY

![EQLTY banner](Assets/banner.png)

EQLTY is an agent powered experience for discovering and buying tokenized
stocks on Robinhood Chain.

Users define an investment objective and a small fleet compares eligible
assets, checks policy and market evidence, prepares a guarded Uniswap trade,
and records a verifiable result. The product is designed for people who want
clear recommendations and bounded automation instead of a conventional
trading terminal.

## Product principles

- One goal should be easier to express than a complex order.
- Every agent should have a narrow responsibility.
- User policy should remain readable and independently verifiable.
- Automated execution should respect explicit spending and asset limits.
- Every recommendation and transaction should leave useful evidence.
- The mobile experience should be understandable without financial jargon.

## Agent fleet

EQLTY coordinates four specialized roles:

| Role | Responsibility |
|---|---|
| Scout | Discovers supported stock tokens and gathers market evidence |
| Risk | Checks policy, freshness, liquidity and execution limits |
| Trader | Prepares and executes an approved Uniswap trade |
| Auditor | Reconciles the decision with indexed transaction evidence |

The fleet uses PerkOS infrastructure for managed Hermes runtimes. The 1Claw
Platform API creates a user-owned execution agent and HSM wallet for Trader.
The other roles have no spending authority. Purchases of 3 USDG or more
require the Trader rail to be linked.

## Sponsor integrations

The product focuses on three sponsor integrations:

- **Uniswap** provides stock token discovery, quotes and guarded execution.
- **The Graph** provides Substreams based evidence for market and transaction
  activity.
- **ENS** provides the public behavior and policy records used by the fleet.

### How we use Uniswap

- [`uniswap-client.ts`](API/src/uniswap-client.ts#L22) requests V4 exact input
  quotes from the Uniswap Trading API on Robinhood Chain.
- [`stock-catalog.ts`](API/src/stock-catalog.ts#L90) combines each quote with a
  reference price to score route deviation per candidate.
- [`proof-run.ts`](API/src/proof-run.ts#L227) keeps the routing, quoted output
  and request id inside the four agent proof bundle.
- [`EQLTYVault.sol`](Contracts/src/EQLTYVault.sol#L214) executes the approved
  route with per trade, total spend, slippage and deadline limits.
- [`uniswap-agent.mjs`](Plugins/EQLTY-Uniswap-Plugin/skills/execute-stock-token-trade/scripts/uniswap-agent.mjs#L103)
  packages quote review and guarded execution as a reusable agent skill.

Together these pieces support two Uniswap capabilities that usually live in
separate products: agent driven trade execution, where every swap stays bound
to the exact Trading API quote and is enforced by the vault on chain, and
market intelligence, where official RWA series power the charts and reference
prices the fleet reasons over.

### How we use The Graph

- [`lib.rs`](Plugins/EQLTY-The-Graph-Plugin/substreams/src/lib.rs#L13) is the
  parameterized Rust Substreams module that filters Uniswap V4 stock token
  pool events on Robinhood Chain.
- [`graph-evidence.ts`](API/src/graph-evidence.ts#L7) accepts only strict
  `the-graph-substreams` provenance for market evidence.
- [`graph-evidence.ts`](API/src/graph-evidence.ts#L80) validates ticker,
  freshness and block lag before evidence reaches the Risk role.
- [`hermes-consultation.ts`](API/src/hermes-consultation.ts) sends the sealed
  candidate set to the user's live Scout and Risk runtimes over PerkOS A2A.
- [`hermes-consultation-verifier.ts`](API/src/hermes-consultation-verifier.ts)
  binds their selection and cited facts back to canonical Graph, Uniswap and
  ENS values before the recommendation can change.
- [`proof-run.ts`](API/src/proof-run.ts#L220) is the Graph risk gate inside
  the four agent proof.
- [`stock-substreams.mjs`](Plugins/EQLTY-The-Graph-Plugin/skills/robinhood-stock-substreams/scripts/stock-substreams.mjs)
  exposes the 94 pool catalog, snapshots and direct streaming as an agent
  tool.

The Graph does two jobs inside EQLTY. As a data source, Substreams provenance
is the load bearing input that the live agents reason over and that gates
every decision. As tooling, the Substreams package, the pool registry and the
agent skill are self contained and reusable by any project that needs
verifiable Uniswap V4 stock token evidence, with or without the rest of
EQLTY.

### How we use ENS

- [`ens-control-plane.ts`](API/src/ens-control-plane.ts#L37) resolves the
  owner, manifest and four role records that define fleet behavior.
- [`ens-policy.ts`](API/src/ens-policy.ts#L115) checks manifest expiry,
  version and settings hashes.
- [`durin-provisioner.ts`](API/src/durin-provisioner.ts#L49) provisions a
  Durin subname for each user fleet.
- [`ens-policy-preparation.ts`](API/src/ens-policy-preparation.ts#L67)
  prepares hash bound policy changes that wait for owner authorization.
- [`ens-fleet.mjs`](Plugins/EQLTY-ENS-Plugin/skills/ens-agent-fleet/scripts/ens-fleet.mjs#L93)
  is the reusable fleet directory and policy preset tool.

ENS plays three roles at once here: the public identity that makes each agent
independently discoverable and verifiable, the behavior control plane that
changes live agent reasoning without redeploying anything, and the mechanism
that lets an existing agent platform gain user auditable policy as a brand
new capability.

## Architecture

```mermaid
flowchart LR
  OWNER["Owner wallet<br/>Dynamic login"] --> APP["Next.js App<br/>catalog, goals, decision room,<br/>proof, portfolio, history"]
  APP --> API["EQLTY API<br/>market, fleet, policy,<br/>proof runs, audits"]

  subgraph FLEET["PerkOS managed Hermes fleet"]
    SCOUT[Scout]
    RISK[Risk]
    TRADER[Trader]
    AUDITOR[Auditor]
  end

  subgraph PROTOCOLS["Protocols"]
    ENS["ENS, Durin L2 records<br/>policy control plane"]
    UNI["Uniswap Trading API<br/>quotes, calldata, RWA series"]
    GRAPH["The Graph Substreams<br/>swap evidence, price series"]
    CLAW["1Claw<br/>HSM trader wallet, execution rail"]
  end

  subgraph CHAIN["Robinhood Chain"]
    VAULT["EQLTY Vault<br/>limits, nonces, risk signature"]
    ROUTER["Uniswap V4 router"]
  end

  API --> FLEET
  API --> ENS
  API --> UNI
  API --> GRAPH
  API --> CLAW
  ENS -. "policy injected into agent prompts" .-> FLEET
  API --> VAULT
  VAULT --> ROUTER
  OWNER -. "creates and funds strategies" .-> VAULT
```

| Technology | Role in EQLTY |
|---|---|
| Dynamic | Single wallet login and message signing for the owner session |
| PerkOS | Creates, locates and wakes the four managed Hermes runtimes |
| ENS (Durin L2) | Behavior source of truth: owner, manifest and per role policy records |
| Uniswap | Stock token discovery, V4 quotes, swap calldata and RWA market series |
| The Graph | Substreams evidence gating every decision and feeding price history |
| 1Claw | User claimed HSM trader wallet; only Trader has spending authority |
| Robinhood Chain | Stock token assets, receipts and the execution network |
| EQLTY Vault | Holds funds per strategy and only executes risk signed trades |

## How the app, protocols and agents interact

```mermaid
sequenceDiagram
  actor Owner
  participant App as Next.js App
  participant API as EQLTY API
  participant ENS as ENS Durin L2
  participant Fleet as Hermes fleet
  participant Uniswap as Uniswap APIs
  participant Graph as The Graph Substreams
  participant Vault as EQLTY Vault

  Owner->>App: Dynamic sign in and investment goal
  App->>API: Activate fleet
  API->>Fleet: Locate, create, provision or wake four agents
  API->>ENS: Resolve owner, manifest and role records

  loop Consultation cycle inside the two minute window
    API->>ENS: Re-read the policy manifest
    API->>Uniswap: Stock token quotes and RWA market series
    API->>Graph: Substreams evidence with block, liquidity and lag
    API->>Fleet: Scout prompt with goal, candidates and ENS policy
    Fleet-->>API: Scout recommendation, verified
    API->>Fleet: Risk prompt with evidence and ENS policy
    Fleet-->>API: Risk decision, verified against the manifest
    API-->>App: Decision room events and shortlist
  end

  Owner->>App: Review and approve the purchase
  App->>Vault: Create, approve and fund the strategy from the owner wallet
  App->>API: Execute within the strategy
  API->>API: Fail closed gates, see the decision workflow
  API->>Vault: Risk signed EIP-712 execution
  Vault->>Vault: Enforce limits, nonce and calldata hash
  Vault-->>API: Swap receipt
  API->>Graph: Auditor reconciles the indexed swap
  API-->>App: Stored audit bundle in History
```

## Decision workflow

Every proof run walks the same ordered gates. Any failed gate stops the run
with a readable reason; nothing downgrades silently.

```mermaid
flowchart TD
  START([Proof run requested]) --> S1{Strategy active and amount within limits?}
  S1 -- no --> REJECT([Rejected, fail closed])
  S1 -- yes --> S2{ENS policy active, ticker allowed, trade limit OK?}
  S2 -- no --> REJECT
  S2 -- yes --> S3{Robinhood asset and market data valid?}
  S3 -- no --> REJECT
  S3 -- yes --> S4{Graph evidence live and fresh?}
  S4 -- no --> REJECT
  S4 -- yes --> S5{Executable Uniswap V4 route?}
  S5 -- no --> REJECT
  S5 -- yes --> S6{Execution requested?}
  S6 -- no --> APPROVED([Approved, dry proof bundle])
  S6 -- yes --> S7{Three USDG or more?}
  S7 -- yes --> S8{Trader 1Claw rail linked?}
  S8 -- no --> REJECT
  S7 -- no --> S9
  S8 -- yes --> S9{Strategy allows full execution?}
  S9 -- no --> REJECT
  S9 -- yes --> S10{Payment authorization live?}
  S10 -- no --> REJECT
  S10 -- yes --> S11{Vault executor configured?}
  S11 -- no --> REJECT
  S11 -- yes --> EXEC[Risk signs and the vault executes the guarded swap]
  EXEC --> AUDIT([Auditor stores the reconciled audit bundle])
```

## Screenshots

| Stock Token catalog | Mobile experience | Wallet access |
|---|---|---|
| ![Stock Token catalog](Assets/Screenshot01.png) | ![Mobile experience](Assets/Screenshot02.png) | ![Wallet access with Dynamic](Assets/Screenshot03.png) |

## Repository map

```text
App/        User experience and wallet access
API/        Market, fleet and orchestration services
Contracts/  Onchain execution controls
Plugins/    Agent capabilities for sponsor integrations
docs/       Product and development documentation
```

The repository is being developed in small reviewable milestones. See
[the development plan](docs/PLAN.md) for the current direction,
[the integration map](docs/INTEGRATIONS.md) for implementation evidence and
[the demo guide](docs/DEMO.md) for the presentation flow.

## Local development

Install JavaScript dependencies from the repository root:

```bash
pnpm install
```

Run the app and API in separate terminals with `pnpm dev:app` and
`pnpm dev:api`. Use `pnpm check` for the shared type, format, build and test
gates. Foundry must be installed for contract checks.

## Security

Local environment files, credentials, private keys and deployment records are
excluded from version control. Examples may document variable names, but must
never contain live values.

Smart contracts and automated trading components are experimental software.
They should not be treated as financial advice or used with funds that cannot
be lost.
