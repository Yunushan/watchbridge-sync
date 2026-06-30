# Import and Export Formats

WatchBridge should support:

- JSON backup archive;
- CSV ratings export;
- CSV watched export;
- CSV watchlist export;
- service-specific import files;
- ZIP archive containing all user-owned data.

## Canonical JSON backup

```json
{
  "schema": "watchbridge.backup.v1",
  "exportedAt": "2026-06-30T00:00:00Z",
  "services": ["letterboxd", "imdb"],
  "ratings": [],
  "watched": [],
  "watchlist": [],
  "reviews": [],
  "following": [],
  "followers": []
}
```

## Import safeguards

- Validate every row.
- Keep unrecognized rows in the backup.
- Show skipped rows.
- Ask for match resolution when IDs are missing.
