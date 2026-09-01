# ENS fleet record contract

| Record | Meaning |
|---|---|
| Root `agent-context` | Fleet manifest, policy, version, expiry and role hashes |
| Role `agent-context` | Objective, inputs, actions and 1Claw enforcement |
| Manifest hash | Commitment binding the complete root JSON |
| Settings hash | Commitment referenced by the root for one role record |
| Metadata URL | Authenticated API view of the live role record |

The authenticated user wallet owns the root. Agent execution identities cannot
authorize policy changes. Durin stores subnames and records on Base; ENS
provides the portable `.eth` namespace.

Prepared output is not an onchain update. Publication must bind the exact new
manifest hash to owner-wallet authorization.
