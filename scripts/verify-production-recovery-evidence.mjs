import { readFile } from "node:fs/promises";

const [path] = process.argv.slice(2);

if (!path) {
  console.error("Usage: node scripts/verify-production-recovery-evidence.mjs <path>");
  process.exitCode = 2;
} else {
  let evidence;
  try {
    evidence = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    console.error(
      `Recovery evidence is not readable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }

  if (process.exitCode === undefined) {
    const expected = new Set([
      "schema",
      "commit",
      "workflow",
      "runId",
      "runAttempt",
      "generatedAt",
      "proxySmoke",
      "encryptedRestartRecovery",
      "encryptedVolumeRecovery",
    ]);
    const failures = [];
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
      failures.push("must be a JSON object");
    } else {
      const keys = Object.keys(evidence);
      for (const key of keys) {
        if (!expected.has(key)) failures.push(`contains unknown field ${key}`);
      }
      for (const key of expected) {
        if (!(key in evidence)) failures.push(`is missing ${key}`);
      }
      if (evidence.schema !== "watchbridge.production-recovery-evidence.v1")
        failures.push("has an unrecognized schema");
      if (typeof evidence.commit !== "string" || !/^[0-9a-f]{40}$/i.test(evidence.commit))
        failures.push("has an invalid commit SHA");
      for (const key of ["workflow", "runId", "runAttempt"]) {
        if (typeof evidence[key] !== "string" || !evidence[key].trim())
          failures.push(`has an invalid ${key}`);
      }
      if (
        typeof evidence.generatedAt !== "string" ||
        !Number.isFinite(Date.parse(evidence.generatedAt))
      ) {
        failures.push("has an invalid generatedAt timestamp");
      }
      for (const key of [
        "proxySmoke",
        "encryptedRestartRecovery",
        "encryptedVolumeRecovery",
      ]) {
        if (evidence[key] !== "passed") failures.push(`${key} is not passed`);
      }
    }
    if (failures.length) {
      console.error(`Recovery evidence validation failed: ${failures.join("; ")}`);
      process.exitCode = 1;
    } else {
      console.log("Production recovery evidence validation passed.");
    }
  }
}
