# Security Policy

WatchBridge handles sensitive account data and OAuth tokens.

Report vulnerabilities privately before public disclosure.

The API can encrypt newly persisted canonical backups and sync audit jobs with authenticated AES-256-GCM by setting `WATCHBRIDGE_STORAGE_KEY`. The key is optional so operators can rely on an encrypted host volume, but one of those controls should protect production storage. Encrypted mode rejects plaintext by default. Trusted legacy files can be admitted only during an explicit `WATCHBRIDGE_ALLOW_PLAINTEXT_STORAGE_MIGRATION=true` window; each record is strictly validated and atomically rewritten encrypted before it is returned. Disable that switch immediately after migration. Atomic replacement prevents process-crash truncation but is not an `fsync`-backed power-loss durability guarantee. See [Deployment](docs/DEPLOYMENT.md) for the exact key formats, migration procedure, authenticated context, rotation limitations, and metadata that remains visible.

OAuth tokens remain request-scoped and are not persisted by the shipped API. Any future token vault must provide separate secret encryption and lifecycle controls; the backup/job storage key is not a token-vault design.

Request-supplied `baseUrl`, `v3BaseUrl`, and `v4BaseUrl` values cannot redirect official connector, metadata, or recommendation credentials by default. Automated tests may use strict custom URLs under `NODE_ENV=test`. An owner can explicitly enable them with the exact lowercase setting `WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true`; every override must then be an HTTPS URL of at most 2,000 characters with no username, password, query, or fragment. Connector HTTP requests disable automatic redirect following and reject 3xx responses, so a credential-bearing request cannot be redirected to a second destination. This switch is still high risk because an authenticated API caller can choose the initial credential destination. Enable it only when every caller and destination is trusted, keep an outbound DNS/IP/TLS allowlist to contain private-network and rebinding risks, and never run a deployed API with `NODE_ENV=test`.

## Required security controls

- No password collection for third-party services.
- OAuth/PKCE where possible.
- Token encryption at rest before any token persistence is introduced.
- Backup and audit-job encryption option, or an encrypted host volume.
- Dry-run before write.
- Audit log for every sync operation.
- Rate limit and retry budget per connector.
