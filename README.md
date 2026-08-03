<div align="center">

# WatchBridge Sync

**Free/open-source media data portability workspace for ratings, watched/progress state, watchlists, reviews, following/followers, backups, and safe one-way or two-way sync.**

[![ci](https://github.com/Yunushan/watchbridge-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/Yunushan/watchbridge-sync/actions/workflows/ci.yml)
![version](https://img.shields.io/badge/version-0.1.0-0ea5e9)
![license](https://img.shields.io/github/license/Yunushan/watchbridge-sync)

Release archive checksum and provenance verification are documented in [Release verification](docs/RELEASES.md).
Production metrics, Prometheus scraping, and alert rules are documented in [Deployment](docs/DEPLOYMENT.md).
The complete repository-versus-deployment readiness gate is in [Production readiness](docs/PRODUCTION_READINESS.md).
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
npm install --global pnpm@9.15.0
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm smoke:production-capacity
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
watchbridge cleanup-storage cleanup-request.json
```

## Features

- All six canonical families—ratings, watched/progress state, watchlists, reviews, following, and followers—round-trip through backup v1 and the executor. Provider methods remain capability-gated: social usernames are provider-scoped, following is additive and same-service only, and followers are intrinsically read-only. Two-way watched reconciliation is latest-state based, not a full play-event-history merge.
- Separate provider-capability and shipped-runtime registries, so selectable, manual, metadata, file, restricted, and direct-account support cannot be confused.
- Rating conversion engine, including Letterboxd half-star ratings to IMDb 1-10 output.
- Capability-aware one-way/two-way sync planner that blocks unsupported operations and never invents an unshipped target-file generator.
- Account-to-account one-way transfers and capability-gated two-way reconciliation through the API, CLI, and web UI for implemented account connectors; requests default to dry-run and remote writes require explicit confirmation.
- Guarded non-destructive restore for saved official-connector backups.
- Thirteen tested direct-account connectors: TMDb, Trakt, Simkl, MyAnimeList, Shikimori, Annict, anime-only Bangumi, user-selected Jellyfin and Emby servers, one explicitly scoped Kodi library/profile, one selected Plex Media Server, a user-selected Movary API server/account, and AniList. AniList supports exact-ID anime/manga media-list ratings, watched/progress, planned watchlists, reviews, and a guarded social graph; Movary is movie-only and preserves only dated single-play history and watchlist membership. Their registered feature sets and fidelity limits differ.
- State-verified authorization API, CLI, and web flows for TMDb, Trakt, Simkl, MyAnimeList, Shikimori, and Annict, including the supported refresh or revocation paths. Bangumi, Jellyfin, Emby, Kodi, Plex, and Movary use documented caller-provided request contexts; WatchBridge does not persist their credentials or invent a third-party sign-in helper.
- Strict API/CLI/web backup-v1 imports for IMDb, Letterboxd, MovieLens, and Ryot files.
- Configurable CSV import for user-owned exports from the 13 registered manual-mapping services, without scraping or browser automation.
- Web-based one-way/two-way direct-account sync, provider-file conversion, mapped-CSV preview, strict backup upload, file-to-account sync, and authenticated pre-write backup downloads.
- Backup-first execution preflights every prepared write batch across the selected executable features before the first remote mutation. Durable jobs record `pending`, `succeeded`, or `failed` outcomes and retain pre-write backup/failure details when available.
- Opt-in backup/job retention with dry-run cleanup, explicit deletion confirmation, pending-job protection, and reference-safe backup preservation.
- Metadata resolution for TMDb, exact-IMDb-ID OMDb, Watchmode, MDBList movie lookups, TVmaze, TheTVDB, and public exact-ID Kitsu anime/manga/episode resources, plus TasteDive recommendations through the API, CLI, and web panel; these do not imply user-account sync. OMDb content and usage carry non-commercial terms constraints.
- Bounded outbound timeouts, safe read retries, and sanitized provider errors for connector and OAuth requests.
- API, web, and CLI applications, with desktop and mobile packaging notes rather than shipped native clients.
- CI workflow for locked install, lint, test, build, source compatibility on Ubuntu/Windows/macOS, encrypted recovery verification, capacity smoke, container hardening, vulnerability scanning, and TLS/proxy validation.
- Full README support in English, Turkish, French, and German.

## Supported Services

WatchBridge Sync is designed around connector capabilities for:

| Movies and TV | Metadata and discovery | Anime and international |
|---|---|---|
| IMDb | TMDb | MyAnimeList |
|  | OMDb |  |
|  | MDBList |  |
| Rotten Tomatoes | TheTVDB | AniList |
| Letterboxd | TVmaze | Douban Movie |
| Trakt | JustWatch | Kinopoisk |
| Simkl | Reelgood |  |
| TV Time | AllMovie |  |
| Metacritic | Criticker |  |
| MovieLens | Flickchart |  |
| Ryot |  |  |
| FilmAffinity | TasteDive |  |
| Serializd | Taste.io |  |
| MUBI | Common Sense Media |  |
| Jellyfin |  | Bangumi |
| Emby |  | Kitsu |
| Kodi |  | Shikimori |
| Plex |  | Annict |

All **40/40 (100%)** catalog entries are selectable, but that is not 40 direct integrations. Current registry-derived coverage is **13/40 (32.5%)** direct-account platforms, **7/40 (17.5%)** with registered account read/write methods for the primary ratings, watched/progress, and watchlist families, and **30/40 (75%)** with at least one shipped account or file source path. Trakt and AniList are the **2/40 (5%)** direct platforms that read all six families and write every mutable family; followers are read-only by design. The mutually exclusive workflow catalog is 13 direct-account, 4 dedicated-file, 8 metadata/recommendation, 13 manual-mapping, and 2 restricted services. TMDb overlaps that workflow view in the cross-cutting metadata/recommendation metric, which is **9/40 (22.5%)**.

Across the **240** platform × canonical-family slots, **127/240 (52.9%)** source slots are supported and **113/240 (47.1%)** are missing; **36/240 (15%)** have verified account writes and **204/240 (85%)** do not. Letterboxd's generated import files raise automated target coverage to **40/240 (16.7%)**, with **200/240 (83.3%)** missing. Ratings are **26/40 (65%)** source, **10/40 (25%)** account-write, and **11/40 (27.5%)** automated-target; watched/progress is **28/40 (70%)**, **12/40 (30%)**, and **13/40 (32.5%)**; watchlist is **26/40 (65%)**, **10/40 (25%)**, and **11/40 (27.5%)**; reviews are **17/40 (42.5%)**, **2/40 (5%)**, and **3/40 (7.5%)**; following is **15/40 (37.5%)**, **2/40 (5%)**, and **2/40 (5%)**; followers are **15/40 (37.5%)**, **0/40 (0%)**, and **0/40 (0%)**. Run `watchbridge support-summary`, call `GET /v1/support-summary`, or open the web support panel for the live snapshot.

File, manual, metadata/recommendation, and restricted workflows are labeled separately. All **6/6 (100%)** canonical families and both **2/2 (100%)** executor direction modes are shipped. That does not make every provider pair writable: two-way requires two live direct-account connectors with registered read/write methods for every selected feature, following is never inferred across providers, followers have no valid write direction, record identity and fidelity checks can reject a particular shape, and backup/file paths remain one-way.

Trakt reads ratings, watched, watchlist, current-user reviews, following, and followers; it writes the first four plus additive following under strict provider checks. Shikimori remains anime/user-rate bounded; Annict supports watched and watchlist but not ratings. Kodi now adds a managed movie watchlist through a library-scoped WatchBridge tag alongside integer ratings and completed movie/exact-episode play counts. Plex is server-scoped ratings plus completed played membership, with a caller-provided token and personal/non-commercial terms caveat. Movary is exact-ID movie history and watchlist only on an owner-selected HTTPS `/api/` server; it rejects replay/progress state and list timestamps it cannot round-trip. Jellyfin supports ratings plus completed watched state, while Emby supports only completed watched membership; favorites and likes are not counted as watchlist on either service. IMDb dedicated files cover ratings, Check-ins watched membership, and watchlist; Letterboxd files and generated targets cover ratings, watched, watchlist, and reviews; Ryot CompleteExport files cover watched/list state and review text with known provider IDs. OMDb, Watchmode, MDBList, Wikidata, TVmaze, TheTVDB, Kitsu, and TasteDive are metadata/recommendation-only and contribute no account-sync slots. MDBList is limited to exact movie metadata by TMDb ID and a request-scoped API key. See [Connector and Runtime Support](docs/CONNECTOR_CAPABILITIES.md) and [Import and Export Formats](docs/IMPORT_EXPORT_FORMATS.md).

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
- [GitHub governance](docs/GITHUB_GOVERNANCE.md)
- [Operations runbook](docs/OPERATIONS_RUNBOOK.md)
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

`pnpm test` includes the operational tests and workspace V8 coverage thresholds. Coverage summaries are written under each workspace's ignored `coverage/` directory and retained by CI.

For an operator recovery check, provide `WATCHBRIDGE_STORAGE_KEY` through the environment and run `node scripts/verify-storage-snapshot.mjs` against a restored data copy. The verifier rejects plaintext or tampered records and can emit a non-secret checksum manifest; see [Operations Runbook](docs/OPERATIONS_RUNBOOK.md).

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

0BSD. See [LICENSE](LICENSE).
