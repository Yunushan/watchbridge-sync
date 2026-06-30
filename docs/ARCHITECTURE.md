# Architecture

WatchBridge uses a hub-and-adapter design.

## Data flow

```text
source connector -> canonical import -> identity matching -> transform plan -> dry-run preview -> backup -> target connector/import file
```

## Canonical model

The canonical model preserves:

- original service;
- original rating scale;
- original timestamps;
- external IDs;
- raw imported row when needed;
- transformed target value;
- audit logs.

## Matching strategy

1. Match by strong IDs: IMDb tconst, TMDb ID, TVDB ID, TVmaze ID, MAL ID, AniList ID.
2. Match by secondary IDs from TMDb/TVmaze/Simkl/Trakt metadata.
3. Match by title + year + media type.
4. Ask user to resolve ambiguous matches.
5. Never guess silently for writes.

## Sync strategy

- Every write sync starts as dry-run.
- Every write sync creates a backup copy first.
- Every delete requires explicit confirmation.
- Conflicts are resolved by a policy: source-wins, target-wins, newest-wins, or manual.
- Unsupported operations degrade to export/manual workflow rather than unsafe automation.
