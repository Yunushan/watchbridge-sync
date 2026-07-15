# Example Syncs

## Letterboxd ratings toward IMDb

```bash
watchbridge plan letterboxd imdb ratings
```

The shipped plan is `import-file -> transform -> manual-action`:

1. Read a user-supplied Letterboxd ratings export.
2. Normalize identity and show the Letterboxd 0.5–5 to 1–10 rating transform.
3. Stop at a canonical backup/manual action because IMDb has no registered account write or target-import-file generator.

The library can create a portable IMDb-shaped ratings CSV, but WatchBridge does not claim that IMDb accepts it as an account import.

## Letterboxd provider files to Trakt

1. In the web **Provider export files to canonical backup** panel, select the Letterboxd ratings, watched, watchlist, and/or reviews exports. The equivalent offline command is `watchbridge import-provider-files letterboxd-files.json`.
2. Download/save the resulting strict `watchbridge.backup.v1` archive.
3. Load it in the web **Canonical backup to account** panel, or place it in a request for `watchbridge execute-backup-sync backup-sync-request.json`.
4. Select only supported Trakt features and run a dry-run. This creates a durable audit job but performs no remote write.
5. After review, submit `dryRun: false` with `confirmWrite: true`. WatchBridge saves the current Trakt snapshot before applying the file records. The web result exposes an authenticated download button for that pre-write backup.

The same backup-source route works for IMDb, MovieLens, or a mapped-CSV archive, subject to the source records present and the chosen target's registered write features.

## Canonical backup to Letterboxd import files

1. Open the web **Canonical backup to Letterboxd import files** panel and choose a strict `watchbridge.backup.v1` archive.
2. Select ratings, watched, watchlist, and/or reviews. Generation rejects non-movie records and any state the documented Letterboxd CSV cannot preserve, including in-progress playback, aggregate progress, play counts above one, and spoiler-marked reviews.
3. Generate and download every numbered CSV chunk. Each chunk is at most 1,000,000 UTF-8 bytes.
4. Review the returned warnings and inspect title matches, converted ratings, review text, and calendar dates. Review timestamps are not transferable because the documented format has no review-date column.
5. Upload ratings/watched/reviews chunks through Letterboxd's profile importer and watchlist chunks through its watchlist importer.

The API equivalent is `POST /v1/export/letterboxd-files`. Offline, put the feature-selection object in `selection.json` and run `watchbridge generate-letterboxd-files backup.json selection.json`; the CLI prints a JSON bundle whose `files[].content` values must be saved under their corresponding `files[].fileName`. WatchBridge neither signs in to Letterboxd nor uploads the files, so this is a one-way, user-controlled handoff rather than an account write.

## Trakt watched history to Simkl

1. Obtain request-scoped Trakt and Simkl credentials through the OAuth API/CLI helpers or web authorization panel.
2. Use the web account-sync panel or run `watchbridge execute-sync sync-request.json` with `dryRun: true`.
3. WatchBridge exports both accounts, matches shared IDs or exact canonical identity, resolves conflicts, and preflights the prepared Simkl history batch.
4. Review preview/conflict counts and the durable job result.
5. Repeat with `dryRun: false` and `confirmWrite: true`. The target snapshot is persisted before the first remote mutation.

If a provider call fails, the job is marked `failed`; the response identifies the failed feature and whether a partial write may have occurred, and exposes the pre-write backup when available.

## Two-way Trakt and Simkl watched/progress reconciliation

Preview the direction-aware plan first:

```bash
watchbridge plan trakt simkl watched two-way
```

Then set `"direction": "two-way"` in the request used by `watchbridge execute-sync sync-request.json`, or choose **Two-way reconciliation** in the web account-sync panel.

1. WatchBridge exports both live accounts and verifies that both connectors can read and write every selected feature.
2. Missing records are prepared toward the account that lacks them. Repeated same-item watched events are deduplicated and reconciled as latest watched/progress state, not as full play-event history. Matching conflicts follow the selected `manual`, `source-wins`, `target-wins`, or `newest-wins` policy; matching watchlist membership and unresolved newest ties do not generate echo writes.
3. The dry-run preflights every prepared batch in both directions and labels each action with its source and target.
4. A confirmed run persists snapshots of both accounts before preflight or mutation. The web result provides authenticated download buttons for both artifacts; if the API is protected, the in-memory WatchBridge API key is sent as a Bearer header.
5. If a provider write fails, the job reports the failed feature and direction, completed actions, whether the write may be partial, and every available pre-write artifact.

This mode cannot use a provider file or canonical backup as one side, and it remains blocked when either account lacks read/write support for a selected feature.

## Bangumi backup and cross-service identity gate

1. Obtain a Bangumi access token through the provider's official process. WatchBridge does not ship a Bangumi OAuth helper.
2. Supply a Bangumi context such as `{ "accessToken": "...", "userAgent": "developer/watchbridge-sync" }`; the User-Agent must identify the developer/application and the connector uses official HTTPS endpoints.
3. A Bangumi account export preserves anime ratings, collection status/progress, and exact completed episodes with `externalIds.bangumi` plus `externalIds.bangumiEpisode`.
4. When Bangumi is a target in a confirmed account sync, its pre-write snapshot is persisted and the authenticated web result can download it. That saved artifact can later be reapplied additively to the same Bangumi account with `POST /v1/backups/:id/restore` after a dry-run.

A raw Bangumi export is **not** currently an executable Bangumi-to-MyAnimeList migration: Bangumi rows do not contain MyAnimeList IDs, the MyAnimeList importer requires `externalIds.mal`, and no verified cross-provider identity-enrichment step is shipped. Registered read/write methods and a two-way planner mode are not a promise that every service pair or record shape has enough shared identity to execute.

Bangumi also fails closed on data it cannot preserve. It rejects timestamps, reviews, replay/rewatch state, non-anime/book records, on-hold or dropped collection states, and episode progress without exact verified episode IDs; rating-only writes require that the subject already exists in the Bangumi collection.

## Shikimori full-three-feature sync

1. Register a Shikimori OAuth application and use the web authorization panel or `watchbridge oauth-shikimori-start`, `oauth-shikimori-exchange`, and, later, `oauth-shikimori-refresh`. The helper requests exactly `user_rates`.
2. Supply `{ "accessToken": "...", "accountId": "12345", "oauthScope": "user_rates", "userAgent": "WatchBridge-Sync/0.1.0" }` and select ratings, watched, and/or watchlist.
3. Dry-run first. Rating-only writes require an existing user-rate row; a planned-watchlist write cannot replace an active/completed row; watched progress, status, and replay count must form one non-lossy provider state.
4. Use exact `externalIds.shikimori`. A MAL ID alone is not reverse-mapped. Timestamps, reviews, manga, and rating conversion requiring rounding fail closed.

Shikimori is counted as a full-three-feature direct connector because each family has tested read and write methods, not because every arbitrary backup can be represented or independently create a provider row.

## Annict watched and planned watchlist sync

1. Use the web authorization panel or `watchbridge oauth-annict-start` and `oauth-annict-exchange`. The exact OOB redirect `urn:ietf:wg:oauth:2.0:oob` is supported; Annict returns no refresh token, and `oauth-annict-revoke` invalidates the current token.
2. Supply `{ "accessToken": "...", "oauthScope": "read write", "userAgent": "WatchBridge-Sync/0.1.0" }` and select watched and/or watchlist only. Rating plans are blocked.
3. Work states map watching, completed, on-hold, dropped, and planned status. Exact episode history requires both `externalIds.annictWork` and `externalIds.annictEpisode`.
4. Episode writes only add records and never reduce prior play count. Backdated timestamps, work progress/replay fields, and lossy episode fields fail closed.

## Jellyfin ratings and completed watched state

1. The deployment owner enables exact lowercase `WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true` and restricts outbound DNS/IP/TLS destinations to the selected Jellyfin server. This opt-in is required because Jellyfin is self-hosted and every request supplies its server URL.
2. Supply `{ "accessToken": "...", "baseUrl": "https://media.example/jellyfin/", "userAgent": "developer/watchbridge-sync" }`. WatchBridge does not collect Jellyfin passwords or ship a Quick Connect helper.
3. Select ratings and/or watched only. Jellyfin favorites and likes are not a canonical watchlist, so a Jellyfin watchlist plan is blocked.
4. Dry-run before any write. Ratings with timestamp/review data and watched records representing aggregate series, in-progress playback, or unit progress fail closed. Completed watched writes require a movie or exact episode and a consistent play-count/timestamp state; preflight rejects a lower play count or older last-played time than the server already holds.
5. Cross-service writes still require one exact identity match. Instance-scoped Jellyfin IDs are accepted only on the same connected server; otherwise WatchBridge needs a unique canonical match and rejects ambiguity.

A confirmed write persists the current destination snapshot first. If Jellyfin is the destination, that authenticated backup download can later be used for additive same-service restore. Favorites remain untouched because they are outside the connector contract.

## Emby completed watched membership

1. The deployment owner enables exact lowercase `WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true` and restricts outbound DNS/IP/TLS destinations to the selected Emby server.
2. Supply `{ "accessToken": "...", "accountId": "emby-user-id", "baseUrl": "https://media.example/emby/", "userAgent": "developer/watchbridge-sync" }`. WatchBridge does not collect Emby passwords or perform Emby Connect login.
3. Select watched only. The connector accepts completed movies and exact episodes, but rejects timestamps, replay/play counts, in-progress or unit progress, and aggregate series/season state instead of silently discarding them.
4. Emby ratings and watchlist plans are blocked. The official numeric-rating surface does not provide the safe scale/merge contract required by this connector, and favorites/likes are not canonical watchlist membership.
5. Dry-run before confirmation. A confirmed write persists the current Emby snapshot before preflight and mutation, then only marks missing entries `Played=true`; it never marks an item unplayed. Same-service restore remains additive.

Two-way use is limited to another direct connector that also registers watched reads and writes, and every record must fit Emby's narrow completed-membership shape and identity requirements.

## Kodi ratings, completed play counts, and managed movie watchlist

1. Configure one owner-controlled Kodi Omega 21 host with HTTPS JSON-RPC and enable the production custom-provider-URL opt-in only with an outbound allowlist for that host.
2. Supply request-scoped `{ "username": "...", "password": "...", "profileName": "Master user", "kodiLibraryScope": "<lowercase UUIDv4>", "baseUrl": "https://media.example/kodi/jsonrpc", "userAgent": "WatchBridge-Sync/0.1.0" }`.
3. Select ratings, watched, and/or watchlist. The connector verifies JSON-RPC 13.5, the exact profile, and read/update permissions; it supports integer 1–10 `userrating`, completed movie/exact-episode `playcount`, and a movie watchlist managed by the library-scoped `watchbridge:watchlist:<kodiLibraryScope>` tag.
4. Native favourites, non-movie watchlists, resume progress, aggregate TV state, and timestamps are blocked. Managed-watchlist writes preserve unrelated tags, and exact play-count writes cannot lower existing state.

## Plex server-scoped ratings and completed played membership

1. Obtain an authorized Plex account token outside WatchBridge; no Plex sign-in/PIN helper is shipped. Review Plex's current personal, non-commercial Terms before use.
2. Supply `{ "accessToken": "...", "clientIdentifier": "watchbridge-installation-id", "plexServerId": "selected-machine-id", "userAgent": "WatchBridge-Sync/0.1.0", "appName": "WatchBridge", "appVersion": "0.1.0" }`. Do not supply a server URL.
3. Select ratings and/or watched. The connector discovers the server and its per-server token, verifies the claimed machine ID, resolves an exact server-scoped library item, uses the discovered `rate` or timeline `scrobbleKey` feature, and rereads the result.
4. Watched input is limited to completed membership for movies and exact episodes. Progress, replay counts, rewatched status, timestamps, aggregate show/season state, global watchlist, rating deletion, reviews, and cross-server identity are blocked.

## Kitsu exact-ID metadata

Put an exact positive integer Kitsu ID on a canonical anime, manga, or episode and call `watchbridge resolve-metadata metadata-request.json` or `POST /v1/metadata/resolve`. For example, an anime request uses `externalIds: { "kitsu": 1 }`. The connector calls only the matching public `/anime/1`, `/manga/{id}`, or `/episodes/{id}` route and returns strictly validated canonical title/year/episode coordinates. It does not search by title or call Algolia, mappings, users, or library entries. Kitsu has no ratings, watched, or watchlist execution path.

## Same-service backup restore

Use `watchbridge restore-backup backup-id restore-request.json` or `POST /v1/backups/:id/restore` to preview and then reapply a saved backup to the same service that created it. Restore is additive: it does not delete newer provider entries. For a cross-service migration, use `/v1/sync/from-backup` instead.

## TasteDive recommendations

`watchbridge recommend recommendation-request.json` calls the read-only TasteDive recommendation path for one canonical movie or TV item. This returns typed recommendation candidates; it neither reads nor writes ratings, history, or watchlists.

## AniList anime list to MyAnimeList

This plan is currently blocked. AniList is a selectable but restricted catalog entry, and WatchBridge does not ship AniList OAuth, account reading, or mapped-file execution. No data is fetched or written. The integration can move forward only after the required sustained-integration authorization is obtained and a connector is implemented and tested.
