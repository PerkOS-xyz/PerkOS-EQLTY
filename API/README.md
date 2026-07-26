# EQLTY API

The API exposes the product configuration and will host market, fleet and
execution services as they are added.

## Local use

From this directory:

```bash
pnpm install
pnpm dev
```

The service reads its environment from the repository root `.env` file. Use
`.env.example` as a variable reference and never commit live values.

Current endpoints:

- `GET /health`
- `GET /api/config`
- `GET /api/assets?catalog=uniswap-v4-universe`
- `GET /api/auth/perkos/nonce`
- `POST /api/auth/perkos/verify`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/orchestration`
- `POST /api/orchestration/prepare`
- `POST /api/fleet/activate`
- `POST /api/fleet/security/oneclaw`
- `GET /api/fleet/metadata/:role`
- `POST /api/goals`
- `POST /api/strategies`
- `POST /api/runs`
- `GET /api/evidence/:ticker`
- `GET /api/audits/:transactionHash`

Executed runs create a wallet-scoped Firestore audit bundle through the
existing PerkOS Firebase session. The bundle stores no credential values. It
preserves the Graph request and response, Uniswap pool evidence, proof hashes,
receipt and decoded token transfers.

ENS policy preparation returns hash-bound records for review. It does not
publish changes before wallet and World authorization are complete.

`EQLTY_ONECLAW_MIN_AMOUNT_USDG` stores the 1Claw purchase threshold in
six-decimal USDG atomic units. The default `3000000` applies the rail lock to
amounts of 3 USDG or more.

`ONECLAW_PLATFORM_APP_ID` and `ONECLAW_PLATFORM_API_KEY` configure the EQLTY
Platform API app. The API upserts the signed-in user, bootstraps the execution
template and returns the official claim URL. `ONECLAW_PLATFORM_TEMPLATE_ID` is
optional; without it, EQLTY creates or reuses its named template.

The one-time Trader credential is sent directly to PerkOS for server-side
storage and Hermes reprovisioning. It is never returned to the app. The user
claims the vault, agent and wallet in 1Claw, where `user_pays` keeps ownership
and billing attached to their account.

EQLTY does not enable EIP-712 domain restrictions for Robinhood Chain. The
trader still has Robinhood-only, contract, USDG and transaction-count
guardrails. If the account applies a deny-by-default EIP-712 policy, activation
stops until that restriction is disabled in 1Claw.

Run `pnpm test`, `pnpm typecheck` and `pnpm build` before publishing changes.
