import { describe, expect, it } from 'vitest';
import { decodeStoredJson, encodeStoredJson, parsePlaintextMigrationOptIn, parseStorageKey, StorageCryptoError } from './storageCrypto.js';

const hexKey = '01'.repeat(32);
const otherHexKey = '02'.repeat(32);
const id = '11111111-1111-4111-8111-111111111111';
const plaintext = '{\n  "private": "watch-history"\n}';

describe('storage encryption', () => {
  it('strictly accepts only the documented 32-byte key forms', () => {
    const bytes = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
    expect(parseStorageKey(bytes.toString('hex'))).toEqual(bytes);
    expect(parseStorageKey(bytes.toString('base64'))).toEqual(bytes);
    expect(parseStorageKey(bytes.toString('base64url'))).toEqual(bytes);
    expect(parseStorageKey(undefined)).toBeUndefined();
    expect(parseStorageKey('')).toBeUndefined();
    expect(parsePlaintextMigrationOptIn(undefined)).toBe(false);
    expect(parsePlaintextMigrationOptIn('false')).toBe(false);
    expect(parsePlaintextMigrationOptIn('true')).toBe(true);

    for (const invalid of [
      '01'.repeat(31),
      ` ${hexKey}`,
      Buffer.alloc(32, 0xff).toString('base64').replace(/=$/, ''),
      `${Buffer.alloc(32, 0xfb).toString('base64url')}=`,
      'not-a-key'
    ]) {
      expect(() => parseStorageKey(invalid)).toThrow(StorageCryptoError);
    }
  });

  it('round-trips through a versioned AES-GCM envelope without plaintext bytes', () => {
    const stored = encodeStoredJson(plaintext, 'backup', id, hexKey, 'false');
    expect(encodeStoredJson(plaintext, 'backup', id, hexKey, 'false')).not.toBe(stored);
    expect(JSON.parse(stored)).toMatchObject({ schema: 'watchbridge.storage.v1', algorithm: 'A256GCM' });
    expect(stored).not.toContain('watch-history');
    expect(decodeStoredJson(stored, 'backup', id, hexKey, 'false')).toEqual({ plaintext, migrationRequired: false });
  });

  it('authenticates the record kind, id, envelope, and key with one generic failure', () => {
    const stored = encodeStoredJson(plaintext, 'backup', id, hexKey, 'false');
    const envelope = JSON.parse(stored) as Record<string, string>;
    const replacement = envelope.ciphertext[0] === 'A' ? 'B' : 'A';
    const tampered = JSON.stringify({ ...envelope, ciphertext: `${replacement}${envelope.ciphertext.slice(1)}` });

    for (const attempt of [
      () => decodeStoredJson(stored, 'job', id, hexKey, 'false'),
      () => decodeStoredJson(stored, 'backup', '22222222-2222-4222-8222-222222222222', hexKey, 'false'),
      () => decodeStoredJson(stored, 'backup', id, otherHexKey, 'false'),
      () => decodeStoredJson(stored, 'backup', id, '', 'false'),
      () => decodeStoredJson(tampered, 'backup', id, hexKey, 'false'),
      () => decodeStoredJson(JSON.stringify({ ...envelope, schema: 'watchbridge.storage.v2' }), 'backup', id, hexKey, 'false')
    ]) {
      expect(attempt).toThrowError(new StorageCryptoError());
    }
  });

  it('preserves no-key plaintext mode but requires an explicit migration opt-in with a key', () => {
    expect(encodeStoredJson(plaintext, 'job', id, '', 'false')).toBe(plaintext);
    expect(decodeStoredJson(plaintext, 'job', id, '', 'false')).toEqual({ plaintext, migrationRequired: false });
    expect(() => decodeStoredJson(plaintext, 'job', id, hexKey, 'false')).toThrow(StorageCryptoError);
    expect(decodeStoredJson(plaintext, 'job', id, hexKey, 'true')).toEqual({ plaintext, migrationRequired: true });
    expect(() => encodeStoredJson(plaintext, 'job', id, '', 'true')).toThrow(StorageCryptoError);
  });

  it('rejects malformed migration settings before reading or writing any storage record', () => {
    const stored = encodeStoredJson(plaintext, 'backup', id, hexKey, 'false');
    for (const invalid of ['', 'TRUE', '1', 'yes', ' true']) {
      expect(() => parsePlaintextMigrationOptIn(invalid)).toThrow(StorageCryptoError);
      expect(() => encodeStoredJson(plaintext, 'backup', id, hexKey, invalid)).toThrow(StorageCryptoError);
      expect(() => decodeStoredJson(stored, 'backup', id, hexKey, invalid)).toThrow(StorageCryptoError);
    }
  });
});
