# Example Syncs

## Letterboxd ratings to IMDb

```bash
watchbridge plan letterboxd imdb ratings
```

Expected plan:

1. Read or import Letterboxd ratings CSV.
2. Match movies to IMDb IDs.
3. Double ratings from 5-star to 10-point scale.
4. Generate IMDb-compatible ratings import CSV or use approved write path if available.

## Trakt watched history to Simkl

1. OAuth login to Trakt.
2. OAuth login to Simkl.
3. Read watched history from Trakt.
4. Match IDs by IMDb/TMDb/TVDB.
5. Dry-run Simkl writes.
6. Backup Simkl current state.
7. Apply write operations.

## AniList anime list to MyAnimeList

1. OAuth login to AniList.
2. OAuth login to MyAnimeList.
3. Convert progress/status/rating scales.
4. Preview changed entries.
5. Apply with conflict policy.
