<div align="center">

# WatchBridge Sync

**Free/open-source media data portability workspace for ratings, watched/progress state, watchlists, backups, and safe one-way or two-way sync.**

[![ci](https://github.com/Yunushan/watchbridge-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/Yunushan/watchbridge-sync/actions/workflows/ci.yml)
![version](https://img.shields.io/badge/version-0.1.0-0ea5e9)
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

WatchBridge Sync is a web/API/CLI workspace for moving user-owned media data between movie, TV, and anime tracking services, with desktop and mobile packaging notes for future clients. It focuses on safe portability: official APIs where available, user-controlled import/export files where direct writes are unavailable, dry-run previews, and durable local backups before confirmed remote writes.

The repository includes a canonical data model, rating-scale conversion, a sync planner, exhaustive runtime support metrics, tested connector and file workflows, a working Node/Hono API, a React/Vite web UI, a CLI, and platform packaging notes.

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

Run an approved connector sync through the local API with a request file. It is dry-run unless `confirmWrite` is explicitly set to `true`:

```bash
watchbridge execute-sync sync-request.json
```

See [Sync execution](docs/SYNC_EXECUTION.md) for request fields, conflict policies, and the confirmation gate.
See [OAuth setup](docs/OAUTH_SETUP.md) for the TMDb, Trakt, Simkl, MyAnimeList, Shikimori, and Annict authorization helpers, plus the caller-provided contexts required by Bangumi, Jellyfin, Emby, Kodi, and Plex.

Inspect the live, registry-derived percentages or use the dedicated file and backup workflows:

```bash
watchbridge support-summary
watchbridge import-provider-files provider-files.json
watchbridge generate-letterboxd-files backup.json selection.json
watchbridge execute-backup-sync backup-sync-request.json
watchbridge recommend recommendation-request.json
```

## Features

- Canonical media types include reviews and social relationships; shipped sync execution covers one-way and capability-gated direct-account two-way ratings, watched/progress state, and watchlists. Two-way watched reconciliation is latest-state based, not a full play-event-history merge.
- Separate provider-capability and shipped-runtime registries, so selectable, manual, metadata, file, restricted, and direct-account support cannot be confused.
- Rating conversion engine, including Letterboxd half-star ratings to IMDb 1-10 output.
- Capability-aware one-way/two-way sync planner that blocks unsupported operations and never invents an unshipped target-file generator.
- Account-to-account one-way transfers and capability-gated two-way reconciliation through the API, CLI, and web UI for implemented account connectors; requests default to dry-run and remote writes require explicit confirmation.
- Guarded non-destructive restore for saved official-connector backups.
- Eleven tested direct-account connectors: TMDb, Trakt, Simkl, MyAnimeList, Shikimori, Annict, anime-only Bangumi, user-selected Jellyfin and Emby servers, one explicitly scoped Kodi library/profile, and one selected Plex Media Server. Their registered feature sets and fidelity limits differ.
- State-verified authorization API, CLI, and web flows for TMDb, Trakt, Simkl, MyAnimeList, Shikimori, and Annict, including the supported refresh or revocation paths. Bangumi, Jellyfin, Emby, Kodi, and Plex use documented caller-provided request contexts; WatchBridge does not persist their credentials or invent a Plex sign-in helper.
- Strict API/CLI/web backup-v1 imports for IMDb, Letterboxd, and MovieLens files.
- Configurable CSV import for user-owned exports from the 13 registered manual-mapping services, without scraping or browser automation.
- Web-based one-way/two-way direct-account sync, provider-file conversion, mapped-CSV preview, strict backup upload, file-to-account sync, and authenticated pre-write backup downloads.
- Backup-first execution preflights every prepared write batch across the selected executable features before the first remote mutation. Durable jobs record `pending`, `succeeded`, or `failed` outcomes and retain pre-write backup/failure details when available.
- Metadata resolution for TMDb, TVmaze, TheTVDB, and public exact-ID Kitsu anime/manga/episode resources, plus TasteDive recommendations through the API and CLI; these do not imply user-account sync.
- Bounded outbound timeouts, safe read retries, and sanitized provider errors for connector and OAuth requests.
- API, web, and CLI applications, with desktop and mobile packaging notes rather than shipped native clients.
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
| Jellyfin |  | Bangumi |
| Emby |  | Kitsu |
| Kodi |  | Shikimori |
| Plex |  | Annict |

All **34/34 (100%)** services are selectable, but that is not 34 direct integrations. Current registry-derived coverage is **11/34 (32.4%)** direct-account platforms, **5/34 (14.7%)** with registered account read/write methods for ratings, watched/progress, and watchlist, and **27/34 (79.4%)** with at least one shipped account or file source path. The mutually exclusive workflow catalog is 11 direct-account, 3 dedicated-file, 4 metadata/recommendation, 13 manual-mapping, and 3 restricted services. TMDb overlaps the workflow view in the cross-cutting metadata/recommendation metric, which is **5/34 (14.7%)**.

Across the **102** platform × executable-feature slots, **70/102 (68.6%)** source slots are supported and **32/102 (31.4%)** are missing; **25/102 (24.5%)** have verified account writes and **77/102 (75.5%)** do not. Letterboxd adds three generated import-file targets, bringing automated target coverage to **28/102 (27.5%)** with **74/102 (72.5%)** missing. Ratings are **25/34 (73.5%)** source, **9/34 (26.5%)** account-write, and **10/34 (29.4%)** automated-target; watched/progress is **23/34 (67.6%)**, **9/34 (26.5%)**, and **10/34 (29.4%)**; watchlist is **22/34 (64.7%)**, **7/34 (20.6%)**, and **8/34 (23.5%)**. Run `watchbridge support-summary`, call `GET /v1/support-summary`, or open the web support panel for the live snapshot.

File, manual, metadata/recommendation, and restricted workflows are labeled separately. Both **2/2 (100%)** executor direction modes are shipped, but two-way requires two live direct-account connectors with registered read/write methods for every selected feature; record identity and connector fidelity checks can still reject a particular data shape, and backup/file paths remain one-way. Only **3/6 (50%)** canonical feature families execute today, so reviews/following/followers remain model-only and **0/34 (0%)** platforms register direct methods for all six.

Shikimori is the fifth full-three-feature direct connector, within strict anime/user-rate boundaries. Annict supports watched and watchlist but not ratings; Kodi supports integer ratings and completed movie/exact-episode play counts but not watchlist; Plex is ratings-only and server-scoped, with a caller-provided token and personal/non-commercial terms caveat. Jellyfin supports ratings plus completed watched state, while Emby supports only completed watched membership; favorites and likes are not counted as watchlist on either service. Kitsu is public exact-ID metadata only and contributes **0/3** account-sync features. WatchBridge can generate user-controlled Letterboxd ratings, watched, and watchlist CSV files from a strict backup through the API, CLI, or web panel; it does not sign in to or upload to Letterboxd. The IMDb-shaped ratings CSV remains a portable export helper only. See [Connector and Runtime Support](docs/CONNECTOR_CAPABILITIES.md) and [Import and Export Formats](docs/IMPORT_EXPORT_FORMATS.md).

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
7. Keep rating-scale rules explicit in plans and conversion previews.
8. Clearly label blocked, manual, and partner-only operations.

More details: [docs/TERMS_SAFE_INTEGRATION.md](docs/TERMS_SAFE_INTEGRATION.md).

## Architecture

```text
apps/web                  React/Vite web UI
apps/api                  Node/Hono API for OAuth, sync jobs, backups, metadata, and recommendations
apps/desktop              Desktop packaging notes
apps/mobile               Android/iOS packaging notes
packages/core             Canonical model, rating conversion, runtime registry, planner, support metrics
packages/connectors       Official account/metadata adapters, executor, backup schema, safe file workflows
packages/cli              CLI for planning, import, OAuth, sync, restore, metadata, and recommendations
configs                   Service registry, policies, and defaults
docs                      Architecture, deployment, safety, and roadmap docs
```

## Project Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Connector capabilities](docs/CONNECTOR_CAPABILITIES.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Example syncs](docs/EXAMPLE_SYNCS.md)
- [Import/export formats](docs/IMPORT_EXPORT_FORMATS.md)
- [Manual CSV import](docs/MANUAL_CSV_IMPORT.md)
- [OAuth setup](docs/OAUTH_SETUP.md)
- [Rating mapping](docs/RATING_MAPPING.md)
- [Roadmap](docs/ROADMAP.md)
- [Supported platforms](docs/SUPPORTED_PLATFORMS.md)
- [Sync execution](docs/SYNC_EXECUTION.md)
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
