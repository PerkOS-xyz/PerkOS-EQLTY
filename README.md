# EQLTY

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

The fleet uses PerkOS infrastructure for managed Hermes runtimes. Each runtime
can receive independent 1Claw security controls appropriate to its role.

## Sponsor integrations

The product focuses on three sponsor integrations:

- **Uniswap** provides stock token discovery, quotes and guarded execution.
- **The Graph** provides Substreams based evidence for market and transaction
  activity.
- **ENS** provides the public behavior and policy records used by the fleet.

## Repository map

```text
App/        User experience and wallet access
API/        Market, fleet and orchestration services
Contracts/  Onchain execution controls
Plugins/    Agent capabilities for sponsor integrations
docs/       Product and development documentation
```

The repository is being developed in small reviewable milestones. See
[the development plan](docs/PLAN.md) for the current direction.

## Security

Local environment files, credentials, private keys and deployment records are
excluded from version control. Examples may document variable names, but must
never contain live values.

Smart contracts and automated trading components are experimental software.
They should not be treated as financial advice or used with funds that cannot
be lost.
