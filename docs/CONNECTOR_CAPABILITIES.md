# Connector Capabilities

Capability levels:

- **Official API**: connector can call documented API endpoints after user authorization.
- **Official export/import**: connector works through files the user downloads/uploads manually.
- **Metadata-only**: connector can enrich or match titles, but not write user data.
- **Manual**: project should generate backups/instructions but not automate writes.
- **Partner/request-only**: direct integration may require approval, partnership, or paid/commercial licensing.

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
| TheTVDB | Official API/license | Metadata | No | No | No | No | Metadata matching; license may apply. |
| MyAnimeList | Official API | Read/write | Read/write | Read/write | Limited | Limited | Anime/manga. |
| AniList | Official GraphQL API | Read/write | Read/write | Read/write | Limited | Limited | Anime/manga. |
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
