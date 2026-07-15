import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const STORAGE_SCHEMA = 'watchbridge.storage.v1' as const;
const STORAGE_ALGORITHM = 'A256GCM' as const;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type StorageRecordKind = 'backup' | 'job';

export interface DecodedStoredJson {
  plaintext: string;
  migrationRequired: boolean;
}

interface StorageEnvelopeV1 {
  schema: typeof STORAGE_SCHEMA;
  algorithm: typeof STORAGE_ALGORITHM;
  nonce: string;
  ciphertext: string;
  tag: string;
}

/** Deliberately generic: callers must not reveal whether the key or data was wrong. */
export class StorageCryptoError extends Error {
  constructor() {
    super('Stored data is unavailable.');
    this.name = 'StorageCryptoError';
  }
}

/**
 * Parse one of the documented, unambiguous 32-byte key encodings:
 * - 64 hexadecimal characters
 * - canonical padded Base64 (44 characters ending in `=`)
 * - canonical unpadded Base64URL (43 characters)
 */
export function parseStorageKey(value: string | undefined): Buffer | undefined {
  if (value === undefined || value === '') return undefined;

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, 'hex');
  } else if (/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    key = Buffer.from(value, 'base64');
    if (key.toString('base64') !== value) {
      key.fill(0);
      throw new StorageCryptoError();
    }
  } else if (/^[A-Za-z0-9_-]{43}$/.test(value)) {
    key = Buffer.from(value, 'base64url');
    if (key.toString('base64url') !== value) {
      key.fill(0);
      throw new StorageCryptoError();
    }
  } else {
    throw new StorageCryptoError();
  }

  if (key.length !== 32) {
    key.fill(0);
    throw new StorageCryptoError();
  }
  return key;
}

export function parsePlaintextMigrationOptIn(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new StorageCryptoError();
}

function associatedData(kind: StorageRecordKind, id: string): Buffer {
  return Buffer.from(`${STORAGE_SCHEMA}\0${STORAGE_ALGORITHM}\0${kind}\0${id}`, 'utf8');
}

function strictBase64Url(value: unknown, expectedBytes?: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new StorageCryptoError();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value || (expectedBytes !== undefined && decoded.length !== expectedBytes)) {
    decoded.fill(0);
    throw new StorageCryptoError();
  }
  return decoded;
}

function parseEnvelope(value: unknown): StorageEnvelopeV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StorageCryptoError();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 5
    || !['schema', 'algorithm', 'nonce', 'ciphertext', 'tag'].every((key) => keys.includes(key))
    || record.schema !== STORAGE_SCHEMA
    || record.algorithm !== STORAGE_ALGORITHM
    || typeof record.nonce !== 'string'
    || typeof record.ciphertext !== 'string'
    || typeof record.tag !== 'string'
  ) {
    throw new StorageCryptoError();
  }
  return record as unknown as StorageEnvelopeV1;
}

function looksLikeEncryptedEnvelope(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schema === STORAGE_SCHEMA
    || ['algorithm', 'nonce', 'ciphertext', 'tag'].some((key) => Object.hasOwn(record, key));
}

export function encodeStoredJson(
  plaintext: string,
  kind: StorageRecordKind,
  id: string,
  configuredKey: string | undefined = process.env.WATCHBRIDGE_STORAGE_KEY,
  configuredMigrationOptIn: string | undefined = process.env.WATCHBRIDGE_ALLOW_PLAINTEXT_STORAGE_MIGRATION
): string {
  const allowPlaintextMigration = parsePlaintextMigrationOptIn(configuredMigrationOptIn);
  const key = parseStorageKey(configuredKey);
  if (!key) {
    if (allowPlaintextMigration) throw new StorageCryptoError();
    return plaintext;
  }

  const nonce = randomBytes(NONCE_BYTES);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(associatedData(kind, id));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const envelope: StorageEnvelopeV1 = {
      schema: STORAGE_SCHEMA,
      algorithm: STORAGE_ALGORITHM,
      nonce: nonce.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url')
    };
    ciphertext.fill(0);
    return JSON.stringify(envelope);
  } catch {
    throw new StorageCryptoError();
  } finally {
    key.fill(0);
    nonce.fill(0);
  }
}

export function decodeStoredJson(
  stored: string,
  kind: StorageRecordKind,
  id: string,
  configuredKey: string | undefined = process.env.WATCHBRIDGE_STORAGE_KEY,
  configuredMigrationOptIn: string | undefined = process.env.WATCHBRIDGE_ALLOW_PLAINTEXT_STORAGE_MIGRATION
): DecodedStoredJson {
  const allowPlaintextMigration = parsePlaintextMigrationOptIn(configuredMigrationOptIn);
  const key = parseStorageKey(configuredKey);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    key?.fill(0);
    // A persistence record must be JSON whether encryption is configured or not.
    throw new StorageCryptoError();
  }

  if (!looksLikeEncryptedEnvelope(parsed)) {
    if (key && !allowPlaintextMigration) {
      key.fill(0);
      throw new StorageCryptoError();
    }
    if (!key && allowPlaintextMigration) throw new StorageCryptoError();
    key?.fill(0);
    return { plaintext: stored, migrationRequired: Boolean(key) };
  }

  let envelope: StorageEnvelopeV1;
  try {
    envelope = parseEnvelope(parsed);
  } catch {
    key?.fill(0);
    throw new StorageCryptoError();
  }
  if (!key) throw new StorageCryptoError();

  let nonce: Buffer | undefined;
  let ciphertext: Buffer | undefined;
  let tag: Buffer | undefined;
  try {
    nonce = strictBase64Url(envelope.nonce, NONCE_BYTES);
    ciphertext = strictBase64Url(envelope.ciphertext);
    tag = strictBase64Url(envelope.tag, AUTH_TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(associatedData(kind, id));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    try {
      return { plaintext: plaintext.toString('utf8'), migrationRequired: false };
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw new StorageCryptoError();
  } finally {
    key.fill(0);
    nonce?.fill(0);
    ciphertext?.fill(0);
    tag?.fill(0);
  }
}
