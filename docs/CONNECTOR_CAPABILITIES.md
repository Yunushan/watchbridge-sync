# Connector Capabilities

Capability levels:

- **Official API**: connector can call documented API endpoints after user authorization.
- **Official export/import**: connector works through files the user downloads/uploads manually.
- **Metadata-only**: connector can enrich or match titles, but not write user data.
- **Manual**: project should generate backups/instructions but not automate writes.
- **Partner/request-only**: direct integration may require approval, partnership, or paid/commercial licensing.

## Current implementation snapshot

- **26/26 (100%)** services are selectable in the web UI, exposed by `GET /v1/services`, and visible through `watchbridge services`.
- **4/26 (15.4%)** have tested account-level official API connectors: TMDb, Trakt, Simkl, and MyAnimeList.
- **3/26 (11.5%)** have dedicated user-file workflows: IMDb, Letterboxd, and MovieLens.
- **2/26 (7.7%)** have tested metadata/recommendation-only connectors: TVmaze and TasteDive.
- **13/26 (50.0%)** are manual-profile services; a user-provided export can be imported through the explicit mapped-CSV workflow when a lawful export is available.
- **4/26 (15.4%)** remain restricted because their required access, licensing, or authorization has not been obtained: Rotten Tomatoes, JustWatch, TheTVDB, and AniList.

"Selectable" never means account sync is available. See [Manual CSV Import](MANUAL_CSV_IMPORT.md) for the safe file workflow.

| Service | Mode | Ratings | Watched | Watchlist | Reviews | Follow/follower | Notes |
|---|---|---:|---:|---:|---:|---:|---|
| IMDb | Export/import | Export/import | Limited | Export | Limited | Manual | Use CSV/user-owned workflows where available. |
| Rotten Tomatoes | Partner/request-only | Manual | Manual | Manual | Manual | Manual | Do not assume public write API. |
| Letterboxd | Export/import, API request-only | Export/import | Export/import | Export/import | Export/import | Export where available | Default to official exports/imports. |
| TMDb | Official API | Read/write | Limited | Read/write | No | No | Good metadata ID backbone. |
| TV Time | Manual | Manual | Manual | Manual | Manual | Manual | No public write API assumed. |
| Trakt | Official API | Read/write | Read/write | Read/write | Limited | Limited | Strong sync target/source. |
| Simkl | Official API | Read/write | Read/write | Read/write | Limited | Limited | Supports movies, TV, anime. |
| TVmaze | Official API | Metadata | Metadata | No | No | No | TV metadata and matching. |
| TheTVDB | Partner/request-only | No connector | No | No | No | No | Requires approved project-level licensing and credentials. |
| MyAnimeList | Official API | Read/write | Read/write | Read/write | Limited | Limited | Anime/manga. |
| AniList | Partner/request-only | No connector | No connector | No connector | No | No | Not enabled pending explicit authorization. |
| Metacritic | Manual | Manual | No | No | Manual | No | No safe write connector by default. |
| JustWatch | Partner/request-only | No | No | No | No | No | Streaming availability metadata only with approved access. |
| Reelgood | Manual | Manual | Manual | Manual | Manual | No | Manual/export profile. |
| Serializd | Manual/export | Export | Export | Export | Export | Manual | Build if official export/API is available. |
| AllMovie | Manual | Metadata | No | No | No | No | Reference metadata. |
| Criticker | Manual/export | Export | No | Export | Limited | Manual | Recommendation/rating backup. |
| MovieLens | Export/import | Export/import | No | Limited | No | No | Ratings dataset/export workflows. |
| FilmAffinity | Manual/export | Export | Export | Export | Reviews | Manual | Manual/export profile. |
| Flickchart | Manual/export | Ranking export | No | No | No | No | Requires ranking-to-rating mapping. |
| TasteDive | Official API | Recommendations | No | No | No | No | Recommendations metadata. |
| Taste.io | Manual/export | Export | No | Watchlist | Reviews | Manual | Manual/export profile. |
| MUBI | Manual/export | Export | Watched | Watchlist | Reviews | Manual | Manual/export profile. |
| Common Sense Media | Manual | Metadata | No | No | No | No | Metadata/reference only. |
| Douban Movie | Manual/export | Export | Export | Watchlist | Reviews | Follow/follower export | Manual/export profile. |
| Kinopoisk | Manual/export | Export | Export | Watchlist | Reviews | Follow/follower export | Manual/export profile. |

A connector must never claim write support until it has a documented, tested, user-authorized write path.
