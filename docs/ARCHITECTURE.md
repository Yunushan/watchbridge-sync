# Architecture

WatchBridge uses a hub-and-adapter design. Account connectors, provider-file readers, and mapped CSV all produce the same canonical records; only a registered account connector may perform a remote user-data write.

## Runtime surfaces

| Surface | Current responsibility |
|---|---|
| `apps/web` | One-way/two-way planner and support percentages, six-provider OAuth helpers (including Shikimori and Annict), eleven-connector direct-account sync, dedicated provider-file conversion, canonical-backup sync, authenticated pre-write backup downloads, Letterboxd target-file downloads, and mapped-CSV preview/download. |
| `apps/api` | Six-provider OAuth exchanges/refresh or revocation, account/backup execution, durable jobs and downloadable backups, provider-file conversion, Letterboxd target-file generation, metadata resolution, recommendations, and rating conversion. |
| `packages/cli` | Offline planning/import/Letterboxd file generation plus API clients for OAuth (including Shikimori and Annict), sync, restore, metadata, and recommendations. |
| `packages/core` | Canonical types, identity matching, rating conversion, provider capabilities, exhaustive shipped-runtime registry, planner, and support-summary metrics. |
| `packages/connectors` | Official account/metadata adapters, resilient HTTP client, strict backup schema, dedicated/mapped file readers, conflict handling, sync executor, and restore executor. |

`apps/desktop` and `apps/mobile` currently contain packaging notes, not shipped native applications.

## User-data paths

```text
authorized source account ─┐
dedicated provider files ──┼─> validated canonical backup ─┬─> match/conflict plan ─> authorized target account
user-mapped CSV ───────────┘                                └─> Letterboxd CSV chunks ─> user-controlled web import
```

Direct account-to-account execution uses `POST /v1/sync/execute`. Dedicated IMDb, Letterboxd, and MovieLens files become a strict `watchbridge.backup.v1` archive through `POST /v1/import/provider-files`; mapped CSV uses `POST /v1/import/mapped-csv`. A validated archive becomes an executable source through `POST /v1/sync/from-backup`. Separately, `POST /v1/export/letterboxd-files` turns representable movie records into bounded CSV chunks; it ends with a user download and manual Letterboxd web import, not a remote connector write.

Account execution may be one-way or two-way. Two-way reconciliation is available only between two live direct-account connectors when both sides have registered account read and write methods for every selected feature. This is an executor-mode and method check, not universal pair compatibility: identity matching and connector-specific fidelity validation can still reject a record shape. Canonical backup, dedicated-file, mapped-file, metadata-only, restricted, and same-service paths cannot become two-way plans.

TMDb, TVmaze, TheTVDB, and exact-ID Kitsu metadata resolution plus TasteDive recommendations are separate read-only paths. They do not enter the user-data sync executor and do not imply ratings, history, watchlist, review, or social support. Kitsu performs public unauthenticated anime/manga/episode resource-by-ID reads only and contributes no account source or target slot.

## Confirmed-write lifecycle

```text
strict request
  -> persist pending audit job
  -> authorize connectors and export source/target snapshots
  -> match, deduplicate, and resolve conflicts
  -> persist the target snapshot (and source snapshot for two-way)
  -> preflight every prepared feature/direction batch without remote mutation
  -> apply confirmed remote writes
  -> persist succeeded or failed audit state
```

- Requests default to dry-run; a remote write also requires `confirmWrite: true`.
- If the pending audit job cannot be created, execution does not start.
- Dry-runs export both sides and preview actions but do not persist a pre-write artifact or mutate the provider.
- Confirmed one-way writes persist a downloadable target backup before preflight or mutation. Confirmed two-way writes persist downloadable snapshots of both accounts.
- All prepared feature/direction batches are preflighted before the first mutation. Each official connector also validates a complete batch before sending it.
- A provider/network failure after mutation starts may leave a partial remote write. The failed job records the failed feature and direction, completed actions, `writeMayBePartial`, and source/target backup artifacts when available; the response additionally reports whether a retry is considered safe.
- The web result panels download these artifacts with same-origin, credentialless requests. If the API is protected, the in-memory WatchBridge API key is sent as a Bearer header; the browser validates the backup identifier, bounds the response, and requires a `watchbridge.backup.v1` JSON document before saving it.
- Restore is additive and same-service. It reapplies a saved connector backup but does not delete entries created after that snapshot. Cross-service movement uses the backup-to-account path.

## Canonical model and matching

The executable archive preserves service ownership, rating value and scale, timestamps, external IDs, watched status, progress, play/replay count, watchlist timestamps, and optional raw files. Reviews, following, and followers exist in the broader core model but are not part of backup v1 or the executor.

Matching follows these rules:

1. Prefer a shared, kind-compatible external ID.
2. Otherwise require an exact normalized title, year, and media kind match.
3. Season and episode fallback also requires the same season/episode coordinates.
4. Never silently guess a write when identity is ambiguous.

Conflicts use an explicit policy: `manual` (default), `source-wins`, `target-wins`, or `newest-wins`. Duplicate watchlist records are skipped. Timestamp comparison drives `newest-wins`; watched ties can use progress, plays, and status as deterministic fallbacks.

## Scope boundaries

- The executable feature families are ratings, watched/progress, and watchlist. Reviews, following, and followers remain model-only.
- Both one-way and capability-gated two-way account execution are shipped. Same-service sync remains blocked; same-service backup restore is a separate guarded operation.
- A selectable catalog entry is not necessarily a connector. The runtime registry separates direct-account, dedicated-file, manual-mapping, metadata/recommendation, and restricted workflows.
- Letterboxd is the only registered target-specific import-file generator, covering ratings, watched, and watchlist movies. Every other unsupported target still ends at a canonical backup/manual action.
- Request contexts cannot redirect provider connectors, metadata resolvers, or recommendations to custom `baseUrl`, `v3BaseUrl`, or `v4BaseUrl` values by default. Such a request is rejected before any provider fetch; the tightly constrained owner opt-in and SSRF implications are documented in [Deployment](DEPLOYMENT.md). Jellyfin, Emby, and Kodi require explicit owner-controlled HTTPS `baseUrl` values, so production use also requires that exact owner opt-in plus outbound network allowlisting. Plex instead discovers HTTPS connections from the authenticated Plex resources service and verifies the selected machine ID; outbound allowlisting still applies. Favorites/likes are not modeled as watchlist on Jellyfin or Emby; Emby registers only completed movie/exact-episode watched membership and blocks ratings.
- Shikimori and Annict use fixed official origins and state-verified OAuth helper flows. Bangumi still takes a separately obtained token. Plex currently takes a caller-provided account token and has no sign-in helper. Kitsu sends no authentication because its shipped path is public exact-ID metadata only.
- The file-backed API runtime is designed for one process. Shared transactional storage and a durable token vault are still required before horizontal scaling.
