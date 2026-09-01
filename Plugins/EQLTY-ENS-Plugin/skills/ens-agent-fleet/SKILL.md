---
name: ens-agent-fleet
description: Resolve and inspect live ENS and Durin agent fleets, explain their behavior policy, open role metadata, and prepare bounded policy changes. Use when an agent needs persistent identity, discoverability, fleet settings, or an Emergency Stop without bypassing owner authorization.
---

# ENS Agent Fleet

Use ENS as the live source of truth for agent identity and behavior. Never infer
fleet settings from local defaults when the control plane reports a live Durin
manifest.

## Commands

```bash
node "{baseDir}/scripts/ens-fleet.mjs" directory
node "{baseDir}/scripts/ens-fleet.mjs" metadata trader
node "{baseDir}/scripts/ens-fleet.mjs" policy
node "{baseDir}/scripts/ens-fleet.mjs" prepare capital-protection
node "{baseDir}/scripts/ens-fleet.mjs" prepare opportunity-mode
node "{baseDir}/scripts/ens-fleet.mjs" prepare emergency-stop
```

All commands require the authenticated owner session. Set
`EQLTY_SESSION_COOKIE` without printing it.

## Decision policy

1. Require `source=durin`, `mode=live` and `status=active`.
2. Cite the user root, manifest version and manifest hash.
3. For every role, cite its ENS name, settings hash and metadata URL.
4. Treat `paused=true` as a hard stop before market analysis or spending.
5. Use `prepare` to show the exact semantic diff and new manifest hash.
6. Never publish ENS records from an autonomous agent.
7. Require owner-wallet authorization for the prepared hash before a
   production publication flow.

Read [records.md](references/records.md) before integrating the result.
