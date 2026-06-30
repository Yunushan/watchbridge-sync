# Terms-Safe Integration Policy

WatchBridge should stay useful without becoming a scraper or account automation bypass tool.

## Allowed by default

- Official APIs.
- OAuth / OAuth PKCE.
- API keys where allowed.
- User-downloaded export files.
- User-uploaded import files.
- Manual workflow instructions.
- Local backups and personal archives.

## Not allowed by default

- Password collection for third-party services.
- Headless browser automation to bypass missing APIs.
- Scraping private user data.
- Circumventing bot protections, CAPTCHAs, paywalls, or rate limits.
- Recreating paid service features where the service forbids it.
- Publishing proprietary data dumps.

## Connector acceptance checklist

A connector can move from `manual` to `official-api` only when:

1. The official endpoint is documented.
2. The auth flow is documented.
3. The service permits the intended use.
4. Rate limits are respected.
5. Integration tests exist.
6. Dry-run and backup are implemented.
