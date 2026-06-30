# WatchBridge Sync

**WatchBridge Sync** is a free/open-source, MIT-licensed media data portability and synchronization workspace for movie, TV, and anime tracking accounts.

It is designed to sync and export/import user-owned data such as ratings, watched history, watchlists, lists, reviews, follows, followers, and backup copies across supported services when official APIs, user exports, or user-authorized imports make that possible.

> Safety stance: WatchBridge Sync does **not** ship site-scraping, credential stuffing, browser automation, or ToS-bypass logic. Each connector declares whether it supports official API sync, file import/export, read-only metadata lookup, or manual workflow.

## Target services

This repository includes connector definitions for the original 20-site set plus IMDb, Rotten Tomatoes, Letterboxd, TMDb, and TV Time:

- IMDb
- Rotten Tomatoes
- Letterboxd
- TMDb
- TV Time
- Trakt
- Simkl
- Metacritic
- JustWatch
- Reelgood
- Serializd
- TheTVDB
- TVmaze
- AllMovie
- Criticker
- MovieLens
- FilmAffinity
- Flickchart
- TasteDive
- Taste.io
- MUBI
- Common Sense Media
- MyAnimeList
- AniList
- Douban Movie
- Kinopoisk

## Repository name

Recommended GitHub repository name:

```text
watchbridge-sync
```

Alternative names:

```text
media-bridge-sync
cinebridge
watchmesh
ratingbridge
```

## What works in the starter

The starter repository contains:

- canonical data model for movies, TV shows, seasons, episodes, anime, ratings, reviews, watched history, watchlists, follows, and followers;
- connector capability registry for the supported services;
- rating-scale conversion engine;
- sync planner that prevents unsupported operations;
- CSV/import-export primitives;
- API service skeleton;
- web app skeleton;
- desktop/mobile packaging notes;
- CI workflow;
- docs for platform support, legal-safe integrations, capability matrix, and roadmap.

## Example: Letterboxd rating to IMDb rating

Letterboxd ratings are represented internally on a 0-5 scale with half-star precision. IMDb uses a 1-10 rating scale. WatchBridge doubles the normalized Letterboxd rating when syncing to IMDb-compatible output:

```ts
letterboxd 4.5 / 5 -> imdb 9 / 10
letterboxd 3.0 / 5 -> imdb 6 / 10
letterboxd 5.0 / 5 -> imdb 10 / 10
```

See [`packages/core/src/ratingScale.ts`](packages/core/src/ratingScale.ts).

## Architecture

```text
apps/web                  React/Vite web UI and PWA shell
apps/api                  Node API server for OAuth callbacks and sync jobs
apps/desktop              Tauri/Electron packaging notes for desktop builds
apps/mobile               Capacitor/React Native packaging notes for Android/iOS
packages/core             canonical model, rating conversion, sync planner
packages/connectors       service adapter interfaces and connector stubs
packages/cli              command-line interface for import/export/sync
configs                   service registry, policies, and default settings
docs                      production, connector, legal, and platform docs
```

## Cross-platform target

| Platform | Target mode |
|---|---|
| Web | PWA-capable web app |
| Windows | Desktop app + CLI + server |
| Windows Server | API/server + CLI |
| Linux | Desktop app + CLI + server |
| BSD | CLI/server/web deployment; native desktop is best-effort depending on WebView/Electron/Tauri support |
| Android | Mobile wrapper around the web UI or React Native app |
| iOS | Mobile wrapper around the web UI or React Native app |

## First install

```bash
corepack enable
pnpm install
pnpm test
pnpm lint
pnpm dev
```

## Create the GitHub repository

After extracting this starter:

```bash
git init
git add .
git commit -m "Initial WatchBridge Sync MIT project"
gh repo create watchbridge-sync --public --source=. --remote=origin --push
```

## Production principles

1. Prefer official APIs.
2. Prefer user-authenticated OAuth.
3. Prefer export/import files when direct write APIs are unavailable.
4. Never store raw passwords.
5. Never bypass paywalls, anti-bot systems, or service terms.
6. Always create a downloadable local backup before writing to a target service.
7. Always support dry-run mode before sync.
8. Always show rating-scale transformations before applying them.

## License

MIT. See [`LICENSE`](LICENSE).
