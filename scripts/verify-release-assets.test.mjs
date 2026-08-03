import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const verifier = "scripts/verify-release-assets.mjs";

function tarEntry(name, contents, type = "0") {
  const body = Buffer.from(contents, "utf8");
  const block = Buffer.alloc(512);
  block.write(name, 0, "utf8");
  block.write("0000644\0", 100, "ascii");
  block.write("0000000\0", 108, "ascii");
  block.write("0000000\0", 116, "ascii");
  block.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, "ascii");
  block.write("00000000000\0", 136, "ascii");
  block[156] = type.charCodeAt(0);
  block.write("ustar\0", 257, "ascii");
  block.write("00", 263, "ascii");
  for (let index = 148; index < 156; index += 1) block[index] = 0x20;
  let checksum = 0;
  for (const byte of block) checksum += byte;
  block.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([block, body, padding]);
}

async function releaseDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "watchbridge-release-assets-"));
  const tag = "v0.1.0";
  const prefix = `watchbridge-sync-${tag}`;
  const archiveName = `${prefix}-source.tar.gz`;
  const archive = gzipSync(Buffer.concat([
    tarEntry(`${prefix}/package.json`, "{}"),
    tarEntry(`${prefix}/LICENSE`, "0BSD"),
    tarEntry(`${prefix}/Dockerfile`, "FROM scratch"),
    Buffer.alloc(1024),
  ]));
  await writeFile(join(directory, archiveName), archive);
  await writeFile(join(directory, `${archiveName}.sha256`), `${createHash("sha256").update(archive).digest("hex")}  ${archiveName}\n`);
  await writeFile(join(directory, `${prefix}-sbom.cdx.json`), JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", components: [{ type: "library", name: "watchbridge-sync", version: tag.slice(1) }] }));
  return { directory, tag, archiveName };
}

test("validates source archive, checksum, and SBOM assets", async () => {
  const { directory, tag } = await releaseDirectory();
  const output = execFileSync(process.execPath, [verifier, directory, tag], { encoding: "utf8" });
  assert.match(output, /Release asset validation passed/);
});

test("accepts Git PAX metadata and the release workflow checksum path", async () => {
  const { directory, tag, archiveName } = await releaseDirectory();
  const prefix = `watchbridge-sync-${tag}`;
  const archive = gzipSync(Buffer.concat([
    tarEntry("pax_global_header", "25 mtime=0\\n", "g"),
    tarEntry(`${prefix}/package.json`, "{}"),
    tarEntry(`${prefix}/LICENSE`, "0BSD"),
    tarEntry(`${prefix}/Dockerfile`, "FROM scratch"),
    Buffer.alloc(1024),
  ]));
  await writeFile(join(directory, archiveName), archive);
  await writeFile(join(directory, `${archiveName}.sha256`), `${createHash("sha256").update(archive).digest("hex")}  release/${archiveName}\n`);
  const output = execFileSync(process.execPath, [verifier, directory, tag], { encoding: "utf8" });
  assert.match(output, /Release asset validation passed/);
});

test("rejects a changed archive even when the release files exist", async () => {
  const { directory, tag, archiveName } = await releaseDirectory();
  await writeFile(join(directory, archiveName), Buffer.from("tampered"));
  const result = spawnSync(process.execPath, [verifier, directory, tag], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /checksum does not match/);
});

test("rejects secret-like fields in the SBOM", async () => {
  const { directory, tag } = await releaseDirectory();
  await writeFile(join(directory, `watchbridge-sync-${tag}-sbom.cdx.json`), JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", components: [{ name: "apiKey" }] }));
  const result = spawnSync(process.execPath, [verifier, directory, tag], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /secret-like field/);
});

test("rejects archive data after the tar end marker", async () => {
  const { directory, tag, archiveName } = await releaseDirectory();
  const prefix = `watchbridge-sync-${tag}`;
  const archive = gzipSync(Buffer.concat([
    tarEntry(`${prefix}/package.json`, "{}"),
    tarEntry(`${prefix}/LICENSE`, "0BSD"),
    tarEntry(`${prefix}/Dockerfile`, "FROM scratch"),
    Buffer.alloc(1024),
    Buffer.alloc(512, 0x41),
  ]));
  await writeFile(join(directory, archiveName), archive);
  await writeFile(join(directory, `${archiveName}.sha256`), `${createHash("sha256").update(archive).digest("hex")}  ${archiveName}\n`);
  const result = spawnSync(process.execPath, [verifier, directory, tag], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /data after its tar end marker/);
});
