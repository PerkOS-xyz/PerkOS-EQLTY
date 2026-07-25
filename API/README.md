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

Run `pnpm test`, `pnpm typecheck` and `pnpm build` before publishing changes.
