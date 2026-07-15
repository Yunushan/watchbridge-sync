# Rating Mapping

WatchBridge stores ratings in a canonical format with the original scale preserved.

## Default scales

| Service | Scale |
|---|---|
| IMDb | 1-10 integer |
| Letterboxd | 0.5-5 half-star |
| TMDb | 0.5-10 |
| Trakt | 1-10 integer |
| Simkl | 1-10 integer |
| MyAnimeList | 1-10 integer |
| Shikimori | 1-10 integer; writes reject conversion that would require rounding |
| Bangumi | 1-10 integer |
| Jellyfin | 0-10 in 0.1 steps within WatchBridge's safety bound |
| Kodi | 1-10 integer |
| Plex | 0-10 in 0.1 steps |
| AniList | 1-100 or user preference |
| Rotten Tomatoes / Metacritic | 0-100 display scale |

Annict registers no canonical title-rating path because its ratings are attached to individual episode records. Emby registers no rating path because the implemented connector lacks a safely documented numeric scale/merge contract. Kitsu is metadata-only. These services therefore must not receive a value merely because the canonical conversion engine can calculate one.

## Letterboxd to IMDb

The requested project rule is explicit:

```text
IMDb rating = Letterboxd rating × 2
```

Examples:

| Letterboxd | IMDb |
|---:|---:|
| 0.5 | 1 |
| 1.0 | 2 |
| 2.5 | 5 |
| 3.0 | 6 |
| 4.5 | 9 |
| 5.0 | 10 |

## General conversion

For other services, use normalized percentage conversion:

```text
normalized = (sourceValue - sourceMin) / (sourceMax - sourceMin)
targetValue = targetMin + normalized × (targetMax - targetMin)
rounded = nearest target step
```

Every sync preview must show the conversion before writing.
