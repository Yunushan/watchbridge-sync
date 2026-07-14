<div align="center">

# WatchBridge Sync

**Free/open-source media data portability workspace for ratings, watched history, watchlists, reviews, follows, followers, backups, and safe sync planning.**

[![ci](https://github.com/Yunushan/watchbridge-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/Yunushan/watchbridge-sync/actions/workflows/ci.yml)
![release](https://img.shields.io/badge/release-v0.1.0-0ea5e9)
![license](https://img.shields.io/github/license/Yunushan/watchbridge-sync)
![node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9-f69220?logo=pnpm&logoColor=white)

![typeScript](https://img.shields.io/badge/TypeScript-core-3178c6?logo=typescript&logoColor=white)
![react](https://img.shields.io/badge/web-React%20%7C%20Vite-61dafb?logo=react&logoColor=111827)
![api](https://img.shields.io/badge/api-Node%20%7C%20Hono-111827)
![connectors](https://img.shields.io/badge/connectors-safe%20API%20%2F%20import%20%2F%20export-22c55e)

![language-en](https://img.shields.io/badge/README-English%20100%25-2563eb)
![language-tr](https://img.shields.io/badge/README-Turkish%20100%25-dc2626)
![language-fr](https://img.shields.io/badge/README-French%20100%25-7c3aed)
![language-de](https://img.shields.io/badge/README-German%20100%25-111827)

[English](README.md) - [Turkish](README.tr.md) - [French](README.fr.md) - [German](README.de.md)

[Quick Start](#quick-start) - [Features](#features) - [Supported Services](#supported-services) - [Safety Model](#safety-model) - [Architecture](#architecture) - [Contributing](#contributing) - [License](#license)

</div>

WatchBridge Sync is a desktop/web/API/CLI workspace for moving user-owned media data between movie, TV, and anime tracking services. It focuses on safe portability: official APIs where available, user-controlled import/export files where direct writes are unavailable, dry-run sync plans before writes, and local backups before any destructive operation.

The repository currently includes a canonical data model, rating-scale conversion, a sync planner, connector capability registry, CSV helpers, a Node API skeleton, a React/Vite web UI, a CLI, and platform packaging notes.

## Quick Start

```bash
corepack enable
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm dev
```

Useful commands:

```bash
pnpm --filter @watchbridge/core test
pnpm --filter @watchbridge/api dev
pnpm --filter @watchbridge/web dev
pnpm --filter @watchbridge/cli build
```

## Features

- Canonical media model for movies, TV shows, seasons, episodes, anime, ratings, reviews, watched history, watchlists, follows, and followers.
- Connector capability registry that marks what each service can safely read, write, import, export, or handle manually.
- Rating conversion engine, including Letterboxd half-star ratings to IMDb 1-10 output.
- Sync planner that blocks unsupported operations and explains safe alternatives.
- Tested official API connectors for TMDb, Trakt, Simkl, and MyAnimeList, plus dedicated IMDb, Letterboxd, and MovieLens file workflows.
- Configurable CSV import for user-owned exports from manual/export-only services, without scraping or browser automation.
- API, web, CLI, desktop, and mobile workspace structure.
- CI workflow for install, lint, test, and build validation.
- Full README support in English, Turkish, French, and German.

## Supported Services

WatchBridge Sync is designed around connector capabilities for:

| Movies and TV | Metadata and discovery | Anime and international |
|---|---|---|
| IMDb | TMDb | MyAnimeList |
| Rotten Tomatoes | TheTVDB | AniList |
| Letterboxd | TVmaze | Douban Movie |
| Trakt | JustWatch | Kinopoisk |
| Simkl | Reelgood |  |
| TV Time | AllMovie |  |
| Metacritic | Criticker |  |
| MovieLens | Flickchart |  |
| FilmAffinity | TasteDive |  |
| Serializd | Taste.io |  |
| MUBI | Common Sense Media |  |

All 26 services are selectable. Account-level sync is currently available for TMDb, Trakt, Simkl, and MyAnimeList; file and metadata-only workflows are clearly labeled. Support depends on each service's official API, account export, account import, partner access, and terms. See [docs/CONNECTOR_CAPABILITIES.md](docs/CONNECTOR_CAPABILITIES.md) and [Manual CSV Import](docs/MANUAL_CSV_IMPORT.md).

## Rating Example

Letterboxd ratings use a 0.5-5 star scale. IMDb uses 1-10. WatchBridge keeps this transformation visible before export or sync:

```text
Letterboxd 4.5 / 5 -> IMDb 9 / 10
Letterboxd 3.0 / 5 -> IMDb 6 / 10
Letterboxd 5.0 / 5 -> IMDb 10 / 10
```

Implementation: [packages/core/src/ratingScale.ts](packages/core/src/ratingScale.ts).

## Safety Model

WatchBridge Sync does not ship site-scraping, credential stuffing, browser automation, password collection, paywall bypass, anti-bot bypass, or Terms-of-Service bypass logic.

Production principles:

1. Prefer official APIs.
2. Prefer user-authenticated OAuth or API tokens.
3. Prefer user-controlled export/import files when direct write APIs are unavailable.
4. Never store raw passwords.
5. Always support dry-run mode before sync.
6. Always create a downloadable local backup before writing to a target service.
7. Always show rating-scale transformations before applying them.
8. Clearly label blocked, manual, and partner-only operations.

More details: [docs/TERMS_SAFE_INTEGRATION.md](docs/TERMS_SAFE_INTEGRATION.md).

## Architecture

```text
apps/web                  React/Vite web UI and PWA shell
apps/api                  Node API server for OAuth callbacks and sync jobs
apps/desktop              Desktop packaging notes
apps/mobile               Android/iOS packaging notes
packages/core             Canonical model, rating conversion, sync planner
packages/connectors       Service adapters, official API connectors, and safe file workflows
packages/cli              Command-line interface for import/export/sync
configs                   Service registry, policies, and defaults
docs                      Architecture, deployment, safety, and roadmap docs
```

## Project Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Connector capabilities](docs/CONNECTOR_CAPABILITIES.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Example syncs](docs/EXAMPLE_SYNCS.md)
- [Import/export formats](docs/IMPORT_EXPORT_FORMATS.md)
- [Rating mapping](docs/RATING_MAPPING.md)
- [Roadmap](docs/ROADMAP.md)
- [Supported platforms](docs/SUPPORTED_PLATFORMS.md)
- [Terms-safe integration](docs/TERMS_SAFE_INTEGRATION.md)

## Contributing

Contributions are welcome when they follow the safety model. Good first areas include connector capability metadata, import/export formats, tests, docs, UI flows, and platform packaging.

Before opening a change:

```bash
pnpm lint
pnpm test
pnpm build
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
