import { readdir } from "node:fs/promises";
import { join } from "node:path";

const minimumFiles = 50;
const requiredAreas = ["apps/api", "apps/web", "packages/cli", "packages/connectors", "packages/core"];

async function testFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !["node_modules", "dist", ".git", ".pnpm-store", ".local"].includes(entry.name)) files.push(...(await testFiles(path)));
    else if (entry.isFile() && /\.test\.(?:ts|tsx|mjs)$/i.test(entry.name)) files.push(path.replaceAll("\\", "/"));
  }
  return files;
}

const files = (await testFiles(".")).filter((file) => !file.startsWith(".pnpm-store/") && !file.includes("/node_modules/"));
const failures = [];
if (files.length < minimumFiles) failures.push(`test inventory contains ${files.length} files; expected at least ${minimumFiles}.`);
for (const area of requiredAreas) {
  if (!files.some((file) => file.startsWith(`${area}/`))) failures.push(`${area} has no test file.`);
}
for (const file of ["scripts/live-provider-dry-run.test.mjs", "scripts/verify-production-recovery-evidence.test.mjs", "scripts/verify-storage-snapshot.test.mjs", "scripts/verify-production-capacity-evidence.test.mjs", "scripts/verify-release-assets.test.mjs", "scripts/check-github-governance.test.mjs"]) {
  if (!files.includes(file)) failures.push(`${file} is missing from the operational test inventory.`);
}
if (failures.length) {
  console.error(["Test inventory check failed:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Test inventory check passed: ${files.length} test files across all shipped workspaces and operational controls.`);
}
