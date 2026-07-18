import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const verifier = "scripts/verify-production-recovery-evidence.mjs";
const validEvidence = {
  schema: "watchbridge.production-recovery-evidence.v1",
  commit: "a".repeat(40),
  workflow: "CI",
  runId: "123",
  runAttempt: "1",
  generatedAt: "2026-07-18T12:00:00Z",
  proxySmoke: "passed",
  encryptedRestartRecovery: "passed",
  encryptedVolumeRecovery: "passed",
};

async function evidenceFile(value) {
  const directory = await mkdtemp(join(tmpdir(), "watchbridge-recovery-evidence-"));
  const path = join(directory, "evidence.json");
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

test("accepts the complete non-secret recovery evidence schema", async () => {
  const path = await evidenceFile(validEvidence);
  const output = execFileSync(process.execPath, [verifier, path], {
    encoding: "utf8",
  });
  assert.match(output, /validation passed/);
});

test("rejects unrecognized fields so credentials cannot enter the artifact", async () => {
  const path = await evidenceFile({ ...validEvidence, accessToken: "secret" });
  const result = spawnSync(process.execPath, [verifier, path], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Recovery evidence validation failed: contains unknown field accessToken/,
  );
});
