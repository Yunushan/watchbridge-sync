# Sync Execution

`POST /v1/sync/execute` runs only the eleven shipped direct-account connectors: TMDb, Trakt, Simkl, MyAnimeList, anime-only Shikimori, anime-only Annict, anime-only Bangumi, a user-selected Jellyfin server, a watched-only user-selected Emby server, one scoped Kodi library/profile, and one selected Plex Media Server. Their registered feature sets differ; file, metadata/recommendation, manual, and restricted workflows use separate paths.

Executable selections are ratings, watched/progress state, and watchlists, subject to each connector's runtime profile. Reviews, following, followers, and same-service plans are rejected. `direction: "one-way"` is the default; `direction: "two-way"` is accepted only for two live direct-account connectors with registered account read and write methods for every selected feature. That mode check does not guarantee that every record has shared target identity or a lossless provider representation. The canonical model containing a field does not imply a shipped sync path.

`POST /v1/metadata/resolve` exposes metadata-only candidates for TMDb, TVmaze, TheTVDB, and Kitsu. TheTVDB context must contain the authorized project `apiKey` and, when applicable, `subscriberPin`. Kitsu is unauthenticated and exact-ID only: the item must be anime, manga, or episode with a positive integer `externalIds.kitsu`; WatchBridge does not turn its title into search, Algolia, mapping, or account-library traffic.

Use `watchbridge resolve-metadata metadata-request.json` to submit the same request to the local API.

`POST /v1/recommendations` exposes read-only TasteDive recommendations for one strictly validated canonical movie or TV item. Use `watchbridge recommend recommendation-request.json` for the same API path. Metadata and recommendations do not imply access to user ratings, history, or watchlists.

Obtain request-scoped TMDb, Trakt, Simkl, MyAnimeList, Shikimori, and Annict credentials through the API/CLI/web flows in [OAuth setup](OAUTH_SETUP.md). The authorization API returns tokens and sessions but deliberately does not persist them. Bangumi has no dedicated WatchBridge helper: obtain an official token separately and pass an `accessToken` plus a compliant developer/application `userAgent`. Jellyfin and Emby likewise take server-issued tokens and explicit HTTPS server URLs, with Emby also requiring the selected user's `accountId`. Kodi takes request-scoped HTTP Basic credentials, profile name, library-scope UUID, and an explicit HTTPS `/jsonrpc` URL. Plex takes a caller-provided account token, stable client identifier, selected server machine ID, and identifying client fields; no Plex token helper is shipped.

## Canonical backup to account

`POST /v1/sync/from-backup` makes a validated `watchbridge.backup.v1` archive the source of a normal backup-first sync. This connects mapped CSV and dedicated file workflows to the implemented official targets instead of stopping at preview/download. Create dedicated IMDb, Letterboxd, or MovieLens archives with `POST /v1/import/provider-files` or the offline `watchbridge import-provider-files manifest.json` command; the exact manifests are in [Import and Export Formats](IMPORT_EXPORT_FORMATS.md).

```json
{
  "backup": {
    "schema": "watchbridge.backup.v1",
    "service": "letterboxd",
    "exportedAt": "2026-07-15T00:00:00Z",
    "ratings": [],
    "watched": [],
    "watchlist": []
  },
  "target": "trakt",
  "selection": { "ratings": true, "watched": true, "watchlist": true },
  "dryRun": true,
  "conflictPolicy": "manual",
  "targetContext": {
    "accessToken": "trakt-user-token",
    "apiKey": "trakt-client-id"
  }
}
```

Save that envelope as `backup-sync-request.json` and run `watchbridge execute-backup-sync backup-sync-request.json`. The same confirmation gate, target backup, conflict handling, and job history used by direct account sync apply here.

### Canonical backup to Letterboxd files is a separate handoff

Letterboxd has no shipped account connector, so it is not a target for `/v1/sync/from-backup`. Use `POST /v1/export/letterboxd-files`, `watchbridge generate-letterboxd-files backup.json selection.json`, or the web **Canonical backup to Letterboxd import files** panel instead. This path validates the same strict archive and generates movie-only ratings, watched, and/or watchlist CSV chunks of at most 1,000,000 UTF-8 bytes each. The user then verifies matches and uploads the files through Letterboxd's web importers. It creates no sync job, takes no Letterboxd credentials, performs no account write, and does not make the transfer two-way. Exact columns and lossy-input rejections are documented in [Import and Export Formats](IMPORT_EXPORT_FORMATS.md).

The execution sequence is:

1. Persist a `pending` audit job. If this fails, execution does not start.
2. For account-to-account sync, authenticate and export both live accounts. For backup sync, validate and use the supplied archive without source credentials or a source network call.
3. Match records by shared external ID, or by an exact normalized title, year, and media kind, then apply the selected conflict policy.
4. For a confirmed write, persist the target snapshot and, for two-way execution, the source snapshot before any feature processing can mutate either provider.
5. Preflight every prepared feature/direction batch without remote mutation.
6. Return the dry-run preview or apply only verified directional writes, then finalize the job as `succeeded` or `failed`.

## Dry-run request

Save a request like this as `sync-request.json`; credentials are placeholders and must not be committed.

```json
{
  "source": "trakt",
  "target": "simkl",
  "selection": { "ratings": true, "watched": true, "watchlist": true },
  "dryRun": true,
  "conflictPolicy": "manual",
  "sourceContext": {
    "accessToken": "source-oauth-token",
    "apiKey": "source-client-id"
  },
  "targetContext": {
    "accessToken": "target-oauth-token",
    "apiKey": "target-client-id"
  }
}
```

Run it locally:

```bash
watchbridge execute-sync sync-request.json
```

The CLI planner accepts the same direction explicitly, for example `watchbridge plan trakt simkl ratings two-way`. The web planner and account-sync panel expose one-way and two-way choices from the same runtime registry.

## Two-way account reconciliation

Set `"direction": "two-way"` on an account-sync request:

```json
{
  "source": "trakt",
  "target": "simkl",
  "selection": { "ratings": true, "watched": true, "watchlist": true },
  "direction": "two-way",
  "dryRun": true,
  "conflictPolicy": "newest-wins",
  "sourceContext": { "accessToken": "trakt-token", "apiKey": "trakt-client-id" },
  "targetContext": { "accessToken": "simkl-token", "apiKey": "simkl-client-id" }
}
```

Two-way execution exports both accounts once, deduplicates each selected feature, and prepares missing or winning records in each direction. Repeated same-item watched events are reconciled as the latest watched/progress state; this is not a full play-event-history merge. Matching watchlist membership is never echoed back. `manual` leaves conflicting matches unchanged, `source-wins` and `target-wins` use the names in the request, and `newest-wins` compares timestamps with watched progress/plays/status as deterministic fallbacks; an unresolved tie does not invent a winner. Every action includes its source/target direction.

Two-way is rejected if either side lacks account read or write support for any selected feature, if either service is not a live direct-account connector, or if a canonical backup is supplied as the source. Reviews, following, and followers remain model-only. For a confirmed two-way run, both account snapshots must be persisted successfully before directional preflight or mutation begins.

If the server has `WATCHBRIDGE_API_KEY` set, the CLI reads the same environment variable and sends it as an `Authorization: Bearer <key>` header. Do not put the server key in a committed sync request.

The response contains source and target backups plus feature-level preview, conflict, and skip counts; two-way actions also identify their source/target direction. Credentials are never included in the response or persisted by the API.

Every account sync, backup-source sync, and restore first writes a minimal `pending` job report to `WATCHBRIDGE_JOB_DIR` (or `.watchbridge-jobs`). A completed operation finalizes it as `succeeded`; an execution/preflight error finalizes it as `failed`. Reports contain source/target, timestamps, direction, dry-run state, conflict policy, actions, status, and available source/target backup artifact IDs—never access tokens or exported media entries. Failed reports also retain the sanitized error, failed feature and direction when known, and `writeMayBePartial` state. Retrieve reports using `GET /v1/sync/jobs` or `GET /v1/sync/jobs/:id`.

Failure responses include the durable job, completed/partial actions and available source/target backup artifacts, plus `retrySafe`. If a provider call fails after mutation begins, `writeMayBePartial` is true and every saved pre-write backup should be inspected before retrying. If final audit persistence itself fails, the API returns an `auditWarning` rather than silently claiming a durable final state.

## Confirmed write

After reviewing the dry-run result, change only these fields:

```json
{
  "dryRun": false,
  "confirmWrite": true
}
```

The API rejects non-dry-runs without `confirmWrite: true`. Before preflight or imports begin, it saves the target backup to `WATCHBRIDGE_BACKUP_DIR` (or `.watchbridge-backups` in the process directory) and returns its `targetBackupArtifact.id`; a confirmed two-way run also returns `sourceBackupArtifact.id`. Download either from `GET /v1/backups/:id`. Every prepared feature/direction batch is then validated through the connector's non-mutating dry-run path before the first actual provider write. Conflict policy defaults to `manual`; other explicit choices are `source-wins`, `target-wins`, and `newest-wins`.

The account-sync web result exposes target and two-way source backup download buttons; the backup-sync panel exposes the target backup. The browser uses a same-origin GET with browser credentials omitted and, when entered, sends the in-memory WatchBridge API key as `Authorization: Bearer`. It validates the UUID, enforces a 50 MiB streaming bound, and accepts only UTF-8 JSON marked `watchbridge.backup.v1` before creating the local download. The API returns plaintext canonical JSON even when its file-backed storage is encrypted at rest.

## Provider URL boundary

The optional API URL accepted by CLI commands is the WatchBridge server address; it is not a provider override. Request-supplied connector or recommendation `baseUrl`, `v3BaseUrl`, and `v4BaseUrl` fields are rejected before any provider fetch by default. Tests may use them under `NODE_ENV=test`; an owner may opt in outside tests only with exact lowercase `WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true`. Even then, values are limited to 2,000 characters and must be valid HTTPS URLs without credentials, query, or fragment. Credential-bearing connector requests disable automatic redirects and reject 3xx responses. The opt-in remains a high-risk SSRF/credential-destination switch because every authenticated caller can choose the initial host, and application validation does not replace an outbound DNS/IP/TLS allowlist. Jellyfin, Emby, and Kodi require explicit self-hosted `baseUrl` values, so their production connectors are usable only under this owner opt-in and network enforcement. Plex does not accept a caller-supplied server URL, but it follows server connections returned by the authenticated Plex resources service; operators should still restrict outbound destinations. See [Deployment](DEPLOYMENT.md) and [Security](../SECURITY.md) for the required controls.

## Shikimori connector boundary

Shikimori registers all three executable families for anime user rates, but the fields share one provider row and are not freely interchangeable. Rating writes require exact integer 1–10 conversion and an existing user rate; planned-watchlist writes refuse to replace any active/completed status; watched writes require a non-lossy status/progress/replay combination and exact `externalIds.shikimori`. Provider timestamps, reviews, manga rows, and MAL-only reverse lookup are rejected. The context requires `accessToken`, numeric `accountId`, `oauthScope: "user_rates"`, and an identifying User-Agent. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#shikimori-fidelity-and-oauth-boundary) and [OAuth setup](OAUTH_SETUP.md#shikimori-authorization-code-flow-and-refresh).

## Annict connector boundary

Annict registers watched and planned-watchlist paths only. Work states preserve watching, completed, on-hold, dropped, and planned meanings; exact episode play history uses paired `annictWork` and `annictEpisode` IDs and additive record creation that never reduces prior plays. Timestamps, work progress/replays, and lossy episode fields are rejected. Annict's per-record rating is not treated as a canonical title rating, so rating plans are blocked. The context requires `accessToken`, `oauthScope: "read write"`, and an identifying User-Agent. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#annict-watchedwatchlist-boundary) and [OAuth setup](OAUTH_SETUP.md#annict-browser-or-oob-flow-and-revocation).

## Bangumi connector boundary

Bangumi support is anime-only. The connector reads and writes ratings, exact completed-episode/progress state, and collection watchlist/status using official HTTPS endpoints, Bearer authentication, and an identifying User-Agent. Episode writes require exact subject and episode IDs verified against the live collection. Rating-only writes are limited to existing collection subjects; a new rating without a chosen collection status is rejected. Rating, watched, and watchlist timestamps, reviews, replay/rewatch state, books/manga, and on-hold or dropped collection states cannot be preserved and are not silently coerced. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#bangumi-fidelity-and-limits) and [OAuth setup](OAUTH_SETUP.md#bangumi-manual-token-context).

## Jellyfin connector boundary

Jellyfin registers ratings and completed watched-state methods for one explicitly configured self-hosted server; it does not register watchlist methods, and favorites/likes are never mapped to watchlist. The connector requires a server-issued access token and HTTPS server base URL, binds Jellyfin item IDs to that server, and rejects ambiguous or cross-server matches. Rating timestamps/reviews, aggregate series state, in-progress playback, and unit progress are rejected. Completed watched writes are limited to movies and exact episodes with consistent timestamp/play-count state; preflight refuses to lower the existing play count or move the last-played timestamp backwards. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#jellyfin-fidelity-and-deployment-boundary) and [OAuth setup](OAUTH_SETUP.md#jellyfin-self-hosted-token-context).

## Emby connector boundary

Emby registers only completed watched-membership reads and writes for movies and exact episodes on one explicitly configured self-hosted server. Writes add `Played=true` and never mark an item unplayed. The connector rejects timestamps, replay/play counts, in-progress or unit progress, and aggregate series/season state. Numeric ratings remain blocked because a safe rating scale and merge contract are not documented for this connector; favorites and likes are never mapped to watchlist. The request context requires `accessToken`, `accountId`, an explicit HTTPS `baseUrl`, and an identifying `userAgent`. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#emby-watched-state-and-deployment-boundary) and [OAuth setup](OAUTH_SETUP.md#emby-self-hosted-token-context).

## Kodi connector boundary

Kodi registers integer ratings and completed movie/exact-episode play counts, with no watchlist path. It is locked to Kodi Omega 21 and JSON-RPC 13.5 and requires one exact current profile, a stable UUID-scoped library identity, read/update permission, request-scoped Basic credentials, and an explicit HTTPS `/jsonrpc` URL. It rejects aggregate state, resume/in-progress progress, rating/review timestamps, and `lastplayed`; exact play-count writes never lower the current count. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#kodi-libraryprofile-boundary) and [OAuth setup](OAUTH_SETUP.md#kodi-request-scoped-json-rpc-context).

## Plex connector boundary

Plex registers server-scoped personal ratings only. The caller provides an existing account token, stable client identifier, selected server machine ID, and identifying client fields; WatchBridge discovers and verifies the claimed server and its per-server token and ships no Plex authorization helper. Rating timestamps, reviews, deletion, cross-server identity, watched/timeline/scrobble, and global watchlist are unsupported. Plex's current personal, non-commercial Terms apply; review them before deployment and obtain any additional permission required. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#plex-ratings-and-terms-boundary) and [OAuth setup](OAUTH_SETUP.md#plex-caller-provided-token-context).

## Kitsu metadata boundary

Kitsu is not an account-sync connector. It makes public exact-ID JSON:API reads only for anime, manga, or episode resources, validates exact resource identity/type/title/date/episode coordinates, and never calls search, Algolia, mappings, users, or library entries. Its current official source OpenAPI does not expose active user/library-entry contracts suitable for ratings, watched, or watchlist sync, and the remaining authentication material describes a password grant that WatchBridge will not collect credentials for. Kitsu therefore contributes metadata and **0/3** account-sync features. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#metadata-and-recommendations) and [OAuth setup](OAUTH_SETUP.md#why-kitsu-has-no-account-authorization-helper).

## Restore

`POST /v1/backups/:id/restore` reapplies a saved backup to the same implemented official account service that created it. It starts in dry-run mode, requires `confirmWrite: true` for a remote restore, and creates a new backup of the current target before preflight/imports. Restore is deliberately non-destructive: it reapplies saved ratings, watched entries, and watchlist entries but does not delete records that appeared after the backup, because those deletions do not have a verified safe API path. Use `/v1/sync/from-backup` instead for cross-service migration.

Run this through the CLI with `watchbridge restore-backup backup-id restore-request.json`.
