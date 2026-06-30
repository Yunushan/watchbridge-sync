# Deployment

## Local developer mode

```bash
pnpm install
pnpm dev
```

## Server mode

```bash
docker compose up -d postgres redis
pnpm --filter @watchbridge/api build
WATCHBRIDGE_PORT=8080 node apps/api/dist/server.js
```

## Production recommendations

- Put the API behind HTTPS.
- Use OAuth PKCE where possible.
- Encrypt tokens at rest.
- Rotate app secrets.
- Use PostgreSQL for multi-user deployments.
- Use object storage for backup archives.
- Add rate limiting per service connector.
- Keep a legal-safe connector policy enabled by default.
