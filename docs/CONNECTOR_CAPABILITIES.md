# Connector and Runtime Support

WatchBridge keeps two different facts separate:

- **Provider capabilities** describe a documented or safely user-controlled path a service may offer.
- **Shipped runtime support** describes code that this repository can execute and test today.

A provider capability never creates a runtime promise. In particular, a provider accepting imports does not mean WatchBridge ships a target-file generator. Letterboxd is the only current exception backed by a shipped generator; all other services still require an explicitly registered implementation. The exhaustive runtime registry is `SERVICE_RUNTIME_SUPPORT` in `packages/core/src/runtimeSupport.ts`; every entry returned by `GET /v1/services` and `watchbridge services` includes its `runtime` profile.

## Current implementation snapshot

- **34/34 (100%)** services are selectable catalog entries; **0/34 (0%)** are missing from the catalog.
- **11/34 (32.4%)** have repository-tested direct-account connectors: TMDb, Trakt, Simkl, MyAnimeList, Shikimori, Annict, Bangumi, Jellyfin, Emby, Kodi, and Plex; **23/34 (67.6%)** do not.
- **3/34 (8.8%)** have dedicated user-file readers: IMDb, Letterboxd, and MovieLens; **31/34 (91.2%)** do not.
- **4/34 (11.8%)** are metadata/recommendation workflow integrations: TVmaze, TheTVDB, TasteDive, and Kitsu; **30/34 (88.2%)** are not in that workflow.
- **13/34 (38.2%)** use the generic mapped-CSV path when the user has a lawful export; **21/34 (61.8%)** do not.
- **3/34 (8.8%)** are restricted: Rotten Tomatoes, JustWatch, and AniList; **31/34 (91.2%)** are not restricted.

Additional completion views, derived from the same registry:

- **5/34 (14.7%)** register direct account read and write methods for all three executable data families: Trakt, Simkl, MyAnimeList, Shikimori, and Bangumi; **29/34 (85.3%)** do not. This is method coverage, not a promise that every cross-provider record has sufficient identity or lossless shape to write. TMDb covers ratings and watchlist; Annict covers watched and watchlist; Jellyfin and Kodi cover ratings and completed watched state; Emby covers only completed watched membership; Plex covers only ratings.
- **27/34 (79.4%)** have at least one shipped account or file source path. The missing **7/34 (20.6%)** are the four metadata/recommendation workflow entries and three restricted entries.
- **5/34 (14.7%)** expose metadata resolution or recommendations: TMDb, TVmaze, TheTVDB, TasteDive, and Kitsu. This cross-cutting metric overlaps the mutually exclusive workflow categories because TMDb is a direct-account platform.
- Across the 102 platform × executable-feature source slots, **70/102 (68.6%)** are readable through an account/file path and **32/102 (31.4%)** are missing.
- Across the same 102 target slots, **25/102 (24.5%)** have a verified account write and **77/102 (75.5%)** do not. Three additional Letterboxd slots generate user-controlled import files, so total automated target coverage is **28/102 (27.5%)** and **74/102 (72.5%)** are missing. File generation is not a Letterboxd account write.
- The live support summary also derives the feature-level split instead of relying on prose. Ratings are **25/34 (73.5%)** source / **9/34 (26.5%)** missing, **9/34 (26.5%)** account-write / **25/34 (73.5%)** missing, and **10/34 (29.4%)** automated-target / **24/34 (70.6%)** missing. Watched/progress is **23/34 (67.6%)** source / **11/34 (32.4%)** missing, **9/34 (26.5%)** account-write / **25/34 (73.5%)** missing, and **10/34 (29.4%)** automated-target / **24/34 (70.6%)** missing. Watchlist is **22/34 (64.7%)** source / **12/34 (35.3%)** missing, **7/34 (20.6%)** account-write / **27/34 (79.4%)** missing, and **8/34 (23.5%)** automated-target / **26/34 (76.5%)** missing.
- **3/6 (50%)** canonical feature families are executable: ratings, watched/progress, and watchlist. Reviews, following, and followers are model-only, so **0/34 (0%)** platforms register direct methods for all six and the missing share is **34/34 (100%)**.
- **2/2 (100%)** executor direction modes are shipped: one-way and capability-gated two-way; **0/2 (0%)** are missing. This mode metric does not claim universal pair or data-shape compatibility.

These values are also generated live by `GET /v1/support-summary`, `watchbridge support-summary`, and the web support panel. The implementation is `getRuntimeSupportSummary()` with contract tests, so these counts fail tests if the registry changes without updated expectations.

The five workflow categories below are exhaustive and mutually exclusive. Cross-cutting metrics such as metadata support may overlap them. “Selectable” means discoverable in the catalog, not that account sync exists.

| Runtime workflow | Services | Shipped behavior |
|---|---|---|
| Direct account | TMDb, Trakt, Simkl, MyAnimeList, Shikimori, Annict, Bangumi, Jellyfin, Emby, Kodi, Plex | User-authorized one-way account transfer and capability-gated two-way reconciliation for the features listed below. |
| Dedicated file | IMDb, Letterboxd, MovieLens | Strict service-specific file manifests produce validated backup-v1 sources through the API, offline CLI, or web panel. Letterboxd additionally has a verified ratings/watched/watchlist target-file generator. |
| Metadata/recommendation | TVmaze, TheTVDB, TasteDive, Kitsu | Identifier/metadata resolution or recommendations; no user-account data sync. |
| Manual mapping | TV Time, Metacritic, Reelgood, Serializd, AllMovie, Criticker, FilmAffinity, Flickchart, Taste.io, MUBI, Common Sense Media, Douban Movie, Kinopoisk | Generic mapped CSV to canonical ratings/watched/watchlist. WatchBridge neither fetches these services nor guarantees that they offer an export. |
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
- `POST /v1/metadata/resolve` plus `watchbridge resolve-metadata` serve TMDb, TVmaze, TheTVDB, and exact-ID Kitsu metadata. `POST /v1/recommendations` plus `watchbridge recommend` serve TasteDive recommendations. There is no metadata/recommendation web panel yet.

Confirmed writes require `confirmWrite: true`. Before the first remote mutation, the executor persists the target snapshot and, for two-way execution, the source snapshot too. It then runs every prepared feature/direction batch through non-mutating connector preflight. A later provider/network failure can still leave a partial remote write, which is why failed jobs report `failedDirection` and `writeMayBePartial` and preserve every available pre-write backup. Repository unit/contract tests cover these paths; authorized live-provider end-to-end certification remains a production gate.

## Exact executable user-data paths

| Service | Account read | Account write | File read | Target-specific generator |
|---|---|---|---|---|
| TMDb | Ratings, watchlist | Ratings, watchlist | — | — |
| Trakt | Ratings, watched, watchlist | Ratings, watched, watchlist | — | — |
| Simkl | Ratings, watched, watchlist | Ratings, watched, watchlist | — | — |
| MyAnimeList | Ratings, watched/progress, watchlist/status | Ratings, watched/progress, watchlist/status | — | — |
| Shikimori | Anime ratings, watched/progress/status, planned watchlist | Anime ratings, watched/progress/status, planned watchlist | — | — |
| Annict | Work/episode watched state and planned watchlist | Work/episode watched state and planned watchlist | — | — |
| Bangumi | Anime ratings, exact episode history/progress, collection watchlist/status | Anime ratings, exact episode history/progress, collection watchlist/status | — | — |
| Jellyfin | Ratings; completed watched state for movies/exact episodes | Ratings; completed watched state for movies/exact episodes | — | — |
| Emby | Completed watched membership for movies/exact episodes | Completed watched membership for movies/exact episodes | — | — |
| Kodi | Integer ratings; completed play counts for movies/exact episodes | Integer ratings; completed play counts for movies/exact episodes | — | — |
| Plex | Server-scoped personal ratings | Server-scoped personal ratings | — | — |
| IMDb | — | — | Ratings, watchlist CSV | — |
| Letterboxd | — | — | Ratings, watched, watchlist CSV | Ratings, watched, watchlist CSV |
| MovieLens | — | — | Ratings/movies/links CSV bundle | — |

The canonical types include reviews, following, and followers, but the versioned backup schema and connector executor do not round-trip them yet. The planner therefore blocks all three. Two-way execution is limited to two live direct-account connectors and a selected feature for which both sides register account read and write support; a backup/file source cannot be used for two-way sync.

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

Connection verifies `JSONRPC.Ping`, JSON-RPC protocol **13.5** exactly, Kodi major version **21**, the current profile label, and both read/update permissions. The connector reads and writes integer 1–10 `userrating` plus completed movie/exact-episode `playcount`; exact writes never reduce an existing play count. It rejects aggregate TV state, resume/in-progress progress, review/rating timestamps, and `lastplayed` because Kodi exposes it as a naive local time. Kodi favourites are not treated as a canonical watchlist, so Kodi contributes no watchlist slot.

Official contracts: [Kodi JSON-RPC overview](https://kodi.wiki/view/JSON-RPC_API) and [Kodi Omega JSON-RPC v13.5](https://kodi.wiki/view/JSON-RPC_API/v13.5).

### Plex ratings and terms boundary

Plex is a ratings-only connector for one explicitly selected, machine-ID-verified Plex Media Server. At present the caller must provide an existing Plex account `accessToken`, a stable installation `clientIdentifier`, the selected `plexServerId`, and an identifying User-Agent; WatchBridge does **not** ship a Plex sign-in, PIN, or token-acquisition helper. It verifies the Plex account, asks the official resources service for the selected server and its per-server token, accepts only discovered credential-free HTTPS connections, verifies the claimed server identity, and discovers the library metadata/content/rate feature keys at runtime.

Ratings are server-scoped and cover exactly resolved movie, show, season, or episode library items. Writes use the discovered `rate` feature, reread the item, and verify the exact result; timestamps, reviews, ambiguous/cross-server identity, and rating deletion are rejected. No timeline/scrobble watched path or global-watchlist contract is registered, so Plex contributes **1/3** account-sync features and no watched/watchlist slots.

The connector is intended only for a user's own lawful personal deployment. Plex's current Terms grant personal, non-commercial use and impose additional restrictions; operators must review those terms and obtain any permission required for a different deployment. Repository support is not Plex endorsement or permission for commercial/third-party service use.

Official contracts: [Plex Media Server API](https://developer.plex.tv/pms/) and [Plex Terms of Service](https://www.plex.tv/about/privacy-legal/plex-terms-of-service/).

### Letterboxd target-file fidelity and limits

The Letterboxd generator accepts only a strict `watchbridge.backup.v1` archive and an explicit non-empty selection of `ratings`, `watched`, and/or `watchlist`. It emits UTF-8 CSV files named `letterboxd-<feature>-NNN.csv`; each file includes its header and is at most **1,000,000 UTF-8 bytes**. Large features are split into numbered chunks, a selected empty feature produces a header-only file, and a single row that cannot fit with its header is rejected.

Generated rows are movie-only. Ratings are converted to Letterboxd's 0.5–5 scale and use `imdbID,tmdbID,Title,Year,Rating`. Watched files use `imdbID,tmdbID,Title,Year,WatchedDate,Rewatch`, and watchlist files use `imdbID,tmdbID,Title,Year`. TV, season, episode, anime, manga, and other non-film records are rejected instead of being mislabeled.

The watched generator also rejects state that the documented CSV cannot preserve: in-progress playback, any aggregate `progress`, play counts greater than one, a rewatch without `watchedAt`, and malformed watched dates. A valid date-time is reduced to its written `YYYY-MM-DD` prefix, so the user must verify dates and title matches before confirming the Letterboxd import. Profile imports may mark rated films as watched; this warning is returned with every ratings file.

The API and web panel return the CSV content plus feature, record count, destination, and warnings. The CLI prints the same JSON bundle locally. WatchBridge does not automate Letterboxd authentication or upload: the user downloads the chunks and submits them to Letterboxd's [profile importer](https://letterboxd.com/import/) or [watchlist importer](https://letterboxd.com/watchlist/import/).

### SIMKL history fidelity and limits

SIMKL backups use the documented nested `show` / `movie` response objects and request real episode rows with `extended=full`, `episode_watched_at=yes`, and `include_all_episodes=original`. The `original` value matters: unlike `include_all_episodes=yes`, it does not synthesize episode events from air dates. TV and anime history is stored as canonical episode rows with the parent SIMKL ID, season, episode, timestamp, and rewatch-session marker needed to reconstruct SIMKL's nested `/sync/history` payload.

SIMKL rewatch sessions are available only to Pro/VIP accounts. The connector checks `POST /users/settings` and sends `allow_rewatch=yes` only when `account.type` is `pro` or `vip`; a free-tier write is rejected before any history mutation. Separate sessions are written sequentially, and inputs that would violate SIMKL's documented 48-hour same-item session gap are rejected rather than collapsed.

The canonical model has no generic parent-show relationship for arbitrary episode records. Consequently, SIMKL can restore episode rows produced by a SIMKL backup, but it rejects unrelated episode records that contain only an episode ID and no parent SIMKL reference. It also rejects in-progress playback in watched-history writes because SIMKL documents playback progress as a separate API. Older completed titles for which SIMKL returns no real per-episode rows can preserve completion state, but not episode-level timestamps that the provider never supplied.

These full-history reads are explicit user-requested backup operations and run sequentially by media type. They must not be reused as a background polling loop; continuous clients should follow SIMKL's activity-timestamp and `date_from` sync pattern.

Official contracts: [Get all items](https://api.simkl.org/api-reference/simkl/get-all-items), [Add to history](https://api.simkl.org/api-reference/simkl/add-to-history), [Sync guide](https://api.simkl.org/guides/sync), [Rewatches](https://api.simkl.org/guides/rewatches), and [User settings](https://api.simkl.org/api-reference/simkl/get-user-settings).

The Letterboxd review parser remains a standalone format utility and is not an executable sync pipeline. The IMDb-shaped ratings CSV helper is also a portable export utility, not evidence that IMDb accepts account imports. IMDb's official [Ratings FAQ](https://help.imdb.com/article/imdb/track-movies-tv/ratings-faq/G67Y87TFYYP6TWAV) and [Lists FAQ](https://help.imdb.com/article/imdb/track-movies-tv/lists-faq/GNQMN47VZSE7KW38) document CSV export; WatchBridge does not infer an import feature from that. No planner operation may describe a target-specific import file unless `generatedImportFileFeatures` registers a verified shipped generator; the list currently contains only Letterboxd ratings, watched, and watchlist.

## Metadata and recommendations

- TMDb, TVmaze, TheTVDB, and Kitsu ship metadata resolvers. TMDb is classified as direct-account because it also has user-data paths.
- TasteDive ships a recommendation connector.
- Metadata and recommendations never imply access to ratings, watched history, watchlists, reviews, or social relationships.

Kitsu is deliberately narrower than a search connector. It performs unauthenticated JSON:API `GET` requests only to the fixed production routes `/anime/{id}`, `/manga/{id}`, or `/episodes/{id}`, selected by canonical kind and an exact positive integer `externalIds.kitsu`. It never calls collection search, Algolia, mappings, users, or library entries. Responses must preserve the exact requested resource ID/type and provide a valid canonical title; nullable dates supply the year, and documented non-negative episode coordinates, including zero, are preserved when present.

Kitsu contributes metadata but **0/3 account-sync features**. In the current official source OpenAPI, user/library-entry paths and their schemas are not active contracts, while the remaining authentication material describes a password grant. WatchBridge does not collect a Kitsu password or infer account ratings/history/watchlist methods from legacy or commented material. The metadata connector therefore sends no authorization header and exports only an empty metadata-only backup envelope.

Official contracts: [rendered Kitsu OpenAPI](https://hummingbird-me.github.io/api-docs/), [source OpenAPI root](https://github.com/hummingbird-me/api-docs/blob/openapi3/api/kitsu.yml), and the exact [anime](https://github.com/hummingbird-me/api-docs/blob/openapi3/api/paths/media/anime_id.yml), [manga](https://github.com/hummingbird-me/api-docs/blob/openapi3/api/paths/media/manga_id.yml), and [episode](https://github.com/hummingbird-me/api-docs/blob/openapi3/api/paths/media/episodes_id.yml) route definitions.

See [Manual CSV Import](MANUAL_CSV_IMPORT.md) and [Sync Execution](SYNC_EXECUTION.md) for the executable file-to-account and account-to-account paths.
