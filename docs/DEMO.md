# Three-minute demo

The strongest demo is a bounded autonomous decision, not a faster version of a
brokerage order form.

## Product story

EQLTY gives each user a persistent fleet of four agents. The user states an
objective once; the fleet repeatedly compares Robinhood Stock Tokens, follows
behavior stored in ENS, checks Uniswap routes and The Graph evidence, and stops
when any security boundary fails.

## Run of show

### 0:00 — The difference

Say:

> Robinhood and trading apps let me choose an asset. EQLTY lets me define an
> outcome and gives a bounded agent fleet two minutes to compare the market.

Show the Stock Token catalog, its multiple companies and the Ready, Review and
Blocked labels.

### 0:25 — One identity, four agents

Connect the funded wallet through the single Dynamic login. Let the provisioning
animation show Locate, Create, Provision and Wake. Point to Scout, Risk, Trader
and Auditor as separate Hermes runtimes and show each 1Claw status.

### 0:55 — The autonomous goal

Use this prepared objective:

> Compare the strongest policy-compatible Stock Token opportunities and prefer
> fresh liquidity with low route deviation.

Set the budget to `1 USDG` and start the two-minute window. The first evaluation
runs immediately; the remaining window proves the fleet can reevaluate without
another user action.

### 1:25 — Source of truth and evidence

Point to:

- ENS policy version and manifest hash;
- shortlist containing several Stock Tokens;
- The Graph block and proof root;
- current 1Claw execution state.

Explain that changing the ENS record changes the next agent cycle without
redeploying the fleet.

### 1:55 — Four-agent proof

Click **Run four agent proof**. Walk through the visible order:

1. strategy limits;
2. live ENS policy;
3. Scout recommendation;
4. The Graph risk gate;
5. Uniswap V4 quote;
6. Auditor proof bundle.

Review the 1 USDG purchase, sign the three wallet-owned setup operations and
let Hermes submit the guarded swap. Open **Full audit** after execution. Show
the Uniswap router, PoolManager and poolId, then the exact Substreams request,
package, module, checkpoint and response used by Risk.

### 2:35 — Close

Say:

> The wow factor is not an AI picking a stock. It is four independently bounded
> agents whose identity, market evidence, spending authority and final decision
> can each be verified.

Open the stored audit bundle from History. The judges can follow every setup
transaction, the final swap, token transfers, Graph evidence and proof hashes
without relying on narration.

## Live-purchase rule

For purchases of 3 USDG or more, only execute when all four 1Claw rails are
linked. Only call it a purchase when the UI returns `executed`, the audit
bundle says `stored`, and the wallet receives the stock token.

## Fail-closed moments worth showing

- Paused ENS policy: the fleet rejects every candidate before market calls.
- Missing 1Claw link: analysis continues, but execution from 3 USDG stays
  locked.
- Stale Graph stream: the candidate is blocked instead of using unverifiable
  evidence.
- Missing Uniswap route: the token remains visible with a clear status, but
  cannot advance.

These are product features. They demonstrate that the agents cannot silently
weaken the user's limits.

## Pre-demo checklist

- `pnpm check` passes from the repository root.
- App and API origins match.
- The wallet session signs successfully.
- PerkOS returns four healthy Hermes agents.
- ENS resolves an active, unexpired manifest for the wallet.
- Robinhood returns multiple Stock Tokens.
- At least two candidates have fresh Uniswap and Graph evidence.
- The proof ends as `executed`.
- History opens the stored purchase audit.
- PoolManager, poolId and token transfers match the receipt.
- The Graph request shows `map_pool_events`, its package and checkpoint.
- Browser zoom and mobile layout have been checked.
- No secret or private key appears in the browser, terminal or repository.
