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
- `GET /api/fleet/metadata/:role`
- `POST /api/goals`
- `POST /api/strategies`
- `POST /api/runs`
- `GET /api/evidence/:ticker`

ENS policy preparation returns hash-bound records for review. It does not
publish changes before wallet and World authorization are complete.

`EQLTY_ONECLAW_MIN_AMOUNT_USDG` stores the 1Claw purchase threshold in
six-decimal USDG atomic units. The default `3000000` applies the rail lock to
amounts of 3 USDG or more.

Run `pnpm test`, `pnpm typecheck` and `pnpm build` before publishing changes.
