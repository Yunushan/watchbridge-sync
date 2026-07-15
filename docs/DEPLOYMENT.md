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

For production, `WATCHBRIDGE_API_KEY` is required. Send it to every `/v1/*` route as `Authorization: Bearer <key>`; `/healthz` stays unauthenticated for infrastructure probes. The API compares a fixed-size digest of the complete authorization value, so malformed or differently sized credentials do not enter a direct secret-string comparison. Rotate this shared key through your secret manager and never put it in a URL.

Every `/v1/*` response is marked `no-store` and receives `nosniff`, frame-denial, and no-referrer headers. Request bodies are limited to 10 MiB by measuring the actual body stream, including requests with no `Content-Length` or an understated value. Configure the reverse proxy with an equal or lower request-body limit so oversized uploads are rejected before they reach Node.

Request JSON cannot redirect official provider connectors, metadata resolvers, or recommendation calls to a custom `baseUrl`, `v3BaseUrl`, or `v4BaseUrl` by default; a request containing an override is rejected before any provider fetch. `NODE_ENV=test` enables overrides for automated tests only. An owner may opt in outside tests with the exact lowercase setting `WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true`. Accepted overrides are bounded to 2,000 characters and must be syntactically valid HTTPS URLs without a username, password, query, or fragment; HTTP and malformed values are rejected even when opted in. Any other environment value, including `TRUE`, fails closed.

Treat that opt-in as a high-risk deployment mode: every authenticated API caller can select the initial host that receives request-scoped provider tokens or API keys. The connector HTTP layer disables automatic redirects and rejects 3xx responses, but it cannot replace network enforcement against private-address destinations or DNS rebinding. Use the opt-in only for an owner-controlled proxy in a closed deployment, restrict outbound DNS/IP and TLS destinations at the network layer, and never deploy with `NODE_ENV=test`. Leave the variable unset or `false` for ordinary production use.

Jellyfin, Emby, and Kodi require explicit owner-controlled HTTPS provider URLs and therefore cannot run through the production API unless that opt-in is enabled. Allowlist only the selected servers. Kodi's URL must end exactly in `/jsonrpc` and receives request-scoped HTTP Basic credentials. Plex does not accept a caller-supplied server URL: it discovers connections from the authenticated Plex resources service, requires credential-free HTTPS, and verifies the selected machine identifier before using a per-server token. Even so, resource discovery can return local, remote, or relay destinations, so production outbound policy should restrict Plex account/resource origins and the server destinations the owner intends to use.

Set `WATCHBRIDGE_BACKUP_DIR` and `WATCHBRIDGE_JOB_DIR` to user-owned protected locations to control where confirmed-sync backups and audit jobs are retained. Files are created with owner-only mode where the host supports POSIX permissions. Media history is private user data, so protect host backups and use an encrypted disk or volume even when application-level encryption is enabled.

Application-level storage encryption is optional. Set `WATCHBRIDGE_STORAGE_KEY` to one strictly encoded 32-byte key to encrypt every newly written backup and audit-job file with AES-256-GCM. Each file uses a random 12-byte nonce and authenticates its storage schema, record kind (`backup` or `job`), and UUID. Disk contents are a `watchbridge.storage.v1` JSON envelope; backup downloads still return the original plaintext `watchbridge.backup.v1` JSON. When a key is configured, plaintext storage records are rejected by default so replacing an encrypted envelope with plaintext cannot silently downgrade authentication. Every update is fully encoded into an owner-only random temp file in the same directory and atomically renamed over the final record, preventing an ordinary process crash during writing from exposing a truncated final file. The file-backed runtime does not `fsync` the file and parent directory, so it does not promise database-grade durability across sudden power loss or storage-controller failure; use reliable storage and tested backups.

Exactly these key forms are accepted; surrounding whitespace and every other length or encoding are rejected:

- 64 hexadecimal characters, such as output from `openssl rand -hex 32`;
- canonical padded Base64: 44 characters ending in `=`;
- canonical unpadded Base64URL: 43 characters using `A-Z`, `a-z`, `0-9`, `_`, and `-`.

To migrate trusted legacy plaintext files, temporarily set `WATCHBRIDGE_ALLOW_PLAINTEXT_STORAGE_MIGRATION=true` together with the storage key. Only the exact lowercase values `true` and `false` are valid; unset means false, and empty or malformed values fail closed. A read must first pass strict backup or job validation, then WatchBridge replaces that file with an authenticated encrypted envelope before returning it. Read every retained backup by ID and list/read every retained job while this controlled migration window is active, verify the files now have the `watchbridge.storage.v1` schema, then unset the migration variable (or set it to `false`) immediately. Setting migration to `true` without a valid key is rejected. This is an intentionally temporary compatibility path, not a steady-state deployment mode.

Keep the storage key in a secret manager, separate from the storage volume and its backups. A missing, malformed, or wrong key makes encrypted records unavailable without revealing whether authentication or decryption failed. WatchBridge supports one active storage key, so decrypt or explicitly re-encrypt retained files before rotating it; losing the key loses access to those encrypted files. Encryption hides file contents, not directory names, UUID filenames, file sizes, or filesystem timestamps. Leave `WATCHBRIDGE_STORAGE_KEY` unset only when deployment policy deliberately relies on an encrypted host volume.

The OAuth start/exchange API keeps state and PKCE verifiers in process memory for ten minutes. Keep both requests on the same instance. Before horizontal scaling, replace this with a shared encrypted TTL store. See [OAuth setup](OAUTH_SETUP.md).

## Production recommendations

- Put the API behind HTTPS.
- Do not enable broad CORS; grant browser origins individually only when a deployment has an explicit browser-client requirement.
- Keep the API private behind a trusted proxy. It does not use forwarding headers as client identity. If inbound rate limiting is added at the edge, key it from an authenticated or connection-derived identity, not a client-supplied `X-Forwarded-For` value.
- Use OAuth PKCE where the provider supports it. Shikimori and Annict use their documented client-secret authorization-code flows; their state is still one-time and provider-bound.
- Keep provider credentials request-scoped. The shipped runtime does not persist OAuth tokens; introduce an encrypted secret store before adding a token vault.
- Rotate app secrets.
- Back up the storage-encryption key separately and test restore access; do not copy it into the backup directory.
- Do not horizontally scale the file-backed runtime. A multi-user deployment first needs shared transactional job storage, an encrypted OAuth transaction store, and shared backup storage.
- The account and metadata connectors enforce bounded per-attempt timeouts and retry only idempotent reads. Provider mutations and OAuth exchanges remain single-attempt by design; add edge/provider-aware throttling for deployment-wide quotas.
- Treat Plex as personal/non-commercial unless separate permission says otherwise. Its caller-provided token path is not a WatchBridge authorization service; review the current [Plex Terms of Service](https://www.plex.tv/about/privacy-legal/plex-terms-of-service/) before deployment.
- Keep a legal-safe connector policy enabled by default.
