# Roadmap

## Shipped workflow foundation

- Canonical model.
- Provider-capability matrix plus an exhaustive shipped-runtime registry and tested runtime percentage summary.
- Rating conversion engine.
- One-way and capability-gated two-way sync planner backed by the shipped-runtime registry.
- Letterboxd CSV parser.
- Portable IMDb-shaped ratings CSV helper (not claimed as an IMDb account-import format), plus strict IMDb Ratings, Check-ins, and Watchlist export readers.
- Web planner, support-percentage, six-provider OAuth, one-way/two-way account-sync, provider-file, backup-sync, additive restore, durable job browsing/detail, authenticated backup-download, manual CSV, Letterboxd export, metadata, and recommendation panels.
- Tested backup-first one-way and two-way sync execution across all six canonical families, whole-request directional preflight, dry-run reports, bounded redacted conflict details, conflict policies, and durable `pending`/`succeeded`/`failed` job history.
- Thirteen direct-account connectors: TMDb, Trakt, Simkl, MyAnimeList, anime-only Shikimori, anime-only Annict, anime-only Bangumi, user-selected Jellyfin, Emby, and Movary servers, one scoped Kodi library/profile, one selected Plex Media Server, and AniList. AniList supports exact-ID anime/manga media-list ratings, watched/progress, planned-watchlist operations, reviews, and guarded social reads/additive follows; Movary is movie-only and supports exact-ID watched-history/watchlist operations, not ratings. Strict API/CLI/web IMDb, Letterboxd, and MovieLens file workflows remain separate.
- TMDb, API-key exact-IMDb-ID OMDb and Watchmode, public exact-Q-item Wikidata, TVmaze, credential-required TheTVDB V4, and public exact-ID Kitsu metadata, plus TasteDive recommendations. Watchmode is exact IMDb-ID metadata only; availability/source display, images, caching, account data, and title-name search remain unshipped.
- State-verified account-authorization API, CLI, and web flows for TMDb, Trakt, Simkl, MyAnimeList, Shikimori, and Annict, including refresh or revocation where the provider supports it. Bangumi uses a separately obtained official token; Jellyfin and Emby use server-issued tokens; Kodi uses request-scoped JSON-RPC Basic credentials; Plex uses a caller-provided account token; Movary uses a caller-provided API token, username, and explicit HTTPS `/api/` base URL; AniList uses a caller-provided OAuth access token. None of those other seven has a WatchBridge authorization helper.
- Validated `watchbridge.backup.v1` file-to-account sync through the same backup-first executor.
- Additive, same-service backup restore through the API, CLI, and web, with a fresh target snapshot before confirmed restore writes.
- Bounded connector/OAuth timeouts, safe idempotent-read retries, abort handling, and sanitized provider errors.
- API, CLI, and web metadata/recommendation workflows, support-summary API/CLI output, and registry-derived web percentages.
- Optional authenticated encryption for new file-backed backups and audit jobs, with explicit one-time plaintext migration.
- User-controlled Letterboxd ratings/watched/watchlist/reviews target-file generation through API, offline CLI, and web download, with movie-only and lossy-input rejection plus 1,000,000-byte CSV chunking.
- Trakt current-user review export and constrained review creation, plus authenticated following/follower export and additive verified public-profile following; followers remain read-only.
- Opt-in retention and explicit dry-run/confirmed cleanup for jobs and backups, with pending-job protection, retained-job reference preservation, and corrupt-inventory fail-closed behavior.
- Bangumi ratings, exact completed-episode state/progress, and collection watchlist/status reads and writes, with anime-only mapping, existing-collection-only rating updates, HTTPS/Bearer/User-Agent enforcement, and rejection of timestamps, replay/rewatch, books, and unsupported collection states.
- Jellyfin ratings and completed movie/exact-episode watched-state reads and writes for one explicit HTTPS server, with instance-scoped identity, no favorites-to-watchlist mapping, production owner opt-in for the self-hosted URL, and guards against reducing an existing play count or moving its last-played timestamp backwards.
- Emby completed movie/exact-episode watched-membership reads and writes for one explicit HTTPS server, with timestamps, replay/play counts, progress, aggregate state, numeric ratings, and favorites-to-watchlist mapping blocked; production requires the self-hosted URL owner opt-in and outbound DNS/IP/TLS allowlisting.
- Shikimori anime ratings, watched/progress/status, and planned-watchlist reads/writes with exact `user_rates` scope, independently guarded shared-row updates, conservative live throttling, and rejection of timestamps, manga rows, lossy rating conversion, and MAL-only reverse lookup.
- Annict work/episode watched state and planned-watchlist reads/writes with exact `read write` scope, cross-surface identity verification, additive exact-episode records, API/CLI/web OOB authorization and revocation, and no title-rating claim.
- Kodi Omega 21 / JSON-RPC 13.5 integer ratings, completed movie/exact-episode play-count reads/writes, and a library-scoped managed movie-watchlist tag for one exact profile/library, with no resume/timestamp path and the production custom-URL network boundary documented.
- Plex server-scoped rating and completed movie/exact-episode played-membership reads/writes using caller-provided account token context, machine-ID-verified server discovery, runtime feature-key discovery, no global-watchlist support, and explicit personal/non-commercial terms caveat.
- Kitsu public unauthenticated exact-ID anime/manga/episode metadata with strict JSON:API identity validation and no search, mapping, user-library, password collection, or account-sync claim.

## Remaining product work

- Additional providers' direct social readers or additive same-service following only where official contracts and exact user-identity evidence support them; follower lists remain read-only.
- Shared filesystem job/backup records now use atomic writes and per-job claims; browser OAuth callbacks, encrypted shared OAuth state, and encrypted connector-context vault references are shipped. A multi-tenant secret-management service, identity-aware authorization, and multi-instance recovery certification are not claimed.
- Candidate quality improvements for records that cannot be matched safely. Bounded canonical conflict review, per-record source/target choices for already-matched manual conflicts, conservative scored title-similarity suggestions (same-kind, same-year when known, and mutually unambiguous) from current dry-run snapshots, a structured exact source-to-target canonical-ID override editor, and exact-preview gating before web-confirmed writes are shipped. Suggestions are advisory only and never alter automatic identity rules.
- Additional direct connectors or verified target import-file generators only where provider documentation, authorization, and tests support them.

## Researched platform candidates

These are expansion candidates, not shipped services. They are not part of the current 38-entry catalog or its 228 canonical-family slots, so they do not change the support percentages. A feature is marked **strict** only when the official interface appears to provide authenticated read and write operations for the same canonical meaning; favorites, generic collections, per-file flags, and undocumented endpoints do not count as watchlist/history equivalents. Every candidate still needs authorization, schema fixtures, connector tests, live smoke tests, and a registry change before it may be advertised as supported.

| Candidate | Access model | Ratings | Watched/progress | Watchlist | Strict score and next gate | Official references |
|---|---|---|---|---|---|---|
| AniDB | Registered UDP client using an AniDB user session | Strict anime vote | Partial—MyList `viewed` is file/episode-oriented | No—MyList ownership/storage is not a watchlist | **1/3; defer.** Raw-credential/session handling, UDP limits, and file-centric semantics are a poor fit for an initial connector. | [UDP API definition](https://wiki.anidb.net/UDP_API_Definition) |

### Additional metadata, availability, and self-hosted options

These options are better evaluated by workflow fit than by the three primary account families. None is currently selectable or included in the percentages.

| Candidate | Best fit | Access model | Priority and next gate | Official references |
|---|---|---|---|---|
| Ryot | User-owned self-hosted media account connector | Owner-controlled server with a GraphQL API | **High portability value.** Pin a supported server/API version, audit authentication and all six family semantics, then apply the same HTTPS custom-origin/network controls as other self-hosted connectors. | [Official repository and GraphQL link](https://github.com/IgnisDa/ryot) |
| MDBList | Aggregated title scores, lists, and discovery | API key with plan-based daily limits | **Medium metadata priority.** Validate the live OpenAPI schema, source attribution/licensing, cache rules, and exact external-ID behavior before counting any metadata slot. | [API documentation](https://docs.mdblist.com/docs/api) |
| fanart.tv | Optional artwork enrichment only | API key and media ID lookup | **Separate enrichment track.** Require fixed HTTPS behavior, explicit image rights/attribution/caching rules, and bounded URL validation; artwork is not canonical user-data support. | [API v3 documentation](https://fanart.tv/api-docs/api-v3/) |

## Known shipped-platform gaps

- Shikimori is shipped for anime only. Its shared user-rate row still forces rating-only creation, timestamps, manga, and MAL-only identity to fail closed.
- Annict is shipped for watched and planned watchlist only; its per-record rating is not a lossless canonical title rating.
- Kodi is shipped only for Kodi Omega 21 / JSON-RPC 13.5, one explicit HTTPS profile/library, integer ratings, completed play counts, and movie watchlist membership managed through a WatchBridge-owned scoped tag. Native favourites, non-movie watchlists, resume progress, and timestamp fidelity remain absent.
- Plex is shipped for server-scoped personal ratings and completed movie/exact-episode played membership with a caller-provided token. There is no WatchBridge Plex auth helper, progress/replay/timestamp or aggregate-show watched path, global-watchlist path, rating deletion, or commercial/hosted-use permission claim.
- Kitsu is shipped only for public exact-ID metadata. The current official source OpenAPI does not expose active user/library-entry contracts for ratings, history, or watchlist, and its remaining password-grant material is not a safe authorization path for WatchBridge.
- Jellyfin and Emby remain bound to explicit owner-controlled HTTPS servers and the high-risk provider-URL opt-in. Jellyfin has no watchlist; Emby has neither ratings nor watchlist and preserves only additive completed membership.

## Provider-gated work

- Rotten Tomatoes and JustWatch only after an approved partner/API agreement.

## v1.0 production gate

- Live-provider end-to-end integration tests with authorized non-production accounts.
- Authorized live-provider backup/restore recovery drills and partial-write reconciliation tests.
- Live-provider validation of candidate coverage and scoring calibration beyond the shipped conservative title-similarity suggestions from current dry-run snapshots; every accepted mapping remains a user-reviewed exact canonical ID pair.
- Identity-aware authorization, multi-tenant vault policy, and operational recovery certification before multi-instance deployment.
- Signed releases.
- Desktop builds.
- Android/iOS builds.
- Legal-safe connector documentation for every supported service.
