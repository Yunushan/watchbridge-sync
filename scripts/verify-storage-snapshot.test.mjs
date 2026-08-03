import assert from "node:assert/strict";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const verifier = "scripts/verify-storage-snapshot.mjs";
const key = "11".repeat(32);
const schema = "watchbridge.storage.v1";
const algorithm = "A256GCM";

function envelope(kind, id, value, storageId = id) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(`${schema}\0${algorithm}\0${kind}\0${storageId}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({
    schema,
    algorithm,
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  });
}

async function snapshot() {
  const root = await mkdtemp(join(tmpdir(), "watchbridge-storage-snapshot-"));
  const id = randomUUID();
  await mkdir(join(root, "backups"), { recursive: true });
  await writeFile(join(root, "backups", `${id}.json`), envelope("backup", id, { schema: "watchbridge.backup.v1" }));
  return { root, id };
}

test("verifies encrypted records and writes a non-secret manifest", async () => {
  const { root } = await snapshot();
  const manifest = join(root, "manifest.json");
  const output = execFileSync(process.execPath, [verifier, root, "--write-manifest", manifest], { encoding: "utf8", env: { ...process.env, WATCHBRIDGE_STORAGE_KEY: key } });
  assert.match(output, /verification passed: 1 record/);
  const value = JSON.parse(await readFile(manifest, "utf8"));
  assert.equal(value.schema, "watchbridge.storage-snapshot-manifest.v1");
  assert.equal(value.recordCount, 1);
  assert.equal(Object.hasOwn(value.records[0], "ciphertext"), false);
  const verified = execFileSync(process.execPath, [verifier, root, "--verify-manifest", manifest, "--json"], { encoding: "utf8", env: { ...process.env, WATCHBRIDGE_STORAGE_KEY: key } });
  assert.deepEqual(JSON.parse(verified), { schema: "watchbridge.storage-snapshot-manifest.v1", recordCount: 1, kinds: ["backup"], manifest });
});

test("rejects plaintext and tampered records", async () => {
  const { root, id } = await snapshot();
  const path = join(root, "backups", `${id}.json`);
  await writeFile(path, JSON.stringify({ schema: "watchbridge.backup.v1" }));
  let result = spawnSync(process.execPath, [verifier, root], { encoding: "utf8", env: { ...process.env, WATCHBRIDGE_STORAGE_KEY: key } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no encrypted JSON records|not a strict watchbridge\.storage\.v1 envelope/);
  await writeFile(path, `${envelope("backup", id, { schema: "watchbridge.backup.v1" }).slice(0, -2)}xx`);
  result = spawnSync(process.execPath, [verifier, root], { encoding: "utf8", env: { ...process.env, WATCHBRIDGE_STORAGE_KEY: key } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /failed authenticated decryption|not a strict watchbridge\.storage\.v1 envelope|record is not JSON/);
});

test("rejects unexpected files and nesting under recognized storage roots", async () => {
  const { root, id } = await snapshot();
  await writeFile(join(root, "backups", "unexpected.txt"), "not a record");
  let result = spawnSync(process.execPath, [verifier, root], { encoding: "utf8", env: { ...process.env, WATCHBRIDGE_STORAGE_KEY: key } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not an encrypted JSON record/);
  await writeFile(join(root, "backups", "unexpected.txt"), "");
  await mkdir(join(root, "backups", "tenant", "nested"), { recursive: true });
  await writeFile(join(root, "backups", "tenant", "nested", `${id}.json`), envelope("backup", id, { schema: "watchbridge.backup.v1" }, `tenant:${id}`));
  result = spawnSync(process.execPath, [verifier, root], { encoding: "utf8", env: { ...process.env, WATCHBRIDGE_STORAGE_KEY: key } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported depth/);
});
