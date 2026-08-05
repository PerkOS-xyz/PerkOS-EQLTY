# The Graph operations

EQLTY treats Substreams evidence as a required decision input. If the adapter
is unavailable, behind the configured block limit or unable to authenticate,
the fleet stops before preparing a Uniswap execution.

## Read the current state

The public API exposes only safe operational fields. It never includes the
provider token or the raw provider error.

```bash
curl -sS https://eqlty-api.perkos.xyz/api/config \
  | jq '.integrationHealth.theGraph'
```

The adapter health endpoint is useful when the API reports it as unreachable.

```bash
curl -sS https://eqlty-graph.perkos.xyz/health \
  | jq '{running,state,processedBlock,providerHeadBlock,tickers,restartCount,lastProgressAt,nextRetryAt,errorCode}'
```

## Recovery actions

| Action | Meaning | Operator response |
|---|---|---|
| `none` | Evidence is current | No action |
| `wait-for-sync` | Stream is running but behind | Wait for lag to fall below `GRAPH_MAX_LAG_BLOCKS` |
| `restart-adapter` | Stream process exited | The adapter retries automatically with backoff |
| `renew-quota` | Provider capacity is exhausted | Renew capacity or replace the provider token in the VPS secret store |
| `check-provider` | Provider or network cannot be reached | Verify provider status, DNS and credentials |
| `configure-provider` | No adapter URL is configured | Set the adapter URL and access token in the API environment |

Quota failures start with a one minute retry delay and back off to fifteen
minutes. Other failures start at two seconds and back off to one minute. A
successfully processed block resets the retry counter.

## Safe recovery sequence

1. Read `/api/config` and note the recovery action, checkpoint and head block.
2. Resolve provider capacity or connectivity without printing credentials.
3. Restart the Graph adapter using the deployment manager for the VPS.
4. Confirm `running=true` on the adapter health endpoint.
5. Wait until block lag is within `GRAPH_MAX_LAG_BLOCKS`.
6. Confirm the public API reports `status=ready` and `action=none`.
7. Run a consultation before authorizing funds.

Do not relax freshness or block-lag limits to force a green state. EQLTY must
remain fail-closed until live evidence satisfies the configured policy.

## Readiness gates

The Graph is ready only when all of these are true:

- the adapter process is running;
- the provider accepts the current credential and quota;
- the processed block is within the configured lag limit;
- at least one expected stock-token pool has been observed;
- evidence provenance is `the-graph-substreams`;
- the latest heartbeat and swap timestamps satisfy the freshness policy.
