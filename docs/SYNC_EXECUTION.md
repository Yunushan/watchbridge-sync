# Sync Execution

`POST /v1/sync/execute` runs only the eleven shipped direct-account connectors: TMDb, Trakt, Simkl, MyAnimeList, anime-only Shikimori, anime-only Annict, anime-only Bangumi, a user-selected Jellyfin server, a watched-only user-selected Emby server, one scoped Kodi library/profile, and one selected Plex Media Server. Their registered feature sets differ; file, metadata/recommendation, manual, and restricted workflows use separate paths.

All six canonical selections round-trip through backup v1 and the executor, subject to each connector's runtime profile. `direction: "one-way"` is the default; `direction: "two-way"` is accepted only for two live direct-account connectors with registered account read and write methods for every selected feature. Social usernames are provider-scoped: cross-service following/follower plans never infer account identity, same-service following restore requires an explicit additive importer, and followers are always read-only. Same-service account sync remains rejected in favor of the guarded restore route.

`POST /v1/metadata/resolve` exposes metadata-only candidates for TMDb, OMDb, Wikidata, TVmaze, TheTVDB, and Kitsu. OMDb requires a request-scoped API key plus an exact IMDb title ID and is limited to its official HTTPS ID lookup under its non-commercial terms boundary. Wikidata uses only its public HTTPS exact-Q-item entity-data route with an identifying User-Agent; it does not search, query SPARQL, edit entities, or access accounts. TheTVDB context must contain the authorized project `apiKey` and, when applicable, `subscriberPin`. Kitsu is unauthenticated and exact-ID only: the item must be anime, manga, or episode with a positive integer `externalIds.kitsu`; WatchBridge does not turn its title into search, Algolia, mapping, or account-library traffic.

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
    "watchlist": [],
    "reviews": [],
    "following": [],
    "followers": []
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

Letterboxd has no shipped account connector, so it is not a target for `/v1/sync/from-backup`. Use `POST /v1/export/letterboxd-files`, `watchbridge generate-letterboxd-files backup.json selection.json`, or the web **Canonical backup to Letterboxd import files** panel instead. This path validates the same strict archive and generates movie-only ratings, watched, watchlist, and/or reviews CSV chunks of at most 1,000,000 UTF-8 bytes each. The user then verifies matches and uploads the files through Letterboxd's web importers. It creates no sync job, takes no Letterboxd credentials, performs no account write, and does not make the transfer two-way. Exact columns and lossy-input rejections are documented in [Import and Export Formats](IMPORT_EXPORT_FORMATS.md).

The execution sequence is:

1. Persist a `pending` audit job. If this fails, execution does not start.
2. For account-to-account sync, authenticate and export both live accounts. For backup sync, validate and use the supplied archive without source credentials or a source network call.
3. Match media records by shared external ID, or by exact normalized title/year/kind. An optional user-supplied `identityOverrides` entry may match one exact selected-feature source canonical item ID to one exact target canonical item ID when normal matching fails; it cannot change automatic rules, cross media kinds, match social records, or create a record. Deduplicate social records by service, direction, and case-insensitive username without matching identities across providers, then apply the selected conflict policy.
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

Two-way is rejected if either side lacks account read or write support for any selected feature, if either service is not a live direct-account connector, or if a canonical backup is supplied as the source. Following and followers are additionally blocked from cross-service two-way reconciliation because canonical usernames are provider-scoped; follower membership has no valid target write operation. For a confirmed two-way run, both account snapshots must be persisted successfully before directional preflight or mutation begins.

If the server has `WATCHBRIDGE_API_KEY` set, the CLI reads the same environment variable and sends it as an `Authorization: Bearer <key>` header. Do not put the server key in a committed sync request.

The response contains source and target backups plus feature-level preview, conflict, and skip counts; two-way actions also identify their source/target direction. For actual canonical matches, `conflictDetails` provides at most 100 globally ordered, generated summaries with feature/direction, a bounded title or provider-scoped username, source/target canonical ID lists, timestamps, state/value summaries, and the deterministic decision/reason. `conflictDetailsTruncated` is the exact number of additional summaries omitted. Review bodies are represented only by character count and spoiler state. Raw backup rows, connector contexts, access tokens, API keys, and review text are never copied into conflict summaries.

Under `manual`, different states are explicitly marked `unresolved` and neither matching record is written. In the account-sync review, a user may select source or target for one of those already-matched records. The browser sends only the opaque 32-character conflict ID and choice; the executor recomputes that ID from fresh bounded evidence, accepts at most 100 unique choices, and rejects stale, duplicate, non-manual, or non-matching selections before preflight or mutation. Changing a choice invalidates the confirmed-write gate and requires a new dry-run. Equivalent state and existing set membership cannot be overridden. `source-wins` and `target-wins` name the selected request side. `newest-wins` names the newer side, or records a no-write tie when timestamps and supported watched-state tie-breakers cannot choose safely. These choices do not broaden identity matching or infer a new match.

When a normal media match is absent but the user has independently reviewed the two canonical record IDs, account and backup sync requests may include up to 100 `identityOverrides` entries such as `{ "feature": "ratings", "sourceItemId": "movie:source-id", "targetItemId": "movie:target-id" }`. Each pair must be unique, use a feature selected for that request, have non-empty bounded IDs, and is directional from source to target. The executor honors the pair only for same-kind media records already present in the exported snapshots. The account-sync form provides an advanced JSON field; changing it invalidates the confirmed-write gate. It is deliberately not a title-search or global mapping feature.

Every account sync, backup-source sync, and restore first writes a minimal `pending` job report to `WATCHBRIDGE_JOB_DIR` (or `.watchbridge-jobs`). A completed operation finalizes it as `succeeded`; an execution/preflight error finalizes it as `failed`. Reports contain source/target, timestamps, direction, dry-run state, conflict policy, actions, status, bounded conflict summaries, and available source/target backup artifact IDs—never access tokens or exported media entries. Failed reports retain available conflict summaries alongside the sanitized error, failed feature and direction when known, and `writeMayBePartial` state. Job reads reject unknown conflict fields, invalid services/timestamps/decisions, more than 100 details, or an inconsistent truncation count. Retrieve reports using `GET /v1/sync/jobs` or `GET /v1/sync/jobs/:id`. The web recovery/audit panel validates the complete returned record, lists jobs newest first, loads the selected detail through the single-job route, renders the same conflict review, and offers authenticated downloads for each recorded pre-write backup.

Optional retention is controlled by `WATCHBRIDGE_JOB_RETENTION_DAYS` and `WATCHBRIDGE_BACKUP_RETENTION_DAYS`; unset or `0` means no automatic deletion. Cleanup never removes pending jobs and keeps every backup referenced by a retained job. A corrupt or unavailable job inventory blocks backup deletion for that run. Preview with `watchbridge cleanup-storage cleanup-request.json` using `{ "dryRun": true }`; a non-dry-run API request also requires `confirmDelete: true`. See [Deployment](DEPLOYMENT.md) for limits and scheduling behavior.

Failure responses include the durable job, completed/partial actions and available source/target backup artifacts, plus `retrySafe`. If a provider call fails after mutation begins, `writeMayBePartial` is true and every saved pre-write backup should be inspected before retrying. If final audit persistence itself fails, the API returns an `auditWarning` rather than silently claiming a durable final state.

## Confirmed write

After reviewing the dry-run result, change only these fields:

```json
{
  "dryRun": false,
  "confirmWrite": true
}
```

The API rejects non-dry-runs without `confirmWrite: true`. The account-sync web panel additionally requires a successful dry-run for the exact current accounts, features, policy, direction, and connector-context text before it enables the confirmation control; any change invalidates that preview. Before preflight or imports begin, the API saves the target backup to `WATCHBRIDGE_BACKUP_DIR` (or `.watchbridge-backups` in the process directory) and returns its `targetBackupArtifact.id`; a confirmed two-way run also returns `sourceBackupArtifact.id`. Download either from `GET /v1/backups/:id`. Every prepared feature/direction batch is then validated through the connector's non-mutating dry-run path before the first actual provider write. Conflict policy defaults to `manual`; other explicit choices are `source-wins`, `target-wins`, and `newest-wins`.

The account-sync web result exposes target and two-way source backup download buttons; the backup-sync panel exposes the target backup. The browser uses a same-origin GET with browser credentials omitted and, when entered, sends the in-memory WatchBridge API key as `Authorization: Bearer`. It validates the UUID, enforces a 50 MiB streaming bound, and accepts only UTF-8 JSON marked `watchbridge.backup.v1` before creating the local download. The API returns plaintext canonical JSON even when its file-backed storage is encrypted at rest.

## Provider URL boundary

The optional API URL accepted by CLI commands is the WatchBridge server address; it is not a provider override. Request-supplied connector or recommendation `baseUrl`, `v3BaseUrl`, and `v4BaseUrl` fields are rejected before any provider fetch by default. Tests may use them under `NODE_ENV=test`; an owner may opt in outside tests only with exact lowercase `WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true`. Even then, values are limited to 2,000 characters and must be valid HTTPS URLs without credentials, query, or fragment. Credential-bearing connector requests disable automatic redirects and reject 3xx responses. The opt-in remains a high-risk SSRF/credential-destination switch because every authenticated caller can choose the initial host, and application validation does not replace an outbound DNS/IP/TLS allowlist. Jellyfin, Emby, and Kodi require explicit self-hosted `baseUrl` values, so their production connectors are usable only under this owner opt-in and network enforcement. Plex does not accept a caller-supplied server URL, but it follows server connections returned by the authenticated Plex resources service; operators should still restrict outbound destinations. See [Deployment](DEPLOYMENT.md) and [Security](../SECURITY.md) for the required controls.

## Trakt review and social connector boundary

Trakt review export uses the authenticated current-user top-level review feed and preserves exact type-specific Trakt identity, body, spoiler state, creation time, and an attached user rating when present. Review writes are narrower because Trakt's create-comment contract cannot backdate a comment or atomically set an attached rating: both fields are rejected. A candidate must instead have a positive integer Trakt ID for a movie, show, season, or episode, an explicit spoiler boolean, and at least 200 whitespace-delimited words so Trakt classifies it as a review. WatchBridge bounds the batch, verifies commenting permission, preflights current reviews for duplicates, and rereads the current-user feed after creation to verify media identity, exact text, spoiler state, and review classification. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#trakt-reviewcomment-fidelity-boundary) and [OAuth setup](OAUTH_SETUP.md#trakt-device-flow).

Trakt also exports authenticated current-user following and followers. It preserves exact provider usernames, optional names, and relationship timestamps, but does not synthesize profile URLs. The official social-list routes are full arrays rather than paginated endpoints, so each is requested once and bounded locally. Only following has an additive importer: timestamp/profile-URL-bearing rows and follower direction are rejected, all exact public identities are resolved before the first write, private pending requests are refused, and every approved follow must appear in a final authenticated reread. Followers remain read-only. See [the Trakt social-graph boundary](CONNECTOR_CAPABILITIES.md#trakt-social-graph-fidelity-boundary).

## Shikimori connector boundary

Shikimori registers all three primary media families—ratings, watched/progress, and watchlist—for anime user rates, but the fields share one provider row and are not freely interchangeable. Rating writes require exact integer 1–10 conversion and an existing user rate; planned-watchlist writes refuse to replace any active/completed status; watched writes require a non-lossy status/progress/replay combination and exact `externalIds.shikimori`. Provider timestamps, reviews, manga rows, and MAL-only reverse lookup are rejected. The context requires `accessToken`, numeric `accountId`, `oauthScope: "user_rates"`, and an identifying User-Agent. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#shikimori-fidelity-and-oauth-boundary) and [OAuth setup](OAUTH_SETUP.md#shikimori-authorization-code-flow-and-refresh).

## Annict connector boundary

Annict registers watched and planned-watchlist paths only. Work states preserve watching, completed, on-hold, dropped, and planned meanings; exact episode play history uses paired `annictWork` and `annictEpisode` IDs and additive record creation that never reduces prior plays. Timestamps, work progress/replays, and lossy episode fields are rejected. Annict's per-record rating is not treated as a canonical title rating, so rating plans are blocked. The context requires `accessToken`, `oauthScope: "read write"`, and an identifying User-Agent. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#annict-watchedwatchlist-boundary) and [OAuth setup](OAUTH_SETUP.md#annict-browser-or-oob-flow-and-revocation).

## Bangumi connector boundary

Bangumi support is anime-only. The connector reads and writes ratings, exact completed-episode/progress state, and collection watchlist/status using official HTTPS endpoints, Bearer authentication, and an identifying User-Agent. Episode writes require exact subject and episode IDs verified against the live collection. Rating-only writes are limited to existing collection subjects; a new rating without a chosen collection status is rejected. Rating, watched, and watchlist timestamps, reviews, replay/rewatch state, books/manga, and on-hold or dropped collection states cannot be preserved and are not silently coerced. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#bangumi-fidelity-and-limits) and [OAuth setup](OAUTH_SETUP.md#bangumi-manual-token-context).

## Jellyfin connector boundary

Jellyfin registers ratings and completed watched-state methods for one explicitly configured self-hosted server; it does not register watchlist methods, and favorites/likes are never mapped to watchlist. The connector requires a server-issued access token and HTTPS server base URL, binds Jellyfin item IDs to that server, and rejects ambiguous or cross-server matches. Rating timestamps/reviews, aggregate series state, in-progress playback, and unit progress are rejected. Completed watched writes are limited to movies and exact episodes with consistent timestamp/play-count state; preflight refuses to lower the existing play count or move the last-played timestamp backwards. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#jellyfin-fidelity-and-deployment-boundary) and [OAuth setup](OAUTH_SETUP.md#jellyfin-self-hosted-token-context).

## Emby connector boundary

Emby registers only completed watched-membership reads and writes for movies and exact episodes on one explicitly configured self-hosted server. Writes add `Played=true` and never mark an item unplayed. The connector rejects timestamps, replay/play counts, in-progress or unit progress, and aggregate series/season state. Numeric ratings remain blocked because a safe rating scale and merge contract are not documented for this connector; favorites and likes are never mapped to watchlist. The request context requires `accessToken`, `accountId`, an explicit HTTPS `baseUrl`, and an identifying `userAgent`. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#emby-watched-state-and-deployment-boundary) and [OAuth setup](OAUTH_SETUP.md#emby-self-hosted-token-context).

## Kodi connector boundary

Kodi registers integer ratings, completed movie/exact-episode play counts, and a managed movie watchlist. It is locked to Kodi Omega 21 and JSON-RPC 13.5 and requires one exact current profile, a stable UUID-scoped library identity, read/update permission, request-scoped Basic credentials, and an explicit HTTPS `/jsonrpc` URL. Watchlist membership uses the connector-owned `watchbridge:watchlist:<kodiLibraryScope>` tag and preserves unrelated tags; non-movie entries, timestamps, and foreign scopes are rejected. The connector also rejects aggregate watched state, resume/in-progress progress, rating/review timestamps, and `lastplayed`; exact play-count writes never lower the current count. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#kodi-libraryprofile-boundary) and [OAuth setup](OAUTH_SETUP.md#kodi-request-scoped-json-rpc-context).

## Plex connector boundary

Plex registers server-scoped personal ratings plus completed played membership for movies and exact episodes. The caller provides an existing account token, stable client identifier, selected server machine ID, and identifying client fields; WatchBridge discovers and verifies the claimed server and its per-server token and ships no Plex authorization helper. It reads played membership from `viewCount` and writes only through the provider-discovered `scrobbleKey`, which Plex documents as setting played state without creating view history. Rating timestamps, reviews, deletion, cross-server identity, watched timestamps/progress/replay counts, aggregate show/season state, and global watchlist remain unsupported. Plex's current personal, non-commercial Terms apply; review them before deployment and obtain any additional permission required. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#plex-ratings-played-membership-and-terms-boundary) and [OAuth setup](OAUTH_SETUP.md#plex-caller-provided-token-context).

## Kitsu metadata boundary

Kitsu is not an account-sync connector. It makes public exact-ID JSON:API reads only for anime, manga, or episode resources, validates exact resource identity/type/title/date/episode coordinates, and never calls search, Algolia, mappings, users, or library entries. Its current official source OpenAPI does not expose active user/library-entry contracts suitable for account sync, and the remaining authentication material describes a password grant that WatchBridge will not collect credentials for. Kitsu therefore contributes metadata and **0/6** canonical account-sync families. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#metadata-and-recommendations) and [OAuth setup](OAUTH_SETUP.md#why-kitsu-has-no-account-authorization-helper).

## Restore

`POST /v1/backups/:id/restore` reapplies a saved backup to the same implemented official account service that created it. It starts in dry-run mode, requires `confirmWrite: true` for a remote restore, and creates a new backup of the current target before preflight/imports. Restore is deliberately non-destructive: each of the six families receives an explicit preview/restored/skipped action, and only a family with a verified importer can mutate the account. Following is eligible only for an additive same-provider importer; followers are always skipped/read-only because a service cannot make a third party follow the restored account. Restore does not delete records that appeared after the backup. Use `/v1/sync/from-backup` instead for cross-service media migration.

Run this through the CLI with `watchbridge restore-backup backup-id restore-request.json`, or use the web **Backup restore and sync job history** panel. The web flow enables write mode only after a successful dry-run preview of the same backup ID, service, and connector context; a confirmed write then requires a separate explicit checkbox. Every confirmed attempt, including a failed or potentially partial attempt, resets the form to dry-run so it cannot be retried from a stale preview. Its connector context and optional WatchBridge API key remain in page memory, are sent only in same-origin requests with browser credentials omitted, and are cleared by refreshing or closing the page.
