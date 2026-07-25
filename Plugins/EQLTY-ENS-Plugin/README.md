# EQLTY ENS Plugin

Reusable Hermes and OpenClaw tooling for per-user ENS agent fleets. The plugin
resolves the live Durin control plane, inspects role metadata and prepares
bounded policy changes.

## Commands

```bash
node skills/ens-agent-fleet/scripts/ens-fleet.mjs directory
node skills/ens-agent-fleet/scripts/ens-fleet.mjs metadata trader
node skills/ens-agent-fleet/scripts/ens-fleet.mjs policy
node skills/ens-agent-fleet/scripts/ens-fleet.mjs prepare emergency-stop
```

Set `EQLTY_AGENT_API_URL` when the API is not running at
`http://localhost:4021`. Every command also requires
`EQLTY_SESSION_COOKIE`; never commit or print that value.

Preparation returns semantic differences and hash-bound records. It never
publishes ENS changes or bypasses owner-wallet and World authorization.
