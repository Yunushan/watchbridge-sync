import { readFile } from "node:fs/promises";

const [path] = process.argv.slice(2);
if (!path) {
  console.error("Usage: node scripts/verify-production-capacity-evidence.mjs <path>");
  process.exitCode = 2;
} else {
  let evidence;
  try {
    evidence = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    console.error(`Capacity evidence is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
  if (process.exitCode === undefined) {
    const failures = [];
    const expected = new Set(["schema", "requests", "concurrency", "failures", "p95Ms"]);
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) failures.push("must be a JSON object");
    else {
      for (const key of Object.keys(evidence)) if (!expected.has(key)) failures.push(`contains unknown field ${key}`);
      for (const key of expected) if (!(key in evidence)) failures.push(`is missing ${key}`);
      if (evidence.schema !== "watchbridge.production-capacity-evidence.v1") failures.push("has an unrecognized schema");
      if (!Number.isSafeInteger(evidence.requests) || evidence.requests < 1 || evidence.requests > 10_000) failures.push("has an invalid requests count");
      if (!Number.isSafeInteger(evidence.concurrency) || evidence.concurrency < 1 || evidence.concurrency > evidence.requests) failures.push("has an invalid concurrency count");
      if (evidence.failures !== 0) failures.push("contains failed requests");
      if (typeof evidence.p95Ms !== "number" || !Number.isFinite(evidence.p95Ms) || evidence.p95Ms < 0 || evidence.p95Ms > 2_000) failures.push("p95Ms exceeds the two-second smoke objective");
    }
    if (failures.length) {
      console.error(`Capacity evidence validation failed: ${failures.join("; ")}`);
      process.exitCode = 1;
    } else console.log("Production capacity evidence validation passed.");
  }
}
