import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

const STORAGE_SCHEMA = "watchbridge.storage.v1";
const STORAGE_ALGORITHM = "A256GCM";
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ROOT_KINDS = new Map([
  ["backups", "backup"],
  ["jobs", "job"],
  ["oauth-vault", "oauth-vault"],
  ["vault", "oauth-vault"],
]);

function usage() {
  console.error(
    "Usage: WATCHBRIDGE_STORAGE_KEY=<key> node scripts/verify-storage-snapshot.mjs <snapshot-root> [--write-manifest <path>] [--verify-manifest <path>] [--json]",
  );
}

function parseArguments(values) {
  const positional = [];
  let writeManifest;
  let verifyManifest;
  let json = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--json") {
      json = true;
      continue;
    }
    if (value === "--write-manifest" || value === "--verify-manifest") {
      const next = values[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${value} requires a path.`);
      if (value === "--write-manifest") writeManifest = next;
      else verifyManifest = next;
      index += 1;
      continue;
    }
    if (value.startsWith("--")) throw new Error(`Unknown option ${value}.`);
    positional.push(value);
  }
  if (positional.length !== 1) throw new Error("Exactly one snapshot root is required.");
  if (writeManifest && verifyManifest) throw new Error("Choose --write-manifest or --verify-manifest, not both.");
  return { root: resolve(positional[0]), writeManifest, verifyManifest, json };
}

function parseStorageKey(value) {
  if (!value) throw new Error("WATCHBRIDGE_STORAGE_KEY is required; refusing to verify an unencrypted snapshot.");
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, "hex");
  } else if (/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    key = Buffer.from(value, "base64");
    if (key.toString("base64") !== value) throw new Error("WATCHBRIDGE_STORAGE_KEY is not canonical Base64.");
  } else if (/^[A-Za-z0-9_-]{43}$/.test(value)) {
    key = Buffer.from(value, "base64url");
    if (key.toString("base64url") !== value) throw new Error("WATCHBRIDGE_STORAGE_KEY is not canonical Base64URL.");
  } else {
    throw new Error("WATCHBRIDGE_STORAGE_KEY must be a canonical 32-byte hex, Base64, or Base64URL value.");
  }
  if (key.length !== 32) {
    key.fill(0);
    throw new Error("WATCHBRIDGE_STORAGE_KEY must decode to exactly 32 bytes.");
  }
  return key;
}

function decodeBase64Url(value, expectedBytes, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${label} is not strict Base64URL.`);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value || (expectedBytes !== undefined && decoded.length !== expectedBytes)) {
    decoded.fill(0);
    throw new Error(`${label} has an invalid length or encoding.`);
  }
  return decoded;
}

function associatedData(kind, id) {
  return Buffer.from(`${STORAGE_SCHEMA}\0${STORAGE_ALGORITHM}\0${kind}\0${id}`, "utf8");
}

function decodeStoredJson(stored, kind, id, key) {
  let parsed;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new Error("record is not JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("record is not an encrypted envelope");
  const keys = Object.keys(parsed);
  if (
    keys.length !== 5 ||
    !["schema", "algorithm", "nonce", "ciphertext", "tag"].every((field) => keys.includes(field)) ||
    parsed.schema !== STORAGE_SCHEMA ||
    parsed.algorithm !== STORAGE_ALGORITHM
  ) {
    throw new Error("record is not a strict watchbridge.storage.v1 envelope");
  }
  let nonce;
  let ciphertext;
  let tag;
  let plaintext;
  try {
    nonce = decodeBase64Url(parsed.nonce, NONCE_BYTES, "nonce");
    ciphertext = decodeBase64Url(parsed.ciphertext, undefined, "ciphertext");
    tag = decodeBase64Url(parsed.tag, AUTH_TAG_BYTES, "tag");
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(associatedData(kind, id));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const value = JSON.parse(plaintext.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("plaintext is not a JSON object");
    return value;
  } catch {
    throw new Error("record failed authenticated decryption");
  } finally {
    nonce?.fill(0);
    ciphertext?.fill(0);
    tag?.fill(0);
    plaintext?.fill(0);
  }
}

async function filesUnder(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files.push(path);
    }
  }
  await visit(root);
  return files;
}

function recordLocation(root, path) {
  const parts = relative(root, path).split(/[\\/]/u);
  const rootIndex = parts.findIndex((part) => ROOT_KINDS.has(part));
  if (rootIndex < 0) return undefined;
  const kind = ROOT_KINDS.get(parts[rootIndex]);
  const remaining = parts.slice(rootIndex + 1);
  if (remaining.length < 1 || remaining.length > 2) throw new Error(`${relative(root, path)} is nested at an unsupported depth.`);
  if (!path.toLowerCase().endsWith(".json")) throw new Error(`${relative(root, path)} is not an encrypted JSON record.`);
  const fileName = remaining.at(-1);
  const id = basename(fileName, ".json");
  if (!RECORD_ID.test(id)) throw new Error(`${relative(root, path)} has a non-UUID record filename.`);
  const tenant = remaining.length === 2 ? remaining[0] : undefined;
  if (tenant && !TENANT_ID.test(tenant)) throw new Error(`${relative(root, path)} has an invalid tenant directory.`);
  return {
    kind,
    id,
    tenant,
    associatedId: tenant ? `${tenant}:${id}` : id,
    relativePath: relative(root, path).replaceAll("\\", "/"),
  };
}

function compareManifest(actual, expected) {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) throw new Error("manifest is not a JSON object");
  if (expected.schema !== "watchbridge.storage-snapshot-manifest.v1") throw new Error("manifest has an unknown schema");
  for (const key of Object.keys(expected)) if (!["schema", "generatedAt", "recordCount", "records"].includes(key)) throw new Error(`manifest contains unknown field ${key}`);
  if (typeof expected.generatedAt !== "string" || !Number.isFinite(Date.parse(expected.generatedAt))) throw new Error("manifest has an invalid generatedAt timestamp");
  if (!Number.isSafeInteger(expected.recordCount) || expected.recordCount !== expected.records?.length) throw new Error("manifest has an invalid recordCount");
  if (!Array.isArray(expected.records)) throw new Error("manifest records must be an array");
  const expectedRecords = new Map(expected.records.map((record) => [record.relativePath, record]));
  if (expectedRecords.size !== expected.records.length) throw new Error("manifest contains duplicate paths");
  if (actual.length !== expectedRecords.size) throw new Error(`manifest record count ${expectedRecords.size} does not match snapshot count ${actual.length}`);
  for (const record of actual) {
    const expectedRecord = expectedRecords.get(record.relativePath);
    if (!expectedRecord) throw new Error(`manifest is missing ${record.relativePath}`);
    for (const key of Object.keys(expectedRecord)) if (!["relativePath", "kind", "id", "tenant", "bytes", "sha256"].includes(key)) throw new Error(`manifest contains unknown field ${record.relativePath}.${key}`);
    for (const field of ["kind", "id", "tenant", "bytes", "sha256"]) {
      if ((expectedRecord[field] ?? undefined) !== (record[field] ?? undefined)) throw new Error(`manifest mismatch for ${record.relativePath}: ${field}`);
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const key = parseStorageKey(process.env.WATCHBRIDGE_STORAGE_KEY);
  try {
    const allFiles = await filesUnder(options.root);
    const records = [];
    const roots = new Set();
    for (const path of allFiles) {
      const location = recordLocation(options.root, path);
      if (!location) continue;
      roots.add(location.kind);
      const stored = await readFile(path, "utf8");
      decodeStoredJson(stored, location.kind, location.associatedId, key);
      records.push({
        kind: location.kind,
        id: location.id,
        tenant: location.tenant,
        relativePath: location.relativePath,
        bytes: Buffer.byteLength(stored, "utf8"),
        sha256: createHash("sha256").update(stored).digest("hex"),
      });
    }
    if (roots.size === 0) throw new Error("snapshot contains no recognized backups, jobs, or OAuth-vault directories");
    if (records.length === 0) throw new Error("snapshot contains no encrypted JSON records");
    records.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    if (options.verifyManifest) compareManifest(records, JSON.parse(await readFile(options.verifyManifest, "utf8")));
    const manifest = {
      schema: "watchbridge.storage-snapshot-manifest.v1",
      generatedAt: new Date().toISOString(),
      recordCount: records.length,
      records,
    };
    if (options.writeManifest) await writeFile(options.writeManifest, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    const result = { schema: manifest.schema, recordCount: records.length, kinds: [...roots].sort(), manifest: options.writeManifest ?? options.verifyManifest ?? null };
    if (options.json) console.log(JSON.stringify(result));
    else console.log(`Encrypted storage snapshot verification passed: ${records.length} record(s) across ${[...roots].sort().join(", ")}.`);
  } finally {
    key.fill(0);
  }
}

try {
  await main();
} catch (error) {
  usage();
  console.error(`Storage snapshot verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
