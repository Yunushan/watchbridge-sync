import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const verifier = "scripts/verify-production-capacity-evidence.mjs";
const validEvidence = {
  schema: "watchbridge.production-capacity-evidence.v1",
  requests: 64,
  concurrency: 16,
  failures: 0,
  p95Ms: 42.5,
};

async function evidenceFile(value) {
  const directory = await mkdtemp(join(tmpdir(), "watchbridge-capacity-evidence-"));
  const path = join(directory, "evidence.json");
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

test("accepts bounded successful capacity evidence", async () => {
  const output = execFileSync(process.execPath, [verifier, await evidenceFile(validEvidence)], { encoding: "utf8" });
  assert.match(output, /validation passed/);
});

test("rejects failed or slow capacity evidence", async () => {
  const result = spawnSync(process.execPath, [verifier, await evidenceFile({ ...validEvidence, failures: 1, p95Ms: 2_001 })], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /contains failed requests/);
  assert.match(result.stderr, /p95Ms exceeds/);
});
