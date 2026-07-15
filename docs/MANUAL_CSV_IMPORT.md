# Manual CSV Import

For services without a documented API, WatchBridge accepts a user-downloaded CSV together with an explicit column map. This preserves a compliant workflow: no scraping, password collection, or browser automation is needed.

Map the export's title column and any available year, external IDs, rating, watched date, and watchlist date. Provide the rating scale used by that service. The importer yields canonical ratings, watched entries, and watchlist entries that can then be matched through TMDb, TVmaze, or another supported resolver.

This workflow is intended for the 13 `manual-mapping` entries in the runtime registry: TV Time, Metacritic, Reelgood, Serializd, AllMovie, Criticker, FilmAffinity, Flickchart, Taste.io, MUBI, Common Sense Media, Douban Movie, and Kinopoisk. It does not imply that a service offers an export or that WatchBridge has a direct read/write path. Rotten Tomatoes, JustWatch, and AniList are restricted and are not part of this workflow.

The web app includes a **Manual CSV import** panel for this workflow. Paste a user-downloaded CSV, select its source service, adjust the explicit column map, preview the canonical records, then download the resulting local JSON backup.
