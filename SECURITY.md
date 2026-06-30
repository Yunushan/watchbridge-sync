# Security Policy

WatchBridge handles sensitive account data and OAuth tokens.

Report vulnerabilities privately before public disclosure.

## Required security controls

- No password collection for third-party services.
- OAuth/PKCE where possible.
- Token encryption at rest.
- Backup encryption option.
- Dry-run before write.
- Audit log for every sync operation.
- Rate limit and retry budget per connector.
