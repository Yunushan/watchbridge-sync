# Deployment

## Local developer mode

```bash
pnpm install
pnpm dev
```

## Server mode

```bash
pnpm --filter @watchbridge/api build
WATCHBRIDGE_PORT=8080 node apps/api/dist/server.js
```

The shipped API is currently single-instance and file-backed; it does not use the PostgreSQL and Redis development containers in `docker-compose.yml`. Those containers are reserved scaffolding, not a production persistence claim.

## Container deployment

The repository ships a reproducible single-instance container deployment: non-root Node API and Nginx web containers, a same-origin web proxy, a named persistent data volume, bounded health checks for both services, readiness-gated startup, a 10 MiB proxy body limit, restrictive container privileges, and Docker Hub base images pinned by immutable digest. The web process keeps its PID and proxy temporary files only in its sole writable `/tmp` tmpfs. Compose gives the API a default ceiling of 1 CPU, 1 GiB memory, 256 processes, and no swap beyond that memory limit; the web service defaults to 0.5 CPU, 256 MiB, 64 processes, and the same no-swap policy. Override `WATCHBRIDGE_{API,WEB}_{CPUS,MEMORY_LIMIT}` only from load-test evidence. The API runtime image is assembled with `pnpm deploy --prod`, so build/test tooling such as TypeScript, Vitest, and tsx is absent from its dependency tree; CI asserts those live-image properties. After building the same Compose images, CI also fails on fixable high or critical OS/library vulnerabilities in either runtime image. It supports isolated named API-key tenants in one API process, but intentionally does **not** claim multi-instance support or identity-aware multi-user tenancy.

Set at least a 32-character API key and a valid 32-byte storage key in your deployment secret manager, then run:

```bash
docker compose -f docker-compose.production.yml up --build -d
```

The build and API runtime install the standard Debian CA bundle and configure Node to use it; they never disable TLS verification. If your organization intercepts outbound HTTPS with a private root certificate, provide its PEM only as an optional BuildKit secret for the dependency-install layer instead of using `NODE_TLS_REJECT_UNAUTHORIZED=0`, npm `strict-ssl=false`, or a committed certificate. For a direct image build, use:

```bash
docker build --secret id=watchbridge_registry_ca,src=/secure/path/organization-root-ca.pem --target api -t watchbridge-api:local .
```

The secret is available only to that build instruction and is not copied into the source tree or final image. Configure equivalent runtime trust through your platform's secret/CA mechanism when API provider traffic also passes through an organization TLS proxy.

The web UI is served on `${WATCHBRIDGE_HTTP_PORT:-8080}` and proxies `/v1/`, `/healthz`, and `/readyz` to the private API container. The compose file mounts no provider credentials and defaults custom provider base URLs to `false`; configure network egress allowlists at the container host before enabling self-hosted provider connectors. The named `watchbridge-data` volume contains encrypted backup, job, and optional vault records, so include it and the storage key in tested recovery procedures.

The CI container smoke test exercises the recovery procedure against the shipped Compose definition: it writes an encrypted vault record, copies the named data volume into a separate recovery volume, removes the complete stack and original volume, restores the copied files into a newly labelled replacement volume, starts the stack without rebuilding, and decrypts then deletes the original record through the public proxy. It also generates a temporary localhost certificate and proves the shipped TLS edge redirects HTTP, proxies HTTPS, preserves app security headers, and adds HSTS. A successful CI run retains a 30-day `production-recovery-evidence` artifact with its commit and run identity plus the passed proxy, restart, and volume-recovery assertions; it contains no keys, vault IDs, or connector context. This proves the application can read an encrypted record after volume loss and rebuild; it does not replace an operator's off-host backup retention, storage-key escrow, or provider-side reconciliation drill.

The shipped Compose stack intentionally speaks HTTP on its published web port; it does not obtain or manage certificates because the hostname, certificate authority, and edge topology belong to the deployment. Do not expose that port directly to the public internet. Put a TLS-terminating reverse proxy or load balancer in front of the web container, redirect public HTTP to HTTPS, expose the API only through that same-origin web proxy, and restrict direct host/container access with firewall rules. After HTTPS works for every served hostname, configure HSTS at that TLS edge. Do not add HSTS to the supplied HTTP-only Nginx configuration: doing so would create a misleading guarantee and can break local or recovery access.

### Shipped TLS edge profile

For a single-host public deployment, `docker-compose.tls.yml` ships a separate non-root, read-only Nginx TLS edge. It redirects HTTP to HTTPS, serves HSTS only over TLS, and proxies solely to the private `web` service. Supply a PEM certificate chain and its PEM private key from your secret-management or certificate-renewal process; Compose mounts them as runtime secrets, so they are not copied into the build context or image layers. Bind the base web listener only to loopback while the edge owns public ports:

```bash
WATCHBRIDGE_HTTP_PORT=127.0.0.1:18080 \
WATCHBRIDGE_TLS_CERTIFICATE_PATH=/secure/path/fullchain.pem \
WATCHBRIDGE_TLS_PRIVATE_KEY_PATH=/secure/path/privkey.pem \
docker compose -f docker-compose.production.yml -f docker-compose.tls.yml up --build -d
```

The edge defaults to host ports 80 and 443, mapped internally to unprivileged 8080 and 8443. It preserves the same 10 MiB request-body limit as the internal web proxy, so HTTPS does not impose a lower hidden upload limit. Override `WATCHBRIDGE_TLS_HTTP_PORT` or `WATCHBRIDGE_TLS_HTTPS_PORT` only for a deliberate fronting load balancer or local test. Keep certificate and key source paths outside the repository and out of `.env`; rotate them through the deployment platform, then recreate only the edge service. The edge’s `/edge-healthz` is HTTP-only for container health checks; all application routes are redirected or served through HTTPS.

For production, configure exactly one authentication mode: `WATCHBRIDGE_API_KEY` for a backward-compatible single tenant, or `WATCHBRIDGE_API_KEYS` as a JSON object mapping 1–100 lowercase tenant IDs to unique API keys. Every production key must contain at least 32 non-whitespace characters. Send each key to `/v1/*` as `Authorization: Bearer <key>`; named-tenant records are stored below tenant-specific backup, job, and vault directories and encrypted with tenant-bound authenticated data. `/healthz` stays unauthenticated for a shallow liveness probe, while `/readyz` additionally verifies the production API-key policy, port, storage-key syntax, retention configuration, and writable backup, job, OAuth-vault, and configured shared OAuth-transaction directories for every configured tenant. Neither endpoint returns secrets or configuration details. The API compares a fixed-size digest of the complete authorization value, so malformed or differently sized credentials do not enter a direct secret-string comparison. Rotate keys through your secret manager and never put them in a URL.

Every `/v1/*` response is marked `no-store` and receives `nosniff`, frame-denial, and no-referrer headers. Request bodies are limited to 10 MiB by measuring the actual body stream, including requests with no `Content-Length` or an understated value. Configure the reverse proxy with an equal or lower request-body limit so oversized uploads are rejected before they reach Node.

In production, the API also applies an in-process limit of **120 requests per minute per API authorization value**. Set `WATCHBRIDGE_RATE_LIMIT_PER_MINUTE` to a whole number from 1 through 10,000 to tune it; malformed values make `/readyz` fail and prevent production startup. This is a bounded single-instance safety control, not a replacement for reverse-proxy or provider-aware rate limits across multiple instances. It also permits at most **16 concurrent authenticated API requests** (including body parsing) per process. Set `WATCHBRIDGE_MAX_CONCURRENT_REQUESTS` to a whole number from 1 through 200 only after measuring request sizes and memory use; a saturated request budget returns `429` with `Retry-After: 1` before it reads a body. The bodyless authenticated metrics route remains available at saturation so Prometheus can observe it. Separately, the process permits at most **two** concurrent long-running account sync, backup-sync, or restore operations. Set `WATCHBRIDGE_MAX_CONCURRENT_SYNCS` to a whole number from 1 through 100 when capacity has been measured. A saturated budget returns `429` before it creates an audit job or contacts a provider; the authenticated metrics endpoint exposes active and configured execution gauges, and the shipped alert rules warn after five minutes of saturation.

Authenticated operators can scrape `GET /v1/metrics` in Prometheus text format. It reports process start time plus request counts and total duration grouped only by fixed endpoint category and status class; it never labels a metric with an API key, tenant, UUID, provider credential, or raw URL. Keep the endpoint on the private API network and configure the scraper with a WatchBridge API key. These are per-process counters, so aggregate them at the monitoring system if a deployment later has more than one instance.

The repository includes [a Prometheus scrape configuration](../monitoring/prometheus.example.yml) and [alert rules](../monitoring/prometheus-alerts.yml) for API unavailability, sustained 5xx rate, and sustained latency. Mount the API key as a Prometheus secret file; do not put it in target URLs or committed configuration. Adapt the target DNS name, TLS settings, alert receiver, and runbook ownership to the deployment before enabling the rules.

## Authorized live-provider dry-run drill

The manual **live-provider-dry-run** workflow turns real provider credentials into repeatable release evidence without making remote changes. It runs only on explicit dispatch, is protected by the GitHub `live-provider-smoke` environment, builds the current commit, starts a disposable local production API bound to loopback, and deletes its temporary encrypted storage afterward.

Before dispatching it, configure an approval rule for that GitHub environment and add its `WATCHBRIDGE_LIVE_SYNC_REQUEST` secret. The secret is a normal `POST /v1/sync/execute` body containing authorized non-production or dedicated test-account contexts, but it must set `"dryRun": true` and must not set `"confirmWrite": true`. For example, the shape is:

```json
{
  "source": "your-direct-source",
  "target": "your-direct-target",
  "selection": { "ratings": true },
  "dryRun": true,
  "sourceContext": { "accessToken": "provider-token" },
  "targetContext": { "accessToken": "provider-token" }
}
```

Use a pair and selected feature that the runtime support matrix lists as a direct supported path. The runner rejects missing or malformed secrets, non-loopback API URLs, requests that are not explicit dry-runs, `confirmWrite: true`, non-200 responses, and results without only `previewed` or `skipped` actions. It never prints the request or response body. A successful run retains a 30-day `live-provider-dry-run-evidence` artifact containing only the commit, source/target service IDs, generated time, explicit dry-run flag, and action-group count; it contains no request body, API key, provider context, vault ID, or response content. The executor performs only provider reads and read-only preflight calls for dry-runs; it does not persist pre-write backups or invoke an importer with a write flag. Review provider audit logs and retain the successful workflow URL as evidence for the exercised pair. This drill does not certify a real write/recovery path; perform that separately with an approved disposable account and documented reconciliation procedure.

On `SIGTERM` or `SIGINT`, the API stops accepting new connections and waits for active requests to finish. `WATCHBRIDGE_SHUTDOWN_TIMEOUT_MS` bounds this drain period from 1,000 to 300,000 milliseconds (25,000 by default); after it expires the process exits non-zero so the supervisor can surface an incomplete drain. The production Compose file gives Docker a 35-second stop grace period, leaving time for the default drain plus process cleanup.

The API also bounds slow client connections before application work begins: headers default to 15 seconds, a complete request body to 60 seconds, and idle keep-alive connections to 5 seconds. Set `WATCHBRIDGE_HEADERS_TIMEOUT_MS`, `WATCHBRIDGE_REQUEST_TIMEOUT_MS`, and `WATCHBRIDGE_KEEP_ALIVE_TIMEOUT_MS` to whole milliseconds between 1,000 and 300,000; the header deadline cannot exceed the request deadline. These limits do not bound a running sync's provider work. The supplied Nginx configuration applies matching client-side limits and caps an upstream silent read at five minutes; change the proxy deadline only after measuring real sync durations.

The container web proxy writes a minimal access log to standard output containing the client address, method, path without its query string, HTTP version, status, response size, duration, and a generated request ID. The same request ID is returned in `X-Request-ID`, allowing an operator to correlate a client report with a proxy log entry. The log intentionally never contains the raw request target, authorization header, referer, or request body, so OAuth callback `code` and `state` parameters do not enter normal access logs. Keep any upstream TLS proxy and centralized log pipeline at least as restrictive.

The web container exposes `/.well-known/security.txt` with the repository's private vulnerability-reporting contact. Renew its date-bounded `Expires` field before it lapses, and preserve the endpoint when replacing or adding a TLS edge proxy.

The Nginx deployment serves Vite's content-hashed `/assets/` files with one-year immutable caching, while `index.html` is `no-store` so a client receives each new application shell immediately after deployment. Preserve this distinction in any CDN or TLS edge configuration; caching the shell indefinitely can leave a user on an incompatible UI after an API release.

Request JSON cannot redirect official provider connectors, metadata resolvers, or recommendation calls to a custom `baseUrl`, `v3BaseUrl`, or `v4BaseUrl` by default; a request containing an override is rejected before any provider fetch. `NODE_ENV=test` enables overrides for automated tests only. An owner may opt in outside tests with the exact lowercase setting `WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true`. Accepted overrides are bounded to 2,000 characters and must be syntactically valid HTTPS URLs without a username, password, query, or fragment; HTTP and malformed values are rejected even when opted in. Any other environment value, including `TRUE`, fails closed.

Treat that opt-in as a high-risk deployment mode: every authenticated API caller can select the initial host that receives request-scoped provider tokens or API keys. The connector HTTP layer disables automatic redirects and rejects 3xx responses, but it cannot replace network enforcement against private-address destinations or DNS rebinding. Use the opt-in only for an owner-controlled proxy in a closed deployment, restrict outbound DNS/IP and TLS destinations at the network layer, and never deploy with `NODE_ENV=test`. Leave the variable unset or `false` for ordinary production use.

Jellyfin, Emby, and Kodi require explicit owner-controlled HTTPS provider URLs and therefore cannot run through the production API unless that opt-in is enabled. Allowlist only the selected servers. Kodi's URL must end exactly in `/jsonrpc` and receives request-scoped HTTP Basic credentials. Plex does not accept a caller-supplied server URL: it discovers connections from the authenticated Plex resources service, requires credential-free HTTPS, and verifies the selected machine identifier before using a per-server token. Even so, resource discovery can return local, remote, or relay destinations, so production outbound policy should restrict Plex account/resource origins and the server destinations the owner intends to use.

Set `WATCHBRIDGE_BACKUP_DIR` and `WATCHBRIDGE_JOB_DIR` to user-owned protected locations to control where confirmed-sync backups and audit jobs are retained. Files are created with owner-only mode where the host supports POSIX permissions. If multiple API instances share these directories, the filesystem must provide atomic rename and exclusive file creation semantics: terminal job updates and retention deletion use a bounded per-job claim lock and re-read state under that lock. Media history is private user data, so protect host backups and use an encrypted disk or volume even when application-level encryption is enabled.

Retention cleanup is disabled by default. Set `WATCHBRIDGE_BACKUP_RETENTION_DAYS` and/or `WATCHBRIDGE_JOB_RETENTION_DAYS` to a whole number from 1 through 36,500 (`0` or unset disables that policy). Configured cleanup runs opportunistically, at most hourly, before new jobs or backups are persisted. Completed/failed jobs expire by their validated `updatedAt`; pending jobs are never deleted. Backups expire by filesystem modification time, but any backup referenced by a retained job is preserved. If even one UUID-named job cannot be decoded and strictly validated, backup deletion fails closed for that run because its references cannot be trusted.

Operators can preview the same policy with `POST /v1/storage/cleanup` and `{ "dryRun": true }`, or `watchbridge cleanup-storage cleanup-request.json`. Actual deletion requires both `{ "dryRun": false, "confirmDelete": true }` and normal `/v1/*` API authentication. Cleanup ignores non-JSON names, never follows a filename supplied by the request, and only considers exact UUID-named records inside the configured directories. Review the returned eligible/deleted/error counts before scheduling this endpoint. Retention is not a substitute for tested off-host backups or regulatory deletion policy.

Application-level storage encryption is optional for backups/jobs. Set `WATCHBRIDGE_STORAGE_KEY` to one strictly encoded 32-byte key to encrypt every newly written backup and audit-job file with AES-256-GCM. Each file uses a random 12-byte nonce and authenticates its storage schema, record kind (`backup` or `job`), and UUID. Disk contents are a `watchbridge.storage.v1` JSON envelope; backup downloads still return the original plaintext `watchbridge.backup.v1` JSON. When a key is configured, plaintext storage records are rejected by default so replacing an encrypted envelope with plaintext cannot silently downgrade authentication. Every update is fully encoded into an owner-only random temp file in the same directory, fsynced, atomically renamed over the final record, and followed by a containing-directory fsync on POSIX. This prevents ordinary process crashes and substantially improves power-loss durability. Windows uses its native rename behavior because it does not allow the POSIX directory-fsync form. This remains a file-backed runtime, not a database: use reliable storage and tested backups for controller, filesystem, or host failure.

Exactly these key forms are accepted; surrounding whitespace and every other length or encoding are rejected:

- 64 hexadecimal characters, such as output from `openssl rand -hex 32`;
- canonical padded Base64: 44 characters ending in `=`;
- canonical unpadded Base64URL: 43 characters using `A-Z`, `a-z`, `0-9`, `_`, and `-`.

To migrate trusted legacy plaintext files, temporarily set `WATCHBRIDGE_ALLOW_PLAINTEXT_STORAGE_MIGRATION=true` together with the storage key. Only the exact lowercase values `true` and `false` are valid; unset means false, and empty or malformed values fail closed. A read must first pass strict backup or job validation, then WatchBridge replaces that file with an authenticated encrypted envelope before returning it. Read every retained backup by ID and list/read every retained job while this controlled migration window is active, verify the files now have the `watchbridge.storage.v1` schema, then unset the migration variable (or set it to `false`) immediately. Setting migration to `true` without a valid key is rejected. This is an intentionally temporary compatibility path, not a steady-state deployment mode.

Keep the storage key in a secret manager, separate from the storage volume and its backups. A missing, malformed, or wrong key makes encrypted records unavailable without revealing whether authentication or decryption failed. WatchBridge supports one active storage key, so decrypt or explicitly re-encrypt retained files before rotating it; losing the key loses access to those encrypted files. Encryption hides file contents, not directory names, UUID filenames, file sizes, or filesystem timestamps. Leave `WATCHBRIDGE_STORAGE_KEY` unset only when deployment policy deliberately relies on an encrypted host volume.

`WATCHBRIDGE_OAUTH_VAULT_DIR` controls encrypted connector-context vault records (default `.watchbridge-oauth-vault`). Unlike backups/jobs, vault records always require `WATCHBRIDGE_STORAGE_KEY`; plaintext fallback and plaintext migration are refused. The API never returns stored context data, but a caller authorized for a tenant can save, use by UUID in an account-sync context, or delete that tenant's vault record. Use named `WATCHBRIDGE_API_KEYS` tenants for built-in static isolation; use an external identity-aware secret manager for end-user or delegated access.

By default, the OAuth start/exchange API keeps state and PKCE verifiers in process memory for ten minutes, so both requests must reach the same instance. To share only these short-lived transactions across API instances, set `WATCHBRIDGE_OAUTH_TRANSACTION_DIR` to one protected shared filesystem directory and set `WATCHBRIDGE_STORAGE_KEY`. Each state is encrypted with the `oauth-transaction` record kind, fsynced before its atomic rename, and followed by a containing-directory fsync on POSIX; callback exchange atomically renames it to a unique claim before reading, so exactly one instance can use it. Claims are deleted after use and expired/invalid claims are cleaned when a new transaction starts. With named API-key tenants, transaction directories and encryption authenticated data are also tenant-bound. The directory must provide reliable atomic rename semantics across instances. This does not make jobs, backups, or OAuth tokens multi-instance-safe.

## Production recommendations

- Put the API behind HTTPS.
- Do not enable broad CORS; grant browser origins individually only when a deployment has an explicit browser-client requirement.
- Keep the API private behind a trusted proxy. It does not use forwarding headers as client identity. If inbound rate limiting is added at the edge, key it from an authenticated or connection-derived identity, not a client-supplied `X-Forwarded-For` value.
- Use OAuth PKCE where the provider supports it. Shikimori and Annict use their documented client-secret authorization-code flows; their state is still one-time and provider-bound.
- Keep provider credentials request-scoped by default. The optional encrypted connector vault persists a validated direct-account context only after explicit user confirmation and only with `WATCHBRIDGE_STORAGE_KEY`; named API-key tenants isolate records, but the vault is not a substitute for an identity-aware secret manager.
- Rotate app secrets.
- Back up the storage-encryption key separately and test restore access; do not copy it into the backup directory.
- Do not horizontally scale the file-backed runtime for account data without validating the shared filesystem semantics and operational recovery model. Shared job/backup directories now use atomic records and per-job claims, while the optional OAuth transaction directory covers short-lived authorization state; a multi-user deployment still needs identity-aware authorization, shared vault policy, and operational recovery evidence.
- The account and metadata connectors enforce bounded per-attempt timeouts and retry only idempotent reads. Provider mutations and OAuth exchanges remain single-attempt by design; add edge/provider-aware throttling for deployment-wide quotas.
- Treat Plex as personal/non-commercial unless separate permission says otherwise. Its caller-provided token path is not a WatchBridge authorization service; review the current [Plex Terms of Service](https://www.plex.tv/about/privacy-legal/plex-terms-of-service/) before deployment.
- Keep a legal-safe connector policy enabled by default.
