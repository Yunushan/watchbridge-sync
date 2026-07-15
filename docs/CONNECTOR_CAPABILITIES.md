# Connector and Runtime Support

WatchBridge keeps two different facts separate:

- **Provider capabilities** describe a documented or safely user-controlled path a service may offer.
- **Shipped runtime support** describes code that this repository can execute and test today.

A provider capability never creates a runtime promise. In particular, a provider accepting imports does not mean WatchBridge ships a target-file generator. Letterboxd is the only current exception backed by a shipped generator; all other services still require an explicitly registered implementation. The exhaustive runtime registry is `SERVICE_RUNTIME_SUPPORT` in `packages/core/src/runtimeSupport.ts`; every entry returned by `GET /v1/services` and `watchbridge services` includes its `runtime` profile.

## Current implementation snapshot

- **35/35 (100%)** services are selectable catalog entries; **0/35 (0%)** are missing from the catalog.
- **11/35 (31.4%)** have repository-tested direct-account connectors: TMDb, Trakt, Simkl, MyAnimeList, Shikimori, Annict, Bangumi, Jellyfin, Emby, Kodi, and Plex; **24/35 (68.6%)** do not.
- **3/35 (8.6%)** have dedicated user-file readers: IMDb, Letterboxd, and MovieLens; **32/35 (91.4%)** do not.
- **5/35 (14.3%)** are metadata/recommendation workflow integrations: OMDb, TVmaze, TheTVDB, TasteDive, and Kitsu; **30/35 (85.7%)** are not in that workflow.
- **13/35 (37.1%)** use the generic mapped-CSV path when the user has a lawful export; **22/35 (62.9%)** do not.
- **3/35 (8.6%)** are restricted: Rotten Tomatoes, JustWatch, and AniList; **32/35 (91.4%)** are not restricted.

Additional completion views, derived from the same registry:

- **6/35 (17.1%)** register direct account read and write methods for the primary ratings, watched/progress, and watchlist families: Trakt, Simkl, MyAnimeList, Shikimori, Bangumi, and Kodi; **29/35 (82.9%)** do not. This is method coverage, not a promise that every cross-provider record has sufficient identity or lossless shape to write.
- **1/35 (2.9%)** registers reads for all six canonical families and writes for every mutable family: Trakt. The other **34/35 (97.1%)** do not. Followers are excluded from the mutable-family requirement because follower membership has no valid write operation.
- **27/35 (77.1%)** have at least one shipped account or file source path. The missing **8/35 (22.9%)** are the five metadata/recommendation workflow entries and three restricted entries.
- **6/35 (17.1%)** expose metadata resolution or recommendations: TMDb, OMDb, TVmaze, TheTVDB, TasteDive, and Kitsu. This cross-cutting metric overlaps the mutually exclusive workflow categories because TMDb is a direct-account platform.
- Across the **210** platform × canonical-family source slots, **116/210 (55.2%)** are readable through an account/file path and **94/210 (44.8%)** are missing.
- Across the same **210** target slots, **29/210 (13.8%)** have a verified account write and **181/210 (86.2%)** do not. Four Letterboxd slots generate user-controlled import files, so total automated target coverage is **33/210 (15.7%)** and **177/210 (84.3%)** are missing. File generation is not a Letterboxd account write.
- The feature-level split is: ratings **25/35 (71.4%)** source, **9/35 (25.7%)** account-write, **10/35 (28.6%)** automated-target; watched/progress **25/35 (71.4%)**, **10/35 (28.6%)**, **11/35 (31.4%)**; watchlist **23/35 (65.7%)**, **8/35 (22.9%)**, **9/35 (25.7%)**; reviews **15/35 (42.9%)**, **1/35 (2.9%)**, **2/35 (5.7%)**; following **14/35 (40%)**, **1/35 (2.9%)**, **1/35 (2.9%)**; followers **14/35 (40%)**, **0/35 (0%)**, **0/35 (0%)**.
- **6/6 (100%)** canonical feature families are executable: ratings, watched/progress, watchlist, reviews, following, and followers. **0/6 (0%)** remain model-only.
- **2/2 (100%)** executor direction modes are shipped: one-way and capability-gated two-way; **0/2 (0%)** are missing. This mode metric does not claim universal pair or data-shape compatibility.

These values are also generated live by `GET /v1/support-summary`, `watchbridge support-summary`, and the web support panel. The implementation is `getRuntimeSupportSummary()` with contract tests, so these counts fail tests if the registry changes without updated expectations.

The five workflow categories below are exhaustive and mutually exclusive. Cross-cutting metrics such as metadata support may overlap them. “Selectable” means discoverable in the catalog, not that account sync exists.

| Runtime workflow | Services | Shipped behavior |
|---|---|---|
| Direct account | TMDb, Trakt, Simkl, MyAnimeList, Shikimori, Annict, Bangumi, Jellyfin, Emby, Kodi, Plex | User-authorized one-way account transfer and capability-gated two-way reconciliation for the features listed below. |
| Dedicated file | IMDb, Letterboxd, MovieLens | Strict service-specific file manifests produce validated backup-v1 sources through the API, offline CLI, or web panel. Letterboxd additionally has a verified ratings/watched/watchlist/reviews target-file generator. |
| Metadata/recommendation | OMDb, TVmaze, TheTVDB, TasteDive, Kitsu | Identifier/metadata resolution or recommendations; no user-account data sync. |
| Manual mapping | TV Time, Metacritic, Reelgood, Serializd, AllMovie, Criticker, FilmAffinity, Flickchart, Taste.io, MUBI, Common Sense Media, Douban Movie, Kinopoisk | Generic mapped CSV to all six canonical families when a lawful user-owned export has the mapped columns. WatchBridge neither fetches these services nor guarantees that they offer an export. |
| Restricted | Rotten Tomatoes, JustWatch, AniList | No connector or mapped-file workflow until required approval/access is obtained. |

## Shipped user-facing surfaces

- `GET /v1/services`, `watchbridge services`, the planner UI, and `GET /v1/support-summary` expose the catalog, runtime profile, and computed percentages. `watchbridge support-summary` prints the same summary; the web panel computes it from the same core registry.
- `POST /v1/sync/execute`, `watchbridge execute-sync`, and the web account-sync panel run one-way account transfers or capability-gated two-way reconciliation among the eleven direct connectors. `watchbridge plan <source> <target> <feature> [one-way|two-way]` and the web planner expose the same direction-aware method checks; execution still validates record identity and connector-specific fidelity.
- `POST /v1/import/provider-files`, the offline `watchbridge import-provider-files` command, and the web provider-file panel convert IMDb, Letterboxd, or MovieLens exports into strict `watchbridge.backup.v1` sources.
- `POST /v1/export/letterboxd-files`, the offline `watchbridge generate-letterboxd-files backup.json selection.json` command, and the web Letterboxd export panel generate bounded CSV files for Letterboxd's profile or watchlist importer. They never sign in, upload, or mutate a Letterboxd account.
- `POST /v1/sync/from-backup`, `watchbridge execute-backup-sync`, and the web backup-sync panel preview or apply a canonical file source to an implemented account target.
- `POST /v1/backups/:id/restore` and `watchbridge restore-backup` provide additive, same-service restore for a saved direct-connector backup. Cross-service migration uses `/v1/sync/from-backup` instead.
- Account-sync web results expose the target pre-write backup and, for confirmed two-way execution, the source pre-write backup. Backup-sync results expose the target backup. The browser downloads each with same-origin `GET /v1/backups/:id`, omits browser credentials, and sends the in-memory WatchBridge API key as `Authorization: Bearer` when provided. It validates the identifier, enforces a 50 MiB response bound, and requires the backup-v1 schema marker before saving the JSON.
- `GET /v1/sync/jobs` and `GET /v1/sync/jobs/:id` expose durable `pending`, `succeeded`, and `failed` audit records. A job must be persisted before execution starts; failed writes retain the failed feature/direction, partial-write warning, completed actions, and available source/target pre-write backup IDs.
- `POST /v1/metadata/resolve`, `watchbridge resolve-metadata`, and the web metadata panel serve TMDb, exact-IMDb-ID OMDb, TVmaze, TheTVDB, and exact-ID Kitsu metadata. `POST /v1/recommendations`, `watchbridge recommend`, and the web recommendation panel serve TasteDive recommendations. The web sends request-scoped provider credentials in same-origin JSON without browser credentials and validates result envelopes before rendering them.

Confirmed writes require `confirmWrite: true`. Before the first remote mutation, the executor persists the target snapshot and, for two-way execution, the source snapshot too. It then runs every prepared feature/direction batch through non-mutating connector preflight. A later provider/network failure can still leave a partial remote write, which is why failed jobs report `failedDirection` and `writeMayBePartial` and preserve every available pre-write backup. Repository unit/contract tests cover these paths; authorized live-provider end-to-end certification remains a production gate.

## Exact executable user-data paths

| Service | Account read | Account write | File read | Target-specific generator |
|---|---|---|---|---|
| TMDb | Ratings, watchlist | Ratings, watchlist | — | — |
| Trakt | Ratings, watched, watchlist, current-user reviews, following, followers | Ratings, watched, watchlist, constrained review creation, additive public-profile following | — | — |
| Simkl | Ratings, watched, watchlist | Ratings, watched, watchlist | — | — |
| MyAnimeList | Ratings, watched/progress, watchlist/status | Ratings, watched/progress, watchlist/status | — | — |
| Shikimori | Anime ratings, watched/progress/status, planned watchlist | Anime ratings, watched/progress/status, planned watchlist | — | — |
| Annict | Work/episode watched state and planned watchlist | Work/episode watched state and planned watchlist | — | — |
| Bangumi | Anime ratings, exact episode history/progress, collection watchlist/status | Anime ratings, exact episode history/progress, collection watchlist/status | — | — |
| Jellyfin | Ratings; completed watched state for movies/exact episodes | Ratings; completed watched state for movies/exact episodes | — | — |
| Emby | Completed watched membership for movies/exact episodes | Completed watched membership for movies/exact episodes | — | — |
| Kodi | Integer ratings; completed play counts for movies/exact episodes; managed movie watchlist | Integer ratings; completed play counts for movies/exact episodes; managed movie watchlist | — | — |
| Plex | Server-scoped personal ratings; completed played membership for movies/exact episodes | Server-scoped personal ratings; completed played membership for movies/exact episodes | — | — |
| IMDb | — | — | Ratings, Check-ins watched membership, watchlist CSV | — |
| Letterboxd | — | — | Ratings, watched, watchlist, reviews CSV | Ratings, watched, watchlist, reviews CSV |
| MovieLens | — | — | Ratings/movies/links CSV bundle | — |

All six canonical families round-trip through backup v1 and the connector executor. Two-way execution is limited to two live direct-account connectors and a selected feature for which both sides register account read and write support; a backup/file source cannot be used for two-way sync. Following and followers are blocked from cross-provider reconciliation because usernames are provider-scoped, and followers are always read-only.

### Trakt review/comment fidelity boundary

Trakt review export is authenticated and reads only the current user's top-level rows from `/users/me/comments/reviews/all`, never a public username or reply feed. Pagination is bounded to 1,000 pages and 100,000 records. Movie, show, season, and episode Trakt identities remain type-specific; the export preserves the exact current body, spoiler flag, creation time, and the current user's attached integer rating when Trakt returns one. Replies, list comments, and unknown media types fail closed instead of being recast as canonical reviews.

Review creation uses Trakt's single-comment endpoint, whose current official schema accepts one positive integer Trakt media ID, a comment body, and an explicit spoiler flag. WatchBridge therefore rejects alternative-only IDs, anime/manga ambiguity, replies, missing spoiler state, fewer than 200 whitespace-delimited words, `reviewedAt`, and attached canonical ratings. A write batch is limited to 1,000 reviews. Before the first mutation it validates the full batch, checks `/users/settings` for `permissions.commenting`, snapshots all current reviews, skips an exact existing duplicate, and rejects a normalized-body duplicate whose exact text or spoiler state differs. After all creates it rereads the authenticated review feed and verifies every returned comment ID, media identity, body, spoiler flag, and Trakt `review: true` classification. Trakt exposes no atomic multi-comment transaction, so a later provider failure can still leave already verified earlier creates in place.

The connector enforces the provider's mechanically verifiable review rules; the account owner remains responsible for Trakt's substantive community/content rules and User Submission terms. Official contracts: [Trakt comment routes](https://github.com/trakt/trakt-api/blob/master/projects/api/src/contracts/comments/index.ts), [current-user comment route](https://github.com/trakt/trakt-api/blob/master/projects/api/src/contracts/users/index.ts), [comment request schema](https://github.com/trakt/trakt-api/blob/master/projects/api/src/contracts/comments/schema/requests/commentPostParamsSchema.ts), [commenting permission](https://docs.trakt.tv/reference/getuserssettings), [comment rules](https://trakt.tv/about), and [Terms of Use](https://trakt.tv/terms).

### Trakt social-graph fidelity boundary

Trakt following and follower export is authenticated and fixed to `/users/me/following` and `/users/me/followers`. The current official contract returns each collection as one full array with `extended` as its only query option, not a paginated route, so WatchBridge does not invent `page` or `limit` parameters. Each response is bounded to 100,000 records and fails closed on malformed timestamps, deleted identities, duplicate case-insensitive usernames, or duplicate Trakt account IDs. Canonical rows preserve the exact provider `username`, optional non-empty `name` as `displayName`, and required `followed_at`. No profile URL is synthesized because the official profile schema exposes no exact profile URL field.

Following import is additive and limited to 1,000 timestamp-free Trakt rows with `direction: "following"`; follower membership has no writer and remains read-only. The complete local batch is validated before provider traffic, with case-insensitive username duplicates, `profileUrl`, `followedAt`, foreign services, and follower-direction rows rejected. For a real write, WatchBridge requires `/users/settings` to return `permissions.following: true` and an exact authenticated identity, snapshots current following, then resolves every new username to an exact public, non-deleted profile before the first mutation. An optional `displayName` is accepted only when it exactly matches the provider profile. Private profiles are rejected because the endpoint would create a pending approval request rather than verified following membership. New relationships are created sequentially with `POST /users/{slug}/follow`; an absent `approved_at`, response identity drift, or a missing identity in the final authenticated following reread fails closed. Trakt exposes no atomic multi-follow transaction, so a later provider failure can leave earlier creates in place. Official contracts: [user social routes](https://github.com/trakt/trakt-api/blob/master/projects/api/src/contracts/users/index.ts), [follower row schema](https://github.com/trakt/trakt-api/blob/master/projects/api/src/contracts/users/schema/response/followerResponseSchema.ts), [follow response schema](https://github.com/trakt/trakt-api/blob/master/projects/api/src/contracts/users/schema/response/followResponseSchema.ts), [profile schema](https://github.com/trakt/trakt-api/blob/master/projects/api/src/contracts/_internal/response/profileResponseSchema.ts), and [settings/permission schema](https://github.com/trakt/trakt-api/blob/master/projects/api/src/contracts/users/schema/response/settingsResponseSchema.ts).

### Shikimori fidelity and OAuth boundary

Shikimori is an anime-only full-three-feature connector over the official OAuth `user_rates` surface. The authorization helper requests exactly `user_rates`; writes also require the caller to pass that exact scope in `oauthScope`. Connection verifies the configured numeric `accountId` against `/api/users/whoami`, requires an identifying application User-Agent, fixes live traffic to Shikimori's HTTPS origin, and spaces live requests more conservatively than the documented 5 rps / 90 rpm ceiling.

One provider user-rate row can contain score, mutually exclusive list status, episode progress, and rewatch count. WatchBridge keeps those fields independent only when it can prove the untouched fields remain unchanged: rating-only writes require an existing user rate, planned-watchlist writes refuse to replace a watching/completed/on-hold/dropped row, and watched writes validate the requested status/progress/replay combination against current anime metadata. Ratings must convert exactly to an integer 1–10 score without rounding. Provider timestamps and review text cannot be preserved; MAL-only identity cannot be reverse-mapped to a Shikimori ID; manga user rates are outside this connector.

Official contracts: [Shikimori API](https://shikimori.io/api/doc) and [Shikimori OAuth](https://shikimori.io/oauth).

### Annict watched/watchlist boundary

Annict is anime-only and registers watched plus watchlist reads/writes, never ratings. Its helper requests exactly `read write`; the connector checks the configured scope, token-info owner/scopes, REST `/v1/me`, and GraphQL viewer identity before exporting or writing. Annict does not issue a refresh token in this flow, so WatchBridge ships start, exchange, and revoke—not refresh—through the API, CLI, and web authorization panel.

Work-level statuses map `wanna_watch` to planned watchlist and map watching, watched, on-hold, and stopped states to canonical watched state. Planned writes never move an existing non-planned work backwards. Exact episode history requires paired `annictWork` and `annictEpisode` IDs verified against the provider; writes are additive record creation and never reduce an existing play count. Work timestamps/progress/replay counts and episode timestamps/progress/list status are rejected when Annict cannot preserve them, and one batch may create at most 1,000 new episode records. Annict's ratings are attached to individual records rather than a lossless canonical title rating, so the connector deliberately contributes **0** rating source/write slots.

Official contracts: [Annict REST API](https://developers.annict.com/docs/rest-api/v1), [Annict GraphQL API](https://developers.annict.com/docs/graphql-api/beta), and [Annict OAuth](https://developers.annict.com/docs/authentication/oauth).

### Bangumi fidelity and limits

Bangumi is a direct, anime-only connector for ratings, watched/progress, and watchlist collection status. Its context requires a user-obtained official access token and a non-generic `userAgent` that identifies the developer/application. WatchBridge sends the token as Bearer authentication, requires HTTPS, keeps requests on the configured provider origin, and does not ship a dedicated Bangumi OAuth helper.

Episode history is exact-ID based. Every completed episode write must include both the Bangumi anime subject ID and a `bangumiEpisode` ID that the connector verifies belongs to that subject. Aggregate progress is accepted only when the supplied completed main-episode IDs exactly match the count; completed and in-progress title states must also agree with the provider's main-episode total. This avoids inventing episode identity from a number alone.

Bangumi cannot preserve rating, watched, or watchlist timestamps, review text, replay counts, or canonical rewatch state, so those inputs are rejected. Rating-only writes use `PATCH` and are restricted to subjects already present in the account collection; adding a new rating without a selected collection status fails closed. The connector maps only anime subjects plus wanted, doing, and done collection semantics. Bangumi book/manga progress and on-hold or dropped collection states are not round-tripped.

Official contracts: [Bangumi API](https://bangumi.github.io/api/) and [Bangumi authorization guide](https://github.com/bangumi/api/blob/master/docs-raw/How-to-Auth.md).

### Jellyfin fidelity and deployment boundary

Jellyfin is a direct connector for one explicitly selected self-hosted server. It registers ratings and completed watched-state reads/writes only. Jellyfin favorites and likes are deliberately ignored: neither is a canonical watchlist, so Jellyfin contributes no watchlist source or target slot.

The connector context requires a server-issued `accessToken`, an explicit HTTPS `baseUrl`, and an identifying User-Agent. It binds item IDs to the connected server, rejects cross-server IDs, keeps requests under the configured origin/path, and otherwise requires exactly one canonical library match. Because the production API rejects all request-supplied provider URLs by default, a Jellyfin deployment also requires the owner to set exact lowercase `WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true`. That switch lets every authenticated WatchBridge caller choose a credential destination, so the server must be owner-controlled and outbound DNS/IP/TLS allowlists remain mandatory; see [Deployment](DEPLOYMENT.md).

Ratings are bounded to WatchBridge's 0–10 scale in 0.1 steps; rating timestamps and review text are rejected. Watched writes support completed movies and exact episodes with optional last-played time and consistent play/rewatch counts. Preflight rejects a write that would reduce the server's existing `PlayCount` or move `LastPlayedDate` backwards; a plain watched record becomes a no-op when the server already holds richer completed state. Aggregate series/season/anime/manga state, in-progress playback, and unit progress are rejected instead of being coerced into Jellyfin's `Played` flag. Two-way watched reconciliation remains latest-state based rather than a full play-event-history merge.

Official contracts: [Jellyfin user-data DTO](https://typescript-sdk.jellyfin.org/interfaces/generated-client.UpdateUserItemDataDto.html) and [Jellyfin Quick Connect](https://jellyfin.org/docs/general/server/quick-connect/).

### Emby watched-state and deployment boundary

Emby is a watched-only direct connector for one explicitly selected self-hosted server. It reads completed membership for movies and exact episodes, and writes only additive `Played=true` marks; it never marks an item unplayed. Timestamps, replay/play counts, in-progress playback, unit progress, and aggregate series/season state are rejected rather than reduced to Emby's played flag. Numeric ratings are blocked because the official surface does not document a safe rating scale and merge contract for this connector. Favorites and likes are not a canonical watchlist, so Emby registers neither ratings nor watchlist methods.

The request-scoped context requires `accessToken` (a server-issued user token or approved API key), the selected user's `accountId`, an explicit HTTPS `baseUrl`, and an identifying `userAgent`. Emby item IDs are scoped to the server that issued them, so cross-server IDs cannot be treated as exact matches. Production use requires exact lowercase `WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true`, the same high-risk owner opt-in used by other self-hosted connectors. The selected server must be owner-controlled, and outbound DNS/IP/TLS allowlists remain mandatory because application URL validation cannot contain private-network or DNS-rebinding destinations by itself; see [Deployment](DEPLOYMENT.md). Two-way reconciliation with Emby is available only for the narrow completed watched-membership shape and still depends on exact identity matching.

Official contracts: [Emby REST API access and authentication](https://dev.emby.media/doc/restapi/index.html), [Emby user library](https://dev.emby.media/reference/RestAPI/UserLibraryService.html), and [Emby playstate](https://dev.emby.media/reference/RestAPI/PlaystateService.html).

### Kodi library/profile boundary

Kodi is a direct connector to one owner-selected Kodi Omega 21 library/profile. It requires caller-provided JSON-RPC HTTP Basic `username` and `password`, the exact current `profileName`, a caller-generated `kodiLibraryScope` UUID used to bind otherwise local item IDs, an identifying User-Agent, and an explicit HTTPS URL ending exactly in `/jsonrpc`. WatchBridge has no Kodi login helper and does not persist these request-scoped credentials. Production API use requires the custom-provider-URL owner opt-in plus an outbound DNS/IP/TLS allowlist for that Kodi host.

Connection verifies `JSONRPC.Ping`, JSON-RPC protocol **13.5** exactly, Kodi major version **21**, the current profile label, and both read/update permissions. The connector reads and writes integer 1–10 `userrating` plus completed movie/exact-episode `playcount`; exact writes never reduce an existing play count. It rejects aggregate TV state, resume/in-progress progress, review/rating timestamps, and `lastplayed` because Kodi exposes it as a naive local time. Kodi favourites remain outside the canonical watchlist. Instead, movie-only watchlist membership is managed through the connector-owned, library-scoped tag `watchbridge:watchlist:<kodiLibraryScope>`; writes are additive and preserve every unrelated tag. TV shows, seasons, episodes, timestamps, and foreign-scoped WatchBridge tags are rejected rather than recast as this managed list.

Official contracts: [Kodi JSON-RPC overview](https://kodi.wiki/view/JSON-RPC_API) and [Kodi Omega JSON-RPC v13.5](https://kodi.wiki/view/JSON-RPC_API/v13.5).

### Plex ratings, played membership, and terms boundary

Plex is a ratings and completed-played-membership connector for one explicitly selected, machine-ID-verified Plex Media Server. At present the caller must provide an existing Plex account `accessToken`, a stable installation `clientIdentifier`, the selected `plexServerId`, and an identifying User-Agent; WatchBridge does **not** ship a Plex sign-in, PIN, or token-acquisition helper. It verifies the Plex account, asks the official resources service for the selected server and its per-server token, accepts only discovered credential-free HTTPS connections, verifies the claimed server identity, and discovers the library metadata/content/rate/timeline feature keys at runtime.

Ratings are server-scoped and cover exactly resolved movie, show, season, or episode library items. Writes use the discovered `rate` feature, reread the item, and verify the exact result; timestamps, reviews, ambiguous/cross-server identity, and rating deletion are rejected. Completed watched membership is read only from movie or exact-episode `viewCount > 0` and written only through the provider-discovered `scrobbleKey`. Plex documents that operation as setting played state without creating view history, so WatchBridge deliberately omits/rejects timestamps, progress, replay counts, rewatched status, and aggregate show/season state. No global-watchlist contract is registered, so Plex contributes ratings and watched support: **2/3** primary families and **2/6** canonical families.

The connector is intended only for a user's own lawful personal deployment. Plex's current Terms grant personal, non-commercial use and impose additional restrictions; operators must review those terms and obtain any permission required for a different deployment. Repository support is not Plex endorsement or permission for commercial/third-party service use.

Official contracts: [Plex Media Server API](https://developer.plex.tv/pms/), [played-state operation](https://developer.plex.tv/pms/#tag/Timeline/operation/putScrobble), and [Plex Terms of Service](https://www.plex.tv/about/privacy-legal/plex-terms-of-service/).

### Letterboxd target-file fidelity and limits

The Letterboxd generator accepts only a strict `watchbridge.backup.v1` archive and an explicit non-empty selection of `ratings`, `watched`, `watchlist`, and/or `reviews`. It emits UTF-8 CSV files named `letterboxd-<feature>-NNN.csv`; each file includes its header and is at most **1,000,000 UTF-8 bytes**. Large features are split into numbered chunks, a selected empty feature produces a header-only file, and a single row that cannot fit with its header is rejected.

Generated rows are movie-only. Ratings are converted to Letterboxd's 0.5–5 scale and use `imdbID,tmdbID,Title,Year,Rating`. Watched files use `imdbID,tmdbID,Title,Year,WatchedDate,Rewatch`, watchlist files use `imdbID,tmdbID,Title,Year`, and review files use `imdbID,tmdbID,Title,Year,Rating,Review`. A review's optional attached rating is converted explicitly; spoiler-marked reviews are rejected because the documented import has no spoiler column, and `reviewedAt` is omitted with a warning because it has no review-date column. TV, season, episode, anime, manga, and other non-film records are rejected instead of being mislabeled.

The watched generator also rejects state that the documented CSV cannot preserve: in-progress playback, any aggregate `progress`, play counts greater than one, a rewatch without `watchedAt`, and malformed watched dates. A valid date-time is reduced to its written `YYYY-MM-DD` prefix, so the user must verify dates and title matches before confirming the Letterboxd import. Profile imports may mark rated films as watched; this warning is returned with every ratings file.

The API and web panel return the CSV content plus feature, record count, destination, and warnings. The CLI prints the same JSON bundle locally. WatchBridge does not automate Letterboxd authentication or upload: the user downloads the chunks and submits them to Letterboxd's [profile importer](https://letterboxd.com/import/) or [watchlist importer](https://letterboxd.com/watchlist/import/).

### SIMKL history fidelity and limits

SIMKL backups use the documented nested `show` / `movie` response objects and request real episode rows with `extended=full`, `episode_watched_at=yes`, and `include_all_episodes=original`. The `original` value matters: unlike `include_all_episodes=yes`, it does not synthesize episode events from air dates. TV and anime history is stored as canonical episode rows with the parent SIMKL ID, season, episode, timestamp, and rewatch-session marker needed to reconstruct SIMKL's nested `/sync/history` payload.

SIMKL rewatch sessions are available only to Pro/VIP accounts. The connector checks `POST /users/settings` and sends `allow_rewatch=yes` only when `account.type` is `pro` or `vip`; a free-tier write is rejected before any history mutation. Separate sessions are written sequentially, and inputs that would violate SIMKL's documented 48-hour same-item session gap are rejected rather than collapsed.

The canonical model has no generic parent-show relationship for arbitrary episode records. Consequently, SIMKL can restore episode rows produced by a SIMKL backup, but it rejects unrelated episode records that contain only an episode ID and no parent SIMKL reference. It also rejects in-progress playback in watched-history writes because SIMKL documents playback progress as a separate API. Older completed titles for which SIMKL returns no real per-episode rows can preserve completion state, but not episode-level timestamps that the provider never supplied.

These full-history reads are explicit user-requested backup operations and run sequentially by media type. They must not be reused as a background polling loop; continuous clients should follow SIMKL's activity-timestamp and `date_from` sync pattern.

Official contracts: [Get all items](https://api.simkl.org/api-reference/simkl/get-all-items), [Add to history](https://api.simkl.org/api-reference/simkl/add-to-history), [Sync guide](https://api.simkl.org/guides/sync), [Rewatches](https://api.simkl.org/guides/rewatches), and [User settings](https://api.simkl.org/api-reference/simkl/get-user-settings).

The IMDb-shaped ratings CSV helper is a portable export utility, not evidence that IMDb accepts account imports. IMDb's official [Ratings FAQ](https://help.imdb.com/article/imdb/track-movies-tv/faq-for-imdb-ratings/G67Y87TFYYP6TWAV), [Lists FAQ](https://help.imdb.com/article/imdb/track-movies-tv/lists-faq/GNQMN47VZSE7KW38), and [Check-ins FAQ](https://help.imdb.com/article/imdb/track-movies-tv/check-ins-faq/GG59ELYW45FMC7J3) document CSV export. Check-ins contribute timestamp-free watched membership only; WatchBridge does not treat a list-created timestamp as a viewing timestamp or infer an account import feature. No planner operation may describe a target-specific import file unless `generatedImportFileFeatures` registers a verified shipped generator.

## Metadata and recommendations

- TMDb, OMDb, TVmaze, TheTVDB, and Kitsu ship metadata resolvers. TMDb is classified as direct-account because it also has user-data paths; OMDb is exact-IMDb-ID and API-key based.
- TasteDive ships a recommendation connector.
- Metadata and recommendations never imply access to ratings, watched history, watchlists, reviews, or social relationships.

OMDb is an API-key metadata-only connector for one exact `externalIds.imdb` lookup at a time. It sends an HTTPS `GET` only to OMDb's documented ID route with `i`, `apikey`, and `r=json`; it does not use title search, list search, JSONP, XML, account/user-data paths, or the separate patron-only poster API. Responses must report an exact success/error discriminator, the requested IMDb ID, the matching `movie`/`series`/`episode` type, a bounded title, and a valid year or year range before WatchBridge returns canonical metadata.

OMDb's official site labels its content [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), and its [Terms of Use](https://www.omdbapi.com/legal.htm) limit use to personal, non-commercial purposes. Deployers must independently confirm that their use and API-key plan comply. Official API contracts: [parameters and usage](https://www.omdbapi.com/) and [Swagger contract](https://www.omdbapi.com/swagger.json).

Kitsu is deliberately narrower than a search connector. It performs unauthenticated JSON:API `GET` requests only to the fixed production routes `/anime/{id}`, `/manga/{id}`, or `/episodes/{id}`, selected by canonical kind and an exact positive integer `externalIds.kitsu`. It never calls collection search, Algolia, mappings, users, or library entries. Responses must preserve the exact requested resource ID/type and provide a valid canonical title; nullable dates supply the year, and documented non-negative episode coordinates, including zero, are preserved when present.

Kitsu contributes metadata but **0/6 canonical account-sync families**. In the current official source OpenAPI, user/library-entry paths and their schemas are not active contracts, while the remaining authentication material describes a password grant. WatchBridge does not collect a Kitsu password or infer account methods from legacy or commented material. The metadata connector therefore sends no authorization header and exports only an empty metadata-only backup envelope.

Official contracts: [rendered Kitsu OpenAPI](https://hummingbird-me.github.io/api-docs/), [source OpenAPI root](https://github.com/hummingbird-me/api-docs/blob/openapi3/api/kitsu.yml), and the exact [anime](https://github.com/hummingbird-me/api-docs/blob/openapi3/api/paths/media/anime_id.yml), [manga](https://github.com/hummingbird-me/api-docs/blob/openapi3/api/paths/media/manga_id.yml), and [episode](https://github.com/hummingbird-me/api-docs/blob/openapi3/api/paths/media/episodes_id.yml) route definitions.

See [Manual CSV Import](MANUAL_CSV_IMPORT.md) and [Sync Execution](SYNC_EXECUTION.md) for the executable file-to-account and account-to-account paths.
