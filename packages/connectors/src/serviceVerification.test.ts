import {
  RATING_SCALES,
  SERVICE_DEFINITIONS,
  getCapabilities,
  getRuntimeSupport,
  type ServiceId,
} from "@watchbridge/core";
import { describe, expect, it } from "vitest";
import { parseMappedCsv } from "./mappedCsv.js";
import { createMetadataConnector, createOfficialConnector } from "./factory.js";
import { importProviderFiles } from "./providerFiles.js";

const IMPORT_METHODS = {
  ratings: "importRatings",
  watched: "importWatched",
  watchlist: "importWatchlist",
  reviews: "importReviews",
  following: "importFollowing",
} as const;

const MANUAL_CSV = [
  "Title,Year,Kind,Score,Seen,Listed,Review,Reviewed,Spoiler,Following,Follower,Profile,Followed",
  "Heat,1995,movie,8,2026-01-01,2026-01-02,Excellent,2026-01-03,true,fan,,,2026-01-04",
  "Alien,1979,movie,7,,,,,,,another,https://example.test/another,",
].join("\n");

const MANUAL_COLUMNS = {
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
} as const;

const DEDICATED_FILE_FIXTURES = [
  {
    service: "imdb" as const,
    manifest: {
      service: "imdb" as const,
      files: {
        ratings:
          "Const,YourRating,Title,TitleType,Year\ntt0113277,9,Heat,movie,1995",
        watched:
          "Const,Created,Title,TitleType,Year\ntt0959621,2026-01-03,Pilot,tvEpisode,2008",
        watchlist:
          "Const,Created,Title,TitleType,Year\ntt0944947,2026-01-02,Game of Thrones,tvSeries,2011",
      },
    },
    features: ["ratings", "watched", "watchlist"] as const,
  },
  {
    service: "letterboxd" as const,
    manifest: {
      service: "letterboxd" as const,
      files: {
        ratings:
          "Name,Year,Rating,Date,Letterboxd URI\nHeat,1995,4.5,2026-01-01,https://letterboxd.com/film/heat/",
        watched:
          "Name,Year,Date,Letterboxd URI\nHeat,1995,2026-01-01,https://letterboxd.com/film/heat/",
        watchlist:
          "Name,Year,Date,Letterboxd URI\nThief,1981,2026-01-02,https://letterboxd.com/film/thief/",
        reviews:
          "Name,Year,Rating,Date,Letterboxd URI,Review\nHeat,1995,4.5,2026-01-01,https://letterboxd.com/film/heat/,A precise review.",
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
        ratings: "userId,movieId,rating,timestamp\n7,1,4.5,1704067200",
        movies: "movieId,title\n1,Toy Story (1995)",
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
              reviews: [
                {
                  review: { text: "A precise export review.", spoiler: false },
                },
              ],
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

describe("service verification matrix", () => {
  it("exposes an account or metadata/recommendation connector for every API-backed service", () => {
    const directAccount = SERVICE_DEFINITIONS.filter(
      (service) => getRuntimeSupport(service.id).workflow === "direct-account",
    );
    const metadata = SERVICE_DEFINITIONS.filter((service) => {
      const runtime = getRuntimeSupport(service.id);
      return runtime.metadata || runtime.recommendations;
    });

    expect(directAccount).toHaveLength(13);
    for (const service of directAccount) {
      const connector = createOfficialConnector(service.id);
      expect(connector, `${service.id}:official`).toBeDefined();
      expect(connector?.service).toBe(service.id);
      expect(connector?.exportBackup).toBeTypeOf("function");
      const methods = connector as unknown as Record<string, unknown>;
      for (const feature of getRuntimeSupport(service.id)
        .accountWriteFeatures) {
        expect(
          methods[IMPORT_METHODS[feature as keyof typeof IMPORT_METHODS]],
          `${service.id}:${feature}:import`,
        ).toBeTypeOf("function");
      }
    }

    expect(metadata).toHaveLength(9);
    for (const service of metadata) {
      const connector = createMetadataConnector(service.id);
      expect(connector, `${service.id}:metadata`).toBeDefined();
      expect(connector?.service).toBe(service.id);
      expect(connector?.exportBackup).toBeTypeOf("function");
      expect(Boolean(connector?.resolveMetadata)).toBe(
        getRuntimeSupport(service.id).metadata,
      );
      expect(Boolean(connector?.recommend)).toBe(
        getRuntimeSupport(service.id).recommendations,
      );
    }
  });

  it("exercises every dedicated provider-file import path and validates its output families", () => {
    for (const fixture of DEDICATED_FILE_FIXTURES) {
      expect(
        fixture.features,
        `${fixture.service}:runtime file features`,
      ).toEqual(getRuntimeSupport(fixture.service).fileReadFeatures);
      const backup = importProviderFiles(
        fixture.manifest,
        "2026-01-01T00:00:00.000Z",
      );
      expect(backup.service).toBe(fixture.service);
      for (const feature of fixture.features) {
        const records = (backup as unknown as Record<string, unknown>)[feature];
        expect(Array.isArray(records), `${fixture.service}:${feature}`).toBe(
          true,
        );
        expect(records).not.toHaveLength(0);
      }
    }
  });

  it("exercises every manual-mapping service through the generic import path", () => {
    const services = SERVICE_DEFINITIONS.filter(
      (service) => getRuntimeSupport(service.id).workflow === "manual-mapping",
    ).map((service) => service.id);

    expect(services).toHaveLength(13);
    for (const service of services) {
      const result = parseMappedCsv(MANUAL_CSV, {
        service,
        columns: MANUAL_COLUMNS,
        ratingScale: RATING_SCALES.imdb10,
      });
      expect(result.ratings, `${service}:ratings`).toHaveLength(2);
      expect(result.watched, `${service}:watched`).toHaveLength(1);
      expect(result.watchlist, `${service}:watchlist`).toHaveLength(1);
      expect(result.reviews, `${service}:reviews`).toHaveLength(1);
      expect(result.following, `${service}:following`).toHaveLength(1);
      expect(result.followers, `${service}:followers`).toHaveLength(1);
      expect(result.ratings[0]?.sourceService).toBe(service);
      expect(result.following[0]?.service).toBe(service);
    }
  });

  it("does not expose executable import or account connectors for restricted services", () => {
    const restricted = SERVICE_DEFINITIONS.filter(
      (service) => getRuntimeSupport(service.id).workflow === "restricted",
    ).map((service) => service.id);

    expect(restricted).toEqual(["rotten-tomatoes", "justwatch"]);
    for (const service of restricted) {
      expect(
        createOfficialConnector(service),
        `${service}:official`,
      ).toBeUndefined();
      expect(
        createMetadataConnector(service),
        `${service}:metadata`,
      ).toBeUndefined();
      expect(() =>
        parseMappedCsv("Title\nExample", {
          service,
          columns: { title: "Title" },
        }),
      ).toThrow("manual-mapping");
      expect(getCapabilities(service).integrationMode).toBe(
        "partner-or-request-only",
      );
    }
  });

  it("keeps capability claims aligned with the actual dedicated-file workflows", () => {
    const expected: Record<
      "imdb" | "letterboxd" | "movielens" | "ryot",
      string[]
    > = {
      imdb: ["ratings", "watched", "watchlist"],
      letterboxd: ["ratings", "watched", "watchlist", "reviews"],
      movielens: ["ratings"],
      ryot: ["watched", "watchlist", "reviews"],
    };
    const fields = {
      ratings: ["readRatings", "exportRatings"],
      watched: ["readWatched", "exportWatched"],
      watchlist: ["readWatchlist", "exportWatchlist"],
      reviews: ["readReviews", "exportReviews"],
    } as const;

    for (const [service, features] of Object.entries(expected) as Array<
      [keyof typeof expected, string[]]
    >) {
      const capabilities = getCapabilities(
        service as ServiceId,
      ) as unknown as Record<string, boolean>;
      for (const feature of Object.keys(fields) as Array<keyof typeof fields>) {
        const shouldBeSupported = features.includes(feature);
        for (const field of fields[feature]) {
          expect(capabilities[field], `${service}:${field}`).toBe(
            shouldBeSupported,
          );
        }
      }
    }
  });
});
