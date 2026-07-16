# Import and Export Formats

Shipped formats are deliberately narrower than the canonical model:

- strict, versioned `watchbridge.backup.v1` JSON upload/download;
- explicitly mapped CSV input for the 13 `manual-mapping` services;
- dedicated IMDb, Letterboxd, and MovieLens source-file manifests;
- a Letterboxd ratings/watched/watchlist/reviews target-file generator;
- a library helper that creates a portable IMDb-shaped ratings CSV without claiming provider import compatibility.

Letterboxd is the only shipped target-specific provider import-file generator. ZIP bundles are not shipped. Backup v1 and mapped CSV round-trip reviews, following, and followers; social usernames remain provider-scoped and are not cross-service identity evidence.

## Canonical JSON backup

```json
{
  "schema": "watchbridge.backup.v1",
  "exportedAt": "2026-06-30T00:00:00Z",
  "service": "letterboxd",
  "ratings": [],
  "watched": [],
  "watchlist": [],
  "reviews": [],
  "following": [],
  "followers": [],
  "rawFiles": []
}
```

This is the single accepted executable upload/archive schema. Unknown fields are rejected at the archive, record, media-item, external-ID, rating-scale, and raw-file boundaries. Every canonical record must identify the same `service` as the archive; media kinds, external IDs, dates, rating scales, rating steps, per-feature record counts, and raw-file size are validated before execution. Each feature is limited to 100,000 records, and optional `rawFiles` content is limited to 10 MiB combined after UTF-8 encoding.

Dedicated provider-file conversion emits canonical records but does not embed the original CSV contents in `rawFiles`. Keep the original exports separately if exact source-file retention is required. Each following entry must use direction `following`, each followers entry direction `follower`, and both must use the archive service. Usernames are bounded and unique case-insensitively within a direction; profile URLs must be absolute HTTPS URLs without credentials.

Watched records keep two counters with different meanings:

- `progress` is the number of sequential units consumed (episodes for anime, chapters for manga).
- `plays` is a provider-reported play or replay count; it is never an episode/chapter position.

Early `watchbridge.backup.v1` archives produced by the MyAnimeList connector stored episode/chapter progress in `plays`. A MyAnimeList watched record with `plays` but no explicit `progress` is therefore migrated to `progress` when read, and the legacy `plays` property is removed. Current MyAnimeList exports always include explicit `progress`, including zero, so current replay counts remain unambiguous. This compatibility rule applies only to MyAnimeList; `plays` from every other service is preserved as a play count and is never silently reinterpreted.

An Emby connector backup contains completed movie/exact-episode watched membership only. Its instance-local item identity is stored as the required `externalIds.emby` plus `externalIds.embyServer` pair; one without the other is invalid. Emby records intentionally omit `watchedAt`, `plays`, and `progress` because the connector does not claim timestamp, replay-count, or playback-progress fidelity.

New direct-connector identities are equally strict. Shikimori connector records are anime with a positive integer `externalIds.shikimori`. Annict work records use `annictWork`; an Annict episode must carry both its parent `annictWork` and exact `annictEpisode`, never only one. Kodi local item IDs are valid only with their paired canonical lowercase UUIDv4 `kodiLibrary` scope. Plex rating keys are valid only with their paired `plexServer` machine identifier; optional `plexGuid` is accepted only alongside that scoped pair. These pairs prevent instance-local identifiers from being treated as portable global identity.

Kitsu's positive integer external ID is schema-valid only for anime, manga, or episode items, but the shipped Kitsu connector is metadata-only and exports no ratings, watched, or watchlist records. A schema-valid ID does not create a Kitsu account-source or target path.

## Dedicated provider-file manifests

`POST /v1/import/provider-files` converts user-owned IMDb, Letterboxd, or MovieLens exports directly into a validated `watchbridge.backup.v1` archive. The response is the archive itself, without a wrapper. File values sent to the API are the CSV contents:

```json
{
  "service": "imdb",
  "files": {
    "ratings": "<contents of ratings.csv>",
    "watched": "<contents of IMDb Check-ins CSV>",
    "watchlist": "<contents of watchlist.csv>"
  }
}
```

IMDb accepts any non-empty combination of `files.ratings`, `files.watched`, and `files.watchlist`. The watched input is IMDb's officially exportable **Check-ins** list. IMDb defines a check-in as something the user is watching or previously watched, so WatchBridge maps it to watched membership. It deliberately omits `watchedAt`: the CSV's list creation time is not proof of the actual viewing time. This is not the newer private Watch history feature and does not imply an IMDb account API or import path.

Letterboxd accepts any non-empty combination of its four executable families:

```json
{
  "service": "letterboxd",
  "files": {
    "ratings": "<contents of ratings.csv>",
    "watched": "<contents of watched.csv>",
    "watchlist": "<contents of watchlist.csv>",
    "reviews": "<contents of reviews.csv>"
  }
}
```

Review text, an optional provider-required summary, and an optional attached rating round-trip through backup v1. A target connector may reject review fields its provider cannot reproduce; for example, AniList writes require a bounded summary and do not accept spoiler or review-date fields. MovieLens requires `ratings` and `movies`; `links` and a user selector are optional:

```json
{
  "service": "movielens",
  "userId": "7",
  "files": {
    "ratings": "<contents of ratings.csv>",
    "movies": "<contents of movies.csv>",
    "links": "<contents of links.csv>"
  }
}
```

The manifest and nested `files` object reject unknown fields. Supplied files must be non-empty strings and may total at most 10 MiB after UTF-8 encoding. MovieLens `userId` is limited to 128 characters and may not contain control characters. It may be omitted for a single-user ratings file; a file containing multiple distinct users is rejected until one is selected, and a selector with no matching data rows is rejected rather than producing an ambiguous empty backup. Parser or archive-validation failures return a sanitized `400` response that never echoes file contents.

The CLI performs the same conversion entirely locally. In a CLI manifest, the `files` values are local paths rather than CSV contents:

```json
{
  "service": "letterboxd",
  "files": {
    "ratings": "exports/ratings.csv",
    "watched": "exports/watched.csv",
    "watchlist": "exports/watchlist.csv",
    "reviews": "exports/reviews.csv"
  }
}
```

Paths are resolved from the CLI process working directory. Run `watchbridge import-provider-files manifest.json`; the strict backup-v1 archive is printed to standard output without credentials or network access. It can then be placed in a `/v1/sync/from-backup` request for a dry-run into a shipped account target.

Dedicated parsers accept a genuine header-only export, but a file containing data rows that produces no valid records is rejected instead of silently returning an empty archive. MovieLens files with multiple user IDs require an explicit selector.

## Canonical backup to Letterboxd files

`POST /v1/export/letterboxd-files` accepts a strict backup-v1 archive and an explicit non-empty feature selection:

```json
{
  "backup": {
    "schema": "watchbridge.backup.v1",
    "service": "trakt",
    "exportedAt": "2026-07-15T00:00:00Z",
    "ratings": [],
    "watched": [],
    "watchlist": [],
    "reviews": []
  },
  "selection": {
    "ratings": true,
    "watched": true,
    "watchlist": true,
    "reviews": true
  }
}
```

The request and selection reject unknown fields. At least one of `ratings`, `watched`, `watchlist`, or `reviews` must be `true`; social data cannot be selected because Letterboxd documents no corresponding profile-import columns. The response is a user-controlled JSON bundle:

```json
{
  "target": "letterboxd",
  "files": [
    {
      "fileName": "letterboxd-ratings-001.csv",
      "contentType": "text/csv; charset=utf-8",
      "content": "imdbID,tmdbID,Title,Year,Rating\ntt0113277,,Heat,1995,4",
      "feature": "ratings",
      "recordCount": 1,
      "importDestination": "profile",
      "warnings": ["Letterboxd profile imports mark imported rated films as watched; review matches and ratings must be checked in Letterboxd before confirmation."]
    }
  ]
}
```

Clients must display the returned warnings rather than keying behavior to their wording. Ratings, watched, and reviews files target Letterboxd's [profile importer](https://letterboxd.com/import/); watchlist files target its [watchlist importer](https://letterboxd.com/watchlist/import/). WatchBridge never logs in to Letterboxd, uploads a file, or directly writes the account.

The offline CLI performs the same validation and generation without an API call:

```bash
watchbridge generate-letterboxd-files backup.json selection.json
```

`backup.json` contains the strict archive. `selection.json` contains the selection object alone, for example `{ "ratings": true, "watched": false, "watchlist": true, "reviews": true }`. The command prints the same `{ "target": "letterboxd", "files": [...] }` bundle to standard output; it does not create CSV files on disk or upload them. Save each returned `content` value using its `fileName`, or use the web **Canonical backup to Letterboxd import files** panel, which validates the upload, calls the API, and provides one download button per generated chunk.

### Letterboxd file contract

| Feature | CSV columns | Import destination |
|---|---|---|
| Ratings | `imdbID,tmdbID,Title,Year,Rating` | Profile importer |
| Watched | `imdbID,tmdbID,Title,Year,WatchedDate,Rewatch` | Profile importer |
| Watchlist | `imdbID,tmdbID,Title,Year` | Watchlist importer |
| Reviews | `imdbID,tmdbID,Title,Year,Rating,Review` | Profile importer |

- Only `movie` records are representable. Any selected TV, season, episode, anime, manga, or other non-film record rejects the generation request.
- Ratings are converted to Letterboxd's 0.5–5 half-star scale. Letterboxd profile imports can mark imported rated films as watched, so matches and values must be reviewed before confirmation.
- Watched conversion rejects `in-progress`, any `progress` value, `plays > 1`, a `rewatched` record without `watchedAt`, and an invalid watched date. It does not silently discard these states. A valid ISO date-time is reduced to its written `YYYY-MM-DD` prefix rather than timezone-shifted.
- Review conversion preserves the exact body and converts an optional attached rating to Letterboxd's half-star scale. A true spoiler flag is rejected because the documented import has no spoiler column; `reviewedAt` is omitted with an explicit warning because it has no review-date column.
- Files are UTF-8 CSV and are capped at exactly **1,000,000 encoded bytes each**, including the header. Large selections are split into `letterboxd-<feature>-001.csv`, `-002.csv`, and so on. A single row that exceeds the limit with its header is rejected.
- Selecting an empty feature still emits one header-only file, allowing the result to preserve the explicit selection without fabricating records.

## Mapped CSV and backup handoff

`POST /v1/import/mapped-csv`, `watchbridge import-mapped-csv export.csv mapping.json`, and the web **Manual CSV import** panel accept an explicit column map for the 13 services registered as `manual-mapping`. Restricted, metadata-only, dedicated-file, and account services are rejected by this generic route. The config, nested rating scale, and column map reject unknown fields.

The mapped parser returns canonical `ratings`, `watched`, `watchlist`, `reviews`, `following`, and `followers` arrays plus row/column `issues`. Invalid optional values are reported and skipped; they are not fabricated, and the original CSV is not fetched or retained by WatchBridge. The web UI displays those issues but omits them from the downloaded strict archive.

Once the mapped arrays are placed in a strict archive (the web download does this), an archive from either file workflow can be used as a one-way source for `POST /v1/sync/from-backup`, `watchbridge execute-backup-sync`, or the web backup-sync panel. The chosen target still needs a registered account write path for each selected feature. A saved direct-connector backup may instead be restored additively to the same service with `/v1/backups/:id/restore`; restore is not a cross-service route.

## Import safeguards

- Reject unknown manifest/config/archive fields and malformed CSV structure.
- Enforce UTF-8 byte, row-count, string, identifier, date, media-kind, and rating-scale bounds.
- Report mapped-CSV row issues; reject dedicated files whose non-empty data cannot produce valid records.
- Require an exact shared ID or exact canonical identity before treating target data as the same media item.
- Require `watchbridge.backup.v1` validation before a file becomes an executable sync source.
- Default backup-to-account execution to dry-run and require explicit confirmation plus a target backup before remote writes.
