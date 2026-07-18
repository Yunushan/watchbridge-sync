# syntax=docker/dockerfile:1
# node:24-bookworm-slim, pinned to its Docker Hub multi-platform manifest.
FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build

RUN --mount=type=secret,id=watchbridge_registry_ca,required=false,target=/run/secrets/watchbridge_registry_ca \
    apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates \
    && if test -s /run/secrets/watchbridge_registry_ca; then cp /run/secrets/watchbridge_registry_ca /usr/local/share/ca-certificates/watchbridge-registry-ca.crt; fi \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_OPTIONS=--use-system-ca

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/connectors/package.json packages/connectors/package.json
COPY packages/cli/package.json packages/cli/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM build AS api-dependencies

# `deploy --prod` materializes only the API package, its compiled workspace
# dependencies, and production dependencies. This keeps test/build tooling out
# of the final image while preserving pnpm's workspace resolution correctly.
RUN pnpm --filter @watchbridge/api --prod deploy /runtime

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS api

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NODE_OPTIONS=--use-system-ca \
    WATCHBRIDGE_PORT=8080 \
    WATCHBRIDGE_BACKUP_DIR=/data/backups \
    WATCHBRIDGE_JOB_DIR=/data/jobs \
    WATCHBRIDGE_OAUTH_VAULT_DIR=/data/oauth-vault

WORKDIR /app
RUN groupadd --gid 10001 watchbridge \
    && useradd --uid 10001 --gid watchbridge --create-home --shell /usr/sbin/nologin watchbridge \
    && mkdir -p /data/backups /data/jobs /data/oauth-vault \
    && chown -R watchbridge:watchbridge /data

COPY --from=api-dependencies --chown=watchbridge:watchbridge /runtime ./

USER watchbridge
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/readyz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server.js"]

# nginx:1.27-alpine, pinned to its Docker Hub multi-platform manifest.
FROM nginx:1.31-alpine@sha256:4a73073bd557c65b759505da037898b61f1be6cbcc3c2c3aeac22d2a470c1752 AS web

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/security.txt /etc/nginx/security.txt
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
USER nginx
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
ENTRYPOINT ["nginx", "-g", "daemon off;"]

# Optional public TLS edge. Certificates arrive only as Compose secrets at
# runtime, never through the build context or image layers.
FROM nginx:1.31-alpine@sha256:4a73073bd557c65b759505da037898b61f1be6cbcc3c2c3aeac22d2a470c1752 AS edge

COPY docker/nginx-edge.conf /etc/nginx/nginx.conf
EXPOSE 8080 8443
USER nginx
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/edge-healthz || exit 1
ENTRYPOINT ["nginx", "-g", "daemon off;"]
