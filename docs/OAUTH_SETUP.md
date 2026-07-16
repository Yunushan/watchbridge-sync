# OAuth Setup

WatchBridge ships authorization helpers for six of the thirteen direct-account connectors: TMDb, Trakt, Simkl, MyAnimeList, Shikimori, and Annict. Bangumi accepts a separately obtained official access token; Jellyfin and Emby accept tokens issued by their selected self-hosted servers; Kodi accepts request-scoped HTTP Basic credentials for one owner-selected JSON-RPC server; Plex accepts a caller-provided account token and selected server context; Movary accepts a caller-provided API token, username, and explicit HTTPS `/api/` server URL; AniList accepts a caller-provided OAuth access token. None of those other seven has a dedicated WatchBridge authorization flow. The API, CLI, and web UI do not persist provider secrets or returned tokens, and they do not collect third-party site passwords.

Register your own provider application before using these flows. Put request files under the ignored `private/` directory and never commit client secrets, authorization codes, device codes, access tokens, or refresh tokens.

All CLI commands default to `http://localhost:8080`. Add a different WatchBridge API base URL as the final argument when needed. This selects the WatchBridge server, not a provider endpoint. Request-supplied provider `baseUrl`, `v3BaseUrl`, and `v4BaseUrl` overrides are rejected by default; see [Deployment](DEPLOYMENT.md) for the tightly constrained, high-risk owner opt-in. If the WatchBridge server uses `WATCHBRIDGE_API_KEY`, set the same environment variable for the CLI; it is sent as the server authorization header and is not read from a request file.

## Same-origin browser callback relay

For browser authorization flows, a deployed WatchBridge web app can use a registered redirect such as `https://watchbridge.example/oauth/callback`. The static host must serve the web app for that route (SPA history fallback) over the same origin as the tab where authorization began. The callback page accepts one bounded `state` plus either `code` or provider error, relays it only through a same-origin browser `BroadcastChannel` to the already-open authorization panel, and immediately removes callback parameters from its own URL. The original tab compares the returned state with its in-memory start transaction before filling the exchange fields; it never automatically exchanges a code or persists callback data.

This works without `window.opener`, cookies, local storage, or a token vault. Keep the manual state/code fields available as the fallback for browsers without `BroadcastChannel`, callbacks hosted on another origin, and Annict's OOB flow. Configure the web host, analytics, and reverse proxy to omit or redact callback query parameters from logs; authorization codes remain sensitive until exchanged.

For a multi-instance API, set `WATCHBRIDGE_OAUTH_TRANSACTION_DIR` to a protected shared filesystem directory and configure `WATCHBRIDGE_STORAGE_KEY`. This encrypts the short-lived state/PKCE transaction and atomically allows only one instance to consume it. It does not persist the resulting provider token or make account-sync jobs/backups horizontally scalable; see [Deployment](DEPLOYMENT.md).

## Encrypted connector vault

For a protected single-tenant deployment, the web **Encrypted connector vault** panel can store a complete validated direct-account connector context. It requires an explicit checkbox, `WATCHBRIDGE_STORAGE_KEY`, and optionally `WATCHBRIDGE_OAUTH_VAULT_DIR` (otherwise `.watchbridge-oauth-vault`). The API returns only an opaque UUID, never the context. Use exactly `{ "vaultId": "UUID" }` as the source or target context for an account sync; the vault record must belong to that same service and is decrypted only server-side for that request. Delete a record with `DELETE /v1/oauth/vault/:id`.

The vault is encrypted at rest but is not a multi-user or delegated secret manager: access follows the same WatchBridge API authorization boundary, records have no automatic retention policy, and account-sync jobs/backups still need separate shared transactional storage before a horizontally scaled deployment.

The web **Account authorization** panel exposes all six helper families. It keeps codes, client secrets, access tokens, and refresh tokens only in component memory, never writes them to browser storage, and clears sensitive fields on request. Shikimori start/exchange/refresh and Annict browser-or-OOB start/exchange/revoke are available there as well as through the API routes and CLI commands documented below.

## TMDb v4 authorization and v3 write session

TMDb account authorization is not standard OAuth: it has no client secret, PKCE, refresh token, or native state field. WatchBridge binds its own random state to TMDb's `redirect_to`, retains the application API Read Access Token only in the API's 15-minute transaction, and never puts that token in the browser URL.

Start with the API Read Access Token from your registered TMDb application and an HTTPS callback (loopback HTTP is allowed for local development):

```json
{
  "applicationToken": "your-tmdb-api-read-access-token",
  "redirectUri": "https://your-app.example/oauth/tmdb"
}
```

```bash
watchbridge oauth-tmdb-start private/tmdb-start.json
```

Open the returned `authorizationUrl`. After approval, copy `state` from the callback URL and exchange it. The application token is recovered from the one-time server transaction, so it is not sent again:

```json
{ "state": "the-callback-state" }
```

```bash
watchbridge oauth-tmdb-exchange private/tmdb-exchange.json
```

The result contains the v4 user `access_token` and string `account_id` (the v4 account object ID). TMDb's documented rating and watchlist writes use v3 sessions and a distinct numeric account ID. Create both from the v4 user token:

```json
{
  "applicationToken": "your-tmdb-api-read-access-token",
  "userAccessToken": "the-v4-user-access-token"
}
```

```bash
watchbridge oauth-tmdb-session private/tmdb-session.json
```

Keep the returned `session_id` and `numeric_account_id` distinct from the v4 `account_id`. TMDb documents no refresh flow; authorize again after revocation or authentication failure. Revoke the v4 token with `oauth-tmdb-logout` and `{ "accessToken": "the-v4-user-access-token" }`.

Official references: [TMDb v4 user authentication](https://developer.themoviedb.org/v4/docs/authentication-user), [TMDb v4 access token](https://developer.themoviedb.org/v4/reference/auth-create-access-token), and [TMDb v3 session conversion](https://developer.themoviedb.org/reference/authentication-create-session-from-v4-token).

## Trakt device flow

Device authorization is the simplest CLI flow. Start with:

```json
{ "clientId": "your-trakt-client-id" }
```

```bash
watchbridge oauth-trakt-device-start private/trakt-device-start.json
```

Open the returned `verification_url` and enter `user_code`. Do not poll before the returned `interval`, and stop after `expires_in`. Poll once per CLI invocation with:

```json
{
  "clientId": "your-trakt-client-id",
  "clientSecret": "your-trakt-client-secret",
  "deviceCode": "the-returned-device-code"
}
```

```bash
watchbridge oauth-trakt-device-poll private/trakt-device-poll.json
```

The API enforces the interval for device codes started by the same process. Results are `too-early`, `pending`, `slow-down`, `invalid-code`, `already-used`, `expired`, `denied`, or `authorized`. An authorized response contains the complete access/refresh token pair. Replace both tokens after refresh.

## Trakt browser flow and refresh

Start browser authorization with a redirect URI that exactly matches the registered application:

```json
{
  "clientId": "your-trakt-client-id",
  "redirectUri": "https://your-app.example/oauth/trakt"
}
```

```bash
watchbridge oauth-trakt-start private/trakt-start.json
```

Open `authorizationUrl`. After Trakt redirects, copy both `code` and `state` from the callback URL. The API consumes the matching server-side transaction and rejects unknown, expired, reused, or wrong-provider state:

```json
{
  "state": "the-callback-state",
  "code": "the-callback-code",
  "clientSecret": "your-trakt-client-secret"
}
```

```bash
watchbridge oauth-trakt-exchange private/trakt-exchange.json
```

Refresh with `oauth-trakt-refresh` and a request containing `clientId`, `clientSecret`, the same `redirectUri`, and `refreshToken`.

The same request-scoped user token authorizes current-user review export and constrained review creation, plus current-user following/follower export and additive public-profile following. Before posting comments, the connector calls `/users/settings` and requires `permissions.commenting: true`. Before following anyone it requires `permissions.following: true`, verifies the authenticated user identity, snapshots current following, and resolves the complete target batch before the first write. Trakt can temporarily disable either permission when spam protection is triggered, in which case that complete batch fails before any corresponding mutation.

Official reference: [Trakt OAuth authentication](https://docs.trakt.tv/docs/authentication-oauth).

## MyAnimeList PKCE and refresh

MyAnimeList requires authorization-code OAuth with `plain` PKCE; it does not accept S256. WatchBridge generates a cryptographically random verifier, retains it only in server memory, and returns an authorization URL without exposing that verifier.

```json
{
  "clientId": "your-mal-client-id",
  "redirectUri": "https://your-app.example/oauth/myanimelist"
}
```

```bash
watchbridge oauth-myanimelist-start private/mal-start.json
```

Exchange the callback using the `state` and `code` echoed in its redirect URL. `clientSecret` is optional for registered public clients:

```json
{
  "state": "the-callback-state",
  "code": "the-callback-code",
  "clientSecret": "your-mal-client-secret"
}
```

```bash
watchbridge oauth-myanimelist-exchange private/mal-exchange.json
```

Refresh with `oauth-myanimelist-refresh` and `clientId`, `refreshToken`, and optional `clientSecret`. Use the returned `expires_in` rather than hardcoding token lifetime, and atomically replace the stored access and refresh tokens.

Official reference: [MyAnimeList API authorization](https://myanimelist.net/apiconfig/references/authorization).

## Simkl S256 PKCE

Simkl uses authorization-code OAuth with PKCE S256. Its token is long-lived and it does not issue refresh tokens; restart authorization after revocation or an authenticated API `401`.

```json
{
  "clientId": "your-simkl-client-id",
  "redirectUri": "https://your-app.example/oauth/simkl",
  "appName": "WatchBridge Sync",
  "appVersion": "0.1.0",
  "userAgent": "WatchBridge-Sync/0.1.0"
}
```

```bash
watchbridge oauth-simkl-start private/simkl-start.json
```

Exchange with only the callback state and code; no client secret is sent by the public PKCE flow:

```json
{ "state": "the-callback-state", "code": "the-callback-code" }
```

```bash
watchbridge oauth-simkl-exchange private/simkl-exchange.json
```

Official references: [Simkl authentication](https://api.simkl.org/authentication) and [Simkl OAuth PKCE](https://api.simkl.org/api-reference/oauth-pkce).

## Shikimori authorization-code flow and refresh

Shikimori uses OAuth 2 authorization code with a registered client secret and no PKCE in its documented flow. WatchBridge requests exactly the `user_rates` scope and binds a random one-time state to the registered safe callback URI.

```json
{
  "clientId": "your-shikimori-client-id",
  "redirectUri": "https://your-app.example/oauth/shikimori"
}
```

```bash
watchbridge oauth-shikimori-start private/shikimori-start.json
```

Open `authorizationUrl`, then exchange the callback `state` and `code` with the application secret:

```json
{
  "state": "the-callback-state",
  "code": "the-callback-code",
  "clientSecret": "your-shikimori-client-secret"
}
```

```bash
watchbridge oauth-shikimori-exchange private/shikimori-exchange.json
```

Refresh with `watchbridge oauth-shikimori-refresh` and a file containing `clientId`, `clientSecret`, and the current `refreshToken`. Replace both returned tokens atomically. The equivalent API routes are `/v1/oauth/shikimori/start`, `/exchange`, and `/refresh`; the web authorization panel exposes the same three actions.

For account sync, pass the resulting token together with the exact scope, numeric identity from Shikimori's `whoami`, and an identifying application User-Agent:

```json
{
  "accessToken": "your-shikimori-access-token",
  "accountId": "12345",
  "oauthScope": "user_rates",
  "userAgent": "WatchBridge-Sync/0.1.0 (contact-or-project-url)"
}
```

The connector rejects a mismatched `accountId`, missing `user_rates` write scope, browser-mimicking User-Agent, non-anime user rate, or live endpoint override. Rating-only creation is not safe because one provider row also owns list status, so a rating-only write requires an existing user rate. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#shikimori-fidelity-and-oauth-boundary).

Official references: [Shikimori API](https://shikimori.io/api/doc) and [Shikimori OAuth](https://shikimori.io/oauth).

## Annict browser or OOB flow and revocation

Annict's authorization-code flow requests exactly `read write`. A registered HTTPS callback and loopback HTTP callback are accepted; for copy-and-paste authorization, Annict also documents the exact OOB URI `urn:ietf:wg:oauth:2.0:oob`.

```json
{
  "clientId": "your-annict-client-id",
  "redirectUri": "urn:ietf:wg:oauth:2.0:oob"
}
```

```bash
watchbridge oauth-annict-start private/annict-start.json
```

Open `authorizationUrl`. For OOB, copy the displayed authorization code and retain the `state` returned by the start response; for a callback, take both values from the callback. Exchange them with the registered client secret:

```json
{
  "state": "the-transaction-state",
  "code": "the-authorization-code",
  "clientSecret": "your-annict-client-secret"
}
```

```bash
watchbridge oauth-annict-exchange private/annict-exchange.json
```

Annict does not return a refresh token in this flow. Reauthorize after loss or revocation. To revoke deliberately, run `watchbridge oauth-annict-revoke` with `accessToken`, `clientId`, and `clientSecret`. The matching API routes are `/v1/oauth/annict/start`, `/exchange`, and `/revoke`. The web authorization panel supports the callback and exact OOB flow, retains the OOB state in memory, fills the exchanged access-token field, and clears that field after successful revocation.

Pass the token to account sync with the exact scope and an identifying User-Agent:

```json
{
  "accessToken": "your-annict-access-token",
  "oauthScope": "read write",
  "userAgent": "WatchBridge-Sync/0.1.0"
}
```

The connector verifies token info, `/v1/me`, and GraphQL viewer identity before use. It supports watched/work status, exact additive episode records, and planned watchlist only; it registers no rating methods. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#annict-watchedwatchlist-boundary).

Official references: [Annict authentication](https://developers.annict.com/docs/authentication), [Annict OAuth](https://developers.annict.com/docs/authentication/oauth), [Annict REST API](https://developers.annict.com/docs/rest-api/v1), and [Annict GraphQL API](https://developers.annict.com/docs/graphql-api/beta).

## Bangumi manual token context

WatchBridge does not ship a Bangumi OAuth start, callback, exchange, or refresh helper. Obtain an access token through Bangumi's official developer/authorization process and keep it in the same request-scoped secret storage used for the other providers. Do not commit it to a request fixture.

Pass the token directly in the Bangumi connector context together with a non-generic User-Agent that identifies the developer and application:

```json
{
  "accessToken": "your-bangumi-access-token",
  "userAgent": "developer/watchbridge-sync/0.1.0 (contact-or-project-url)"
}
```

The connector rejects empty or whitespace-containing tokens, generic Bangumi/database client names, User-Agent line breaks, and non-HTTPS provider URLs. It sends the token as `Authorization: Bearer` and keeps requests on the configured provider origin. Production requests cannot supply a custom provider base URL unless the API owner explicitly enables the high-risk override described in [Deployment](DEPLOYMENT.md).

Bangumi execution is anime-only and intentionally loss-intolerant: rating updates require an existing collection entry, completed episode writes require exact subject and episode IDs, and timestamps, replay/rewatch state, books, on-hold, and dropped collection states are unsupported. See [Connector and Runtime Support](CONNECTOR_CAPABILITIES.md#bangumi-fidelity-and-limits) for the complete data boundary.

Official references: [Bangumi API](https://bangumi.github.io/api/) and [Bangumi authorization guide](https://github.com/bangumi/api/blob/master/docs-raw/How-to-Auth.md).

## Jellyfin self-hosted token context

WatchBridge does not ship Jellyfin Quick Connect, password login, or token-vault automation. Obtain a token from the user-selected Jellyfin server outside WatchBridge and pass it only in the request-scoped connector context:

```json
{
  "accessToken": "your-jellyfin-server-token",
  "baseUrl": "https://media.example/jellyfin/",
  "userAgent": "developer/watchbridge-sync/0.1.0"
}
```

The connector requires the explicit `baseUrl` to be HTTPS without credentials, query, or fragment, keeps every request under its configured origin/path, and scopes item IDs to the connected server. In production the API rejects request-supplied provider URLs by default, so the owner must deliberately set exact lowercase `WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true` before Jellyfin contexts are accepted. This is a high-risk mode: every authenticated WatchBridge caller can then choose where request-scoped tokens are sent. Use only an owner-controlled server plus outbound DNS/IP/TLS allowlists; see [Deployment](DEPLOYMENT.md).

Jellyfin support covers numeric personal ratings and completed watched state for movies/exact episodes. Favorites and likes are not a canonical watchlist. Aggregate series state, in-progress playback/progress, rating timestamps/reviews, cross-server item IDs, and ambiguous matches fail closed.

Official references: [Jellyfin user-data DTO](https://typescript-sdk.jellyfin.org/interfaces/generated-client.UpdateUserItemDataDto.html) and [Jellyfin Quick Connect](https://jellyfin.org/docs/general/server/quick-connect/).

## Emby self-hosted token context

WatchBridge does not collect Emby passwords, perform Emby Connect login, or ship token-vault automation. Obtain a user token or approved API key from the selected Emby server outside WatchBridge and pass it only in the request-scoped connector context:

```json
{
  "accessToken": "your-emby-user-token-or-approved-api-key",
  "accountId": "your-emby-user-id",
  "baseUrl": "https://media.example/emby/",
  "userAgent": "developer/watchbridge-sync/0.1.0"
}
```

The connector requires the explicit `baseUrl` to be HTTPS without credentials, query, or fragment. In production the API rejects request-supplied provider URLs by default, so the owner must deliberately set exact lowercase `WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true` before Emby contexts are accepted. This is a high-risk credential-destination mode: use only an owner-controlled server and enforce outbound DNS/IP/TLS allowlists; see [Deployment](DEPLOYMENT.md).

Emby support covers only completed watched membership for movies and exact episodes. Timestamps, replay/play counts, in-progress playback, progress values, and aggregate series/season state fail closed. Numeric ratings are blocked because the connector has no safely documented rating scale/merge contract, and favorites/likes are not a canonical watchlist.

Official references: [Emby REST API access and authentication](https://dev.emby.media/doc/restapi/index.html), [Emby API-key authentication](https://dev.emby.media/doc/restapi/API-Key-Authentication.html), [Emby user library](https://dev.emby.media/reference/RestAPI/UserLibraryService.html), and [Emby playstate](https://dev.emby.media/reference/RestAPI/PlaystateService.html).

## Kodi request-scoped JSON-RPC context

WatchBridge does not enable Kodi remote control, create a Kodi profile, or acquire its HTTP Basic credentials. Configure HTTPS JSON-RPC on an owner-controlled Kodi Omega 21 host, choose the current profile, generate a stable lowercase UUIDv4 to scope that library's local IDs, and pass all values only in the sync request:

```json
{
  "username": "kodi-http-user",
  "password": "kodi-http-password",
  "profileName": "Master user",
  "kodiLibraryScope": "4b96405c-44f2-4cf7-b0a5-73a9bb14cabc",
  "baseUrl": "https://media.example/kodi/jsonrpc",
  "userAgent": "WatchBridge-Sync/0.1.0"
}
```

The URL must end exactly in `/jsonrpc`; embedded URL credentials are forbidden. The API's custom-provider-URL protection means production also requires exact lowercase `WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS=true` plus a network allowlist for this host. This opt-in is security-sensitive because API callers can otherwise choose a destination for request-scoped credentials. The connector requires JSON-RPC 13.5, Kodi 21, an exact current-profile match, and read/update permissions. It supports integer ratings, completed movie/exact-episode play counts, and movie-only managed watchlist membership through the library-scoped `watchbridge:watchlist:<kodiLibraryScope>` tag; resume progress and watchlist timestamps remain unsupported.

Official references: [Kodi JSON-RPC overview](https://kodi.wiki/view/JSON-RPC_API) and [Kodi Omega JSON-RPC v13.5](https://kodi.wiki/view/JSON-RPC_API/v13.5).

## Plex caller-provided token context

WatchBridge currently ships no Plex sign-in, PIN, or token-acquisition helper. Obtain and manage an authorized Plex account token outside WatchBridge, select one Plex Media Server machine identifier, and provide a stable unique client identifier for this WatchBridge installation:

```json
{
  "accessToken": "your-existing-plex-account-token",
  "clientIdentifier": "watchbridge-installation-id",
  "plexServerId": "selected-server-machine-id",
  "userAgent": "WatchBridge-Sync/0.1.0",
  "appName": "WatchBridge",
  "appVersion": "0.1.0"
}
```

Do not provide a Plex server `baseUrl`. The connector verifies the Plex account, discovers the selected server and its per-server access token through Plex resources, accepts only credential-free HTTPS connections, and proves the claimed machine identifier before reading or writing. The caller-provided account token remains request-scoped and is not persisted. Support covers server-scoped ratings plus completed played membership for movies and exact episodes; the global watchlist is not enabled.

Plex's current Terms provide a personal, non-commercial license and impose additional restrictions. Review them before use and obtain any permission required for commercial, hosted, or third-party-benefit deployment. WatchBridge support is not Plex endorsement and is not an authorization helper.

Official references: [Plex Media Server API](https://developer.plex.tv/pms/) and [Plex Terms of Service](https://www.plex.tv/about/privacy-legal/plex-terms-of-service/).

## Why Kitsu has no account authorization helper

Kitsu is a metadata/recommendation-workflow entry, not one of the thirteen direct-account connectors. The shipped connector makes public exact-ID JSON:API reads for anime, manga, and episodes and sends no authorization header. In the current official source OpenAPI, the user/library-entry paths and schemas needed for account synchronization are commented out, while the remaining authentication chapter describes a password grant. WatchBridge does not collect Kitsu passwords or treat legacy/commented contracts as account support, so Kitsu remains **0/6** across the canonical account-sync families.

Official references: [rendered Kitsu OpenAPI](https://hummingbird-me.github.io/api-docs/) and [source OpenAPI root](https://github.com/hummingbird-me/api-docs/blob/openapi3/api/kitsu.yml).

## Security and deployment behavior

- Authorization state and PKCE verifiers are random, one-time, provider-bound, and expire after ten minutes; TMDb's request-token transaction expires after its documented 15-minute window.
- Transactions currently live only in the API process. A restart invalidates them. Use sticky routing or a shared encrypted, TTL-backed store before running multiple API instances.
- Token exchange occurs server-side. Client secrets are never placed in authorization URLs.
- Every outbound OAuth, device, and token request has a 15-second timeout (and an absolute 30-second internal maximum). A caller abort remains effective alongside that timeout.
- OAuth POSTs are single-attempt. WatchBridge does not automatically retry authorization-code exchanges, refreshes, device requests, or token requests because a timed-out exchange may already have reached the provider. Restart the relevant flow or retry explicitly only after checking provider state.
- Provider response bodies and native network-error details are suppressed. Public errors contain only the provider, a safe failure category, and an HTTP status when available, so echoed codes, tokens, and secrets are not reflected.
- Returned tokens are not persisted by the API. Store them in an OS keychain or another encrypted secret store, then pass the access token in the connector's request-scoped context.
- Production API mode requires `WATCHBRIDGE_API_KEY`, HTTPS should terminate in front of the API, and provider callback URLs must use the exact registered URI.
