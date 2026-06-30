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
| AniList | 1-100 or user preference |
| Rotten Tomatoes / Metacritic | 0-100 display scale |

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
