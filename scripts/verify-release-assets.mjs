import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

function usage() {
  console.error("Usage: node scripts/verify-release-assets.mjs <release-directory> <vX.Y.Z>");
}

function parseOctal(block, start, length, label) {
  const value = block.subarray(start, start + length).toString("ascii").replace(/\0/g, "").trim();
  if (!/^[0-7]+$/.test(value)) throw new Error(`source archive contains an invalid ${label}`);
  return Number.parseInt(value, 8);
}

function parseTarEntries(archive) {
  if (archive.length % 512 !== 0) throw new Error("source archive tar stream is not block aligned");
  const entries = [];
  const names = new Set();
  let offset = 0;
  let zeroBlocks = 0;
  while (offset + 512 <= archive.length) {
    const block = archive.subarray(offset, offset + 512);
    if (block.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      offset += 512;
      if (zeroBlocks >= 2) {
        if (archive.subarray(offset).some((byte) => byte !== 0)) throw new Error("source archive contains data after its tar end marker");
        break;
      }
      continue;
    }
    zeroBlocks = 0;
    const storedChecksum = parseOctal(block, 148, 8, "header checksum");
    let calculatedChecksum = 0;
    for (let index = 0; index < block.length; index += 1) calculatedChecksum += index >= 148 && index < 156 ? 0x20 : block[index];
    if (storedChecksum !== calculatedChecksum) throw new Error("source archive contains an invalid tar header checksum");
    const name = block.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const prefix = block.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
    const fullName = prefix ? `${prefix}/${name}` : name;
    if (!fullName || fullName.startsWith("/") || fullName.split("/").includes("..")) throw new Error("source archive contains an unsafe path");
    if (names.has(fullName)) throw new Error(`source archive contains a duplicate path: ${fullName}`);
    names.add(fullName);
    const size = parseOctal(block, 124, 12, "file size");
    const type = String.fromCharCode(block[156] || 0);
    if (type !== "0" && type !== "\0" && type !== "5") throw new Error(`source archive contains a special file: ${fullName}`);
    entries.push({ name: fullName, type });
    offset += 512 + Math.ceil(size / 512) * 512;
    if (offset > archive.length) throw new Error("source archive contains a truncated file");
  }
  if (zeroBlocks < 2) throw new Error("source archive is missing its tar end marker");
  return entries;
}

async function main() {
  const [directory, tag] = process.argv.slice(2);
  if (!directory || !tag) {
    usage();
    process.exitCode = 2;
    return;
  }
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error("release tag must be a semantic vX.Y.Z tag");
  const prefix = `watchbridge-sync-${tag}`;
  const archiveName = `${prefix}-source.tar.gz`;
  const checksumName = `${archiveName}.sha256`;
  const sbomName = `${prefix}-sbom.cdx.json`;
  const archive = await readFile(join(directory, archiveName));
  const checksum = (await readFile(join(directory, checksumName), "utf8")).trim().split(/\r?\n/u);
  if (checksum.length !== 1) throw new Error("checksum file must contain exactly one entry");
  const checksumMatch = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(checksum[0]);
  if (!checksumMatch || checksumMatch[2] !== archiveName) throw new Error("checksum file does not name the expected source archive");
  const actualHash = createHash("sha256").update(archive).digest("hex");
  if (actualHash !== checksumMatch[1].toLowerCase()) throw new Error("source archive checksum does not match");
  let entries;
  try {
    entries = parseTarEntries(gunzipSync(archive));
  } catch (error) {
    throw new Error(`source archive is not a readable gzip/tar stream: ${error instanceof Error ? error.message : "invalid archive"}`);
  }
  for (const requiredEntry of [`${prefix}/package.json`, `${prefix}/LICENSE`, `${prefix}/Dockerfile`]) {
    if (!entries.some((entry) => entry.name === requiredEntry && (entry.type === "0" || entry.type === "\0"))) throw new Error(`source archive is missing ${requiredEntry}`);
  }
  if (entries.some(({ name }) => name.startsWith(`${prefix}/node_modules/`) || name.startsWith(`${prefix}/.git/`) || name.startsWith(`${prefix}/.watchbridge-`) || name === `${prefix}/.env` || name.startsWith(`${prefix}/.env/`))) throw new Error("source archive contains generated, repository, or secret-bearing paths");
  let sbom;
  try {
    sbom = JSON.parse(await readFile(join(directory, sbomName), "utf8"));
  } catch {
    throw new Error("SBOM is not readable JSON");
  }
  if (!sbom || typeof sbom !== "object" || Array.isArray(sbom) || sbom.bomFormat !== "CycloneDX" || typeof sbom.specVersion !== "string" || !Array.isArray(sbom.components)) {
    throw new Error("SBOM is not a valid CycloneDX component document");
  }
  if (/(accessToken|refreshToken|clientSecret|apiKey|WATCHBRIDGE_API_KEY|WATCHBRIDGE_STORAGE_KEY|Bearer\s+)/i.test(JSON.stringify(sbom))) throw new Error("SBOM contains a secret-like field");
  console.log(`Release asset validation passed: ${archiveName}, ${checksumName}, and ${sbomName}.`);
}

try {
  await main();
} catch (error) {
  usage();
  console.error(`Release asset validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
