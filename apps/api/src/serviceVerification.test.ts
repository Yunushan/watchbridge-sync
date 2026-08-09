import { SERVICE_DEFINITIONS, getRuntimeSupport } from "@watchbridge/core";
import { describe, expect, it } from "vitest";
import { app } from "./server.js";

const API_KEY = "service-verification-api-key";
const NEWLINE = String.fromCharCode(10);

async function requestJson(path: string, body?: unknown): Promise<unknown> {
  const response = await app.request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  expect(response.ok, `${path}: ${JSON.stringify(value)}`).toBe(true);
  return value;
}

const DEDICATED_FILE_FIXTURES = [
  {
    service: "imdb" as const,
    manifest: {
      service: "imdb" as const,
      files: {
        ratings: [
          "Const,YourRating,Title,TitleType,Year",
          "tt0113277,9,Heat,movie,1995",
        ].join(NEWLINE),
        watched: [
          "Const,Created,Title,TitleType,Year",
          "tt0959621,2026-01-03,Pilot,tvEpisode,2008",
        ].join(NEWLINE),
        watchlist: [
          "Const,Created,Title,TitleType,Year",
          "tt0944947,2026-01-02,Game of Thrones,tvSeries,2011",
        ].join(NEWLINE),
      },
    },
    features: ["ratings", "watched", "watchlist"] as const,
  },
  {
    service: "letterboxd" as const,
    manifest: {
      service: "letterboxd" as const,
      files: {
        ratings: [
          "Name,Year,Rating,Date,Letterboxd URI",
          "Heat,1995,4.5,2026-01-01,https://letterboxd.com/film/heat/",
        ].join(NEWLINE),
        watched: [
          "Name,Year,Date,Letterboxd URI",
          "Heat,1995,2026-01-01,https://letterboxd.com/film/heat/",
        ].join(NEWLINE),
        watchlist: [
          "Name,Year,Date,Letterboxd URI",
          "Thief,1981,2026-01-02,https://letterboxd.com/film/thief/",
        ].join(NEWLINE),
        reviews: [
          "Name,Year,Rating,Date,Letterboxd URI,Review",
          "Heat,1995,4.5,2026-01-01,https://letterboxd.com/film/heat/,A precise review.",
        ].join(NEWLINE),
      },
    },
    features: ["ratings", "watched", "watchlist", "reviews"] as const,
  },
  {
    service: "movielens" as const,
    manifest: {
      service: "movielens" as const,
      userId: "7",
      files: {
        ratings: ["userId,movieId,rating,timestamp", "7,1,4.5,1704067200"].join(
          NEWLINE,
        ),
        movies: ["movieId,title", "1,Toy Story (1995)"].join(NEWLINE),
      },
    },
    features: ["ratings"] as const,
  },
  {
    service: "ryot" as const,
    manifest: {
      service: "ryot" as const,
      files: {
        export: JSON.stringify({
          metadata: [
            {
              identifier: "550",
              lot: "movie",
              source: "tmdb",
              source_id: "Fight Club",
              collections: [{ collection_name: "Completed" }],
              seen_history: [{ state: "completed" }],
              reviews: [{ review: { text: "A precise review." } }],
            },
            {
              identifier: "1399",
              lot: "show",
              source: "tvdb",
              source_id: "Game of Thrones",
              collections: [{ collection_name: "Watchlist" }],
              seen_history: [],
              reviews: [],
            },
          ],
        }),
      },
    },
    features: ["watched", "watchlist", "reviews"] as const,
  },
] as const;

const MANUAL_CSV = [
  "Title,Year,Kind,Score,Seen,Listed,Review,Reviewed,Spoiler,Following,Follower,Profile,Followed",
  "Heat,1995,movie,8,2026-01-01,2026-01-02,Excellent,2026-01-03,true,fan,,,2026-01-04",
  "Alien,1979,movie,7,,,,,,,another,https://example.test/another,",
].join(NEWLINE);

const MANUAL_CONFIG = {
  columns: {
    title: "Title",
    year: "Year",
    kind: "Kind",
    rating: "Score",
    watchedAt: "Seen",
    watchlistAt: "Listed",
    review: "Review",
    reviewedAt: "Reviewed",
    reviewSpoiler: "Spoiler",
    followingUsername: "Following",
    followerUsername: "Follower",
    socialProfileUrl: "Profile",
    followedAt: "Followed",
  },
  ratingScale: { min: 1, max: 10, step: 1, name: "IMDb 1-10" },
} as const;

describe("API service verification matrix", () => {
  it("routes every dedicated-file and manual-mapping service through public endpoints", async () => {
    const previousApiKey = process.env.WATCHBRIDGE_API_KEY;
    process.env.WATCHBRIDGE_API_KEY = API_KEY;
    try {
      for (const fixture of DEDICATED_FILE_FIXTURES) {
        const result = (await requestJson(
          "/v1/import/provider-files",
          fixture.manifest,
        )) as Record<string, unknown>;
        expect(result.service).toBe(fixture.service);
        for (const feature of fixture.features) {
          expect(
            Array.isArray(result[feature]) && result[feature].length,
            `${fixture.service}:${feature}`,
          ).toBeTruthy();
        }
      }

      const manualServices = SERVICE_DEFINITIONS.filter(
        (service) =>
          getRuntimeSupport(service.id).workflow === "manual-mapping",
      );
      expect(manualServices).toHaveLength(13);
      for (const service of manualServices) {
        const result = (await requestJson("/v1/import/mapped-csv", {
          csv: MANUAL_CSV,
          config: { ...MANUAL_CONFIG, service: service.id },
        })) as Record<string, unknown[]>;
        for (const feature of [
          "ratings",
          "watched",
          "watchlist",
          "reviews",
          "following",
          "followers",
        ]) {
          expect(result[feature], `${service.id}:${feature}`).toHaveLength(
            feature === "ratings" ? 2 : 1,
          );
        }
      }
    } finally {
      if (previousApiKey === undefined) delete process.env.WATCHBRIDGE_API_KEY;
      else process.env.WATCHBRIDGE_API_KEY = previousApiKey;
    }
  });

  it("routes Letterboxd backup export and exposes the complete registry summary", async () => {
    const previousApiKey = process.env.WATCHBRIDGE_API_KEY;
    process.env.WATCHBRIDGE_API_KEY = API_KEY;
    try {
      const item = {
        id: "trakt:movie:1",
        kind: "movie",
        title: "Paris, Texas",
        year: 1984,
        externalIds: { imdb: "tt0087884", tmdbMovie: 655 },
      } as const;
      const backup = {
        schema: "watchbridge.backup.v1",
        service: "trakt",
        exportedAt: "2026-01-01T00:00:00Z",
        ratings: [
          {
            item,
            sourceService: "trakt",
            value: 8,
            scale: { min: 1, max: 10, step: 1, name: "Trakt 1-10" },
          },
        ],
        watched: [
          {
            item,
            service: "trakt",
            status: "watched",
            watchedAt: "2026-01-01T00:00:00Z",
          },
        ],
        watchlist: [
          { item, service: "trakt", listedAt: "2026-01-01T00:00:00Z" },
        ],
        reviews: [{ item, service: "trakt", body: "Great film." }],
      };
      const exported = (await requestJson("/v1/export/letterboxd-files", {
        backup,
        selection: {
          ratings: true,
          watched: true,
          watchlist: true,
          reviews: true,
        },
      })) as { files?: unknown[] };
      expect(exported.files).toHaveLength(4);

      const services = await requestJson("/v1/services");
      expect(services).toHaveLength(40);
      const summary = (await requestJson("/v1/support-summary")) as {
        platforms?: { selectable?: { total?: number } };
      };
      expect(summary.platforms?.selectable?.total).toBe(40);
    } finally {
      if (previousApiKey === undefined) delete process.env.WATCHBRIDGE_API_KEY;
      else process.env.WATCHBRIDGE_API_KEY = previousApiKey;
    }
  });
});
