# Roadmap

## Shipped workflow foundation

- Canonical model.
- Provider-capability matrix plus an exhaustive shipped-runtime registry and tested runtime percentage summary.
- Rating conversion engine.
- One-way and capability-gated two-way sync planner backed by the shipped-runtime registry.
- Letterboxd CSV parser.
- Portable IMDb-shaped ratings CSV helper (not claimed as an IMDb account-import format).
- Web planner, support-percentage, six-provider OAuth, one-way/two-way account-sync, provider-file, backup-sync, authenticated backup-download, and manual CSV panels.
- Tested backup-first one-way and two-way sync execution, whole-request directional preflight, dry-run reports, conflict policies, and durable `pending`/`succeeded`/`failed` job history.
- Eleven direct-account connectors: TMDb, Trakt, Simkl, MyAnimeList, anime-only Shikimori, anime-only Annict, anime-only Bangumi, user-selected Jellyfin and Emby servers, one scoped Kodi library/profile, and one selected Plex Media Server. Strict API/CLI/web IMDb, Letterboxd, and MovieLens file workflows remain separate.
- TMDb, TVmaze, credential-required TheTVDB V4, and public exact-ID Kitsu metadata, plus TasteDive recommendations.
- State-verified account-authorization API, CLI, and web flows for TMDb, Trakt, Simkl, MyAnimeList, Shikimori, and Annict, including refresh or revocation where the provider supports it. Bangumi uses a separately obtained official token; Jellyfin and Emby use server-issued tokens; Kodi uses request-scoped JSON-RPC Basic credentials; Plex uses a caller-provided account token. None of those other five has a WatchBridge authorization helper.
- Validated `watchbridge.backup.v1` file-to-account sync through the same backup-first executor.
- Additive, same-service backup restore through the API and CLI, with a fresh target snapshot before confirmed restore writes.
- Bounded connector/OAuth timeouts, safe idempotent-read retries, abort handling, and sanitized provider errors.
- API and CLI metadata/recommendation commands, support-summary API/CLI output, and registry-derived web percentages.
- Optional authenticated encryption for new file-backed backups and audit jobs, with explicit one-time plaintext migration.
- User-controlled Letterboxd ratings/watched/watchlist target-file generation through API, offline CLI, and web download, with movie-only and lossy-input rejection plus 1,000,000-byte CSV chunking.
- Bangumi ratings, exact completed-episode state/progress, and collection watchlist/status reads and writes, with anime-only mapping, existing-collection-only rating updates, HTTPS/Bearer/User-Agent enforcement, and rejection of timestamps, replay/rewatch, books, and unsupported collection states.
- Jellyfin ratings and completed movie/exact-episode watched-state reads and writes for one explicit HTTPS server, with instance-scoped identity, no favorites-to-watchlist mapping, production owner opt-in for the self-hosted URL, and guards against reducing an existing play count or moving its last-played timestamp backwards.
- Emby completed movie/exact-episode watched-membership reads and writes for one explicit HTTPS server, with timestamps, replay/play counts, progress, aggregate state, numeric ratings, and favorites-to-watchlist mapping blocked; production requires the self-hosted URL owner opt-in and outbound DNS/IP/TLS allowlisting.
- Shikimori anime ratings, watched/progress/status, and planned-watchlist reads/writes with exact `user_rates` scope, independently guarded shared-row updates, conservative live throttling, and rejection of timestamps, manga rows, lossy rating conversion, and MAL-only reverse lookup.
- Annict work/episode watched state and planned-watchlist reads/writes with exact `read write` scope, cross-surface identity verification, additive exact-episode records, API/CLI/web OOB authorization and revocation, and no title-rating claim.
- Kodi Omega 21 / JSON-RPC 13.5 integer ratings and completed movie/exact-episode play-count reads/writes for one exact profile and UUID-scoped library, with no watchlist/resume/timestamp path and the production custom-URL network boundary documented.
- Plex server-scoped rating reads/writes using caller-provided account token context, machine-ID-verified server discovery, runtime feature-key discovery, no watched/watchlist support, and explicit personal/non-commercial terms caveat.
- Kitsu public unauthenticated exact-ID anime/manga/episode metadata with strict JSON:API identity validation and no search, mapping, user-library, password collection, or account-sync claim.

## Remaining product work

- Versioned backup and connector execution for reviews, following, and followers; these remain canonical-model-only today.
- Browser callback UX and secure local token-vault integration on top of the shipped OAuth API/CLI flows.
- Shared encrypted OAuth transaction storage for horizontally scaled API deployments.
- Web UI for restore, durable job browsing, metadata resolution, and recommendations.
- Backup/job retention and cleanup policies.
- Interactive identity-match resolution and richer conflict review before confirmed writes.
- Additional direct connectors or verified target import-file generators only where provider documentation, authorization, and tests support them.

## Researched platform candidates

These are expansion candidates, not shipped services. They are not part of the current 34-entry catalog or its 102 executable-feature slots, so they do not change the support percentages. A feature is marked **strict** only when the official interface appears to provide authenticated read and write operations for the same canonical meaning; favorites, generic collections, per-file flags, and undocumented endpoints do not count as watchlist/history equivalents. Every candidate still needs authorization, schema fixtures, connector tests, live smoke tests, and a registry change before it may be advertised as supported.

| Candidate | Access model | Ratings | Watched/progress | Watchlist | Strict score and next gate | Official references |
|---|---|---|---|---|---|---|
| AniDB | Registered UDP client using an AniDB user session | Strict anime vote | Partial—MyList `viewed` is file/episode-oriented | No—MyList ownership/storage is not a watchlist | **1/3; defer.** Raw-credential/session handling, UDP limits, and file-centric semantics are a poor fit for an initial connector. | [UDP API definition](https://wiki.anidb.net/UDP_API_Definition) |

## Known shipped-platform gaps

- Shikimori is shipped for anime only. Its shared user-rate row still forces rating-only creation, timestamps, manga, and MAL-only identity to fail closed.
- Annict is shipped for watched and planned watchlist only; its per-record rating is not a lossless canonical title rating.
- Kodi is shipped only for Kodi Omega 21 / JSON-RPC 13.5, one explicit HTTPS profile/library, integer ratings, and completed play counts. Watchlist, resume progress, and timestamp fidelity remain absent.
- Plex is shipped only for server-scoped personal ratings with a caller-provided token. There is no WatchBridge Plex auth helper, watched/timeline/scrobble path, global-watchlist path, rating deletion, or commercial/hosted-use permission claim.
- Kitsu is shipped only for public exact-ID metadata. The current official source OpenAPI does not expose active user/library-entry contracts for ratings, history, or watchlist, and its remaining password-grant material is not a safe authorization path for WatchBridge.
- Jellyfin and Emby remain bound to explicit owner-controlled HTTPS servers and the high-risk provider-URL opt-in. Jellyfin has no watchlist; Emby has neither ratings nor watchlist and preserves only additive completed membership.

## Provider-gated work

- AniList connector only after explicit sustained-integration authorization.
- Rotten Tomatoes and JustWatch only after an approved partner/API agreement.

## v1.0 production gate

- Live-provider end-to-end integration tests with authorized non-production accounts.
- Authorized live-provider backup/restore recovery drills and partial-write reconciliation tests.
- Production conflict-resolution and identity-match UX.
- Transactional shared storage and a durable token vault before multi-instance deployment.
- Signed releases.
- Desktop builds.
- Android/iOS builds.
- Legal-safe connector documentation for every supported service.
