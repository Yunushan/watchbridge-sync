# Manual CSV Import

For services without a documented API, WatchBridge accepts a user-downloaded CSV together with an explicit column map. This preserves a compliant workflow: no scraping, password collection, or browser automation is needed.

Map the export's title column and any available year, external IDs, rating, watched date, and watchlist date. Provide the rating scale used by that service. The importer yields canonical ratings, watched entries, and watchlist entries that can then be matched through TMDb, TVmaze, or another supported resolver.

This workflow is intended for manual/export-only services such as TV Time, Serializd, Criticker, FilmAffinity, Flickchart, Taste.io, MUBI, Douban Movie, and Kinopoisk. It does not imply a direct write path back to those services.
