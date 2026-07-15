import { getRuntimeSupport, SERVICE_DEFINITIONS } from '@watchbridge/core';
import { describe, expect, it } from 'vitest';
import { createMetadataConnector, createOfficialConnector } from './factory.js';
import { OmdbConnector } from './omdb.js';

describe('connector factory/runtime registry contract', () => {
  it('constructs exactly the registered direct-account connectors', () => {
    for (const service of SERVICE_DEFINITIONS) {
      const connector = createOfficialConnector(service.id);
      expect(Boolean(connector), service.id).toBe(service.runtime.workflow === 'direct-account');
      if (!connector) continue;

      expect(connector.service).toBe(service.id);
      expect(Boolean(connector.importRatings)).toBe(service.runtime.accountWriteFeatures.includes('ratings'));
      expect(Boolean(connector.importWatched)).toBe(service.runtime.accountWriteFeatures.includes('watched'));
      expect(Boolean(connector.importWatchlist)).toBe(service.runtime.accountWriteFeatures.includes('watchlist'));
    }
  });

  it('constructs every registered metadata or recommendation connector', () => {
    for (const service of SERVICE_DEFINITIONS) {
      const runtime = getRuntimeSupport(service.id);
      const connector = createMetadataConnector(service.id);
      expect(Boolean(connector), service.id).toBe(runtime.metadata || runtime.recommendations);
      if (!connector) continue;

      expect(Boolean(connector.resolveMetadata), `${service.id}:metadata`).toBe(runtime.metadata);
      expect(Boolean(connector.recommend), `${service.id}:recommendations`).toBe(runtime.recommendations);
    }
  });

  it('constructs OMDb only through the metadata factory', () => {
    expect(createMetadataConnector('omdb')).toBeInstanceOf(OmdbConnector);
    expect(createOfficialConnector('omdb')).toBeUndefined();
  });
});
