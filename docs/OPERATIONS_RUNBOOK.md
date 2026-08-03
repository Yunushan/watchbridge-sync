# Operations Runbook

This runbook applies to the shipped single-instance, file-backed production deployment. It is an operator checklist, not a claim of multi-instance or hosted multi-tenant support. Record the deployment owner, escalation contact, and public incident channel in the deployment system before exposing the service.

## Preflight

Before the first public deployment:

1. Set a unique `WATCHBRIDGE_API_KEY` with at least 32 characters and a strictly encoded 32-byte `WATCHBRIDGE_STORAGE_KEY`.
2. Store the API key, storage key, TLS private key, and provider credentials in a secret manager. Keep a tested storage-key escrow separate from the encrypted data volume.
3. Put the HTTP-only Compose web listener behind the shipped TLS edge or another TLS-terminating proxy. Do not publish the API container directly.
4. Restrict outbound DNS, IP, and TLS destinations before enabling owner-controlled Jellyfin, Emby, Kodi, Movary, or Plex destinations.
5. Confirm `/healthz` and `/readyz` from the private deployment network, then configure the Prometheus scrape target and alert receiver.
6. Complete one dry-run sync with a disposable account pair and verify that no token, request body, or provider context enters logs or retained evidence.

The API is intentionally single-instance and file-backed. Do not add replicas or point multiple instances at the same data directories until shared filesystem semantics, job claims, OAuth transactions, vault policy, and recovery behavior have been certified for that deployment. CI also runs the deterministic capacity smoke as a regression signal; it is not a substitute for host-specific load testing.

## Service objectives

These are starting targets to measure and tune; they are not current availability guarantees:

- API availability: 99.5% monthly, excluding planned maintenance.
- Non-sync API requests: p95 below 2 seconds and 5xx below 1% over a 10-minute window.
- Confirmed syncs: 100% must have a durable `pending`, `succeeded`, or `failed` job record and a pre-write backup before the first remote mutation.
- Recovery: restore the encrypted volume and prove `/readyz` plus one authenticated backup read within the deployment's documented recovery objective.

The CI `smoke:production-capacity` check exercises 64 authenticated metrics requests with 16 concurrent workers and fails if any request errors or the measured p95 exceeds two seconds. Treat its JSON output as a repeatable baseline only; production SLOs still require measurements from the intended host, proxy, storage, and provider mix.

Review these targets after measuring provider latency, storage I/O, and real sync sizes. Do not increase concurrency or proxy timeouts solely to silence an alert.

## Alert response

### `WatchBridgeApiUnavailable`

1. Check the edge, web, API container status, `/healthz`, and `/readyz`.
2. Inspect recent container logs without printing environment variables or request bodies.
3. If readiness fails, verify the API key format, storage-key availability, writable data directories, and disk capacity.
4. Preserve the data volume and logs before restarting. A restart is not a recovery test.

### `WatchBridgeApiHighServerErrorRate`

1. Inspect the durable job records and identify whether a provider mutation had already started.
2. Treat `writeMayBePartial: true` as requiring provider-side reconciliation; do not blindly retry the request.
3. Compare the source and target backups, provider audit history, and request ID before deciding on a retry or restore.

### `WatchBridgeApiHighLatency`

Check provider response time, rate limits, storage I/O, proxy saturation, and active request/sync gauges. Keep connector retries limited to idempotent reads. Provider mutations and OAuth exchanges are single-attempt by design.

### Saturation alerts

For `WatchBridgeSyncExecutionSaturated` or `WatchBridgeApiRequestCapacitySaturated`, review active jobs, client behavior, request sizes, memory, and provider latency. Reduce or isolate load first; only raise `WATCHBRIDGE_MAX_CONCURRENT_SYNCS` or `WATCHBRIDGE_MAX_CONCURRENT_REQUESTS` after a measured capacity test.

## Backup and recovery

1. Stop confirmed writes and preserve the current data volume before recovery work.
2. Keep the encrypted volume and storage key together operationally but in separate failure domains. Never copy the key into the backup directory.
3. Restore into a new volume or host, start the exact release image, and verify `/readyz`.
4. Read one known backup and one job record through the authenticated API. If the key is missing or wrong, stop; repeated attempts cannot recover encrypted records.
5. Run a dry-run against a disposable provider account and review the resulting evidence before enabling writes.
6. Retain the recovery timestamp, release tag, volume identifier, checks performed, and operator identity without recording tokens or vault contents.

For an off-host copy, run the repository verifier against the restored snapshot before starting the service. It requires the storage key through the environment (never a command-line argument), decrypts every recognized backup/job/OAuth-vault record, rejects plaintext or tampered envelopes, and can produce a non-secret checksum manifest:

```bash
WATCHBRIDGE_STORAGE_KEY="<32-byte-key>" \
  node scripts/verify-storage-snapshot.mjs /path/to/restored/watchbridge-data \
  --write-manifest /path/to/restored/watchbridge-snapshot-manifest.json
```

After copying the snapshot to a second failure domain, verify the manifest again with `--verify-manifest`. Keep the manifest and the recovery evidence with the release tag, but never retain the storage key, decrypted records, vault IDs, or provider context in the evidence bundle. The verifier proves authenticated readability and byte-level continuity of the copied records; it does not replace a provider-side reconciliation drill.

Application-level encryption protects record contents, not filenames, sizes, timestamps, or the availability of the storage key. For rotation, keep the replacement in `WATCHBRIDGE_STORAGE_KEY` and the retired key in `WATCHBRIDGE_STORAGE_KEY_PREVIOUS` until every retained record has been read and rewritten. Only one previous key is supported; keep retired-key escrow until the retention window expires.

## Release and rollback

1. Merge through protected `main` only after the required review and status checks pass.
2. Push a `v*` tag matching the package version. The `production-release` environment gate must approve the release workflow.
3. Verify the published source checksum, GitHub provenance attestation, CycloneDX SBOM attestation, and the tagged release commit before deployment.
4. Deploy the tagged image/source and confirm health, readiness, metrics, TLS headers, and the recovery smoke checks.
5. For rollback, preserve the current volume and evidence, redeploy the previous verified tag, and repeat health/readiness checks. Never delete the data volume as part of a routine rollback.

## Live-provider evidence

The `live-provider-smoke` workflow requires an approved environment and the protected `WATCHBRIDGE_LIVE_SYNC_REQUEST` secret. Runs are serialized so two drills cannot exercise the same disposable account concurrently. Use only a disposable or explicitly authorized non-production account pair. The request must set `dryRun: true` and must not set `confirmWrite: true`. Review the retained non-secret evidence and provider audit logs; this drill does not certify a real write or recovery path.

## Security incident response

If a token, API key, storage key, or TLS private key may have been exposed:

1. Stop affected writes and preserve logs/evidence without copying the secret.
2. Revoke or rotate the provider credential and WatchBridge API key through the secret manager.
3. Treat a lost storage key as a data-availability incident and use the escrow/recovery procedure.
4. Review job records, provider audit history, proxy request IDs, and deployment logs for unauthorized activity.
5. Report the vulnerability privately through the process in `SECURITY.md`; do not publish credentials or sensitive evidence in an issue or pull request.
