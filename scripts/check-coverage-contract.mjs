import { readFile } from "node:fs/promises";

const packages = [
  ["apps/api/package.json", "apps/api/vitest.config.ts"],
  ["apps/web/package.json", "apps/web/vite.config.ts"],
  ["packages/cli/package.json", "packages/cli/vitest.config.ts"],
  ["packages/connectors/package.json", "packages/connectors/vitest.config.ts"],
  ["packages/core/package.json", "packages/core/vitest.config.ts"],
];
const failures = [];
const thresholdNames = ["lines", "statements", "functions", "branches"];

for (const [packagePath, configPath] of packages) {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const config = await readFile(configPath, "utf8");
  if (packageJson.devDependencies?.["@vitest/coverage-v8"] !== "4.1.10") {
    failures.push(
      `${packagePath}: @vitest/coverage-v8 must be pinned to 4.1.10.`,
    );
  }
  if (packageJson.scripts?.["test:coverage"] !== "vitest run --coverage") {
    failures.push(
      `${packagePath}: test:coverage must execute Vitest with coverage enabled.`,
    );
  }
  if (!/provider:\s*["']v8["']/.test(config))
    failures.push(`${configPath}: missing the V8 coverage provider.`);
  if (
    !/reporter:\s*\[\s*["']text-summary["']\s*,\s*["']json-summary["']\s*\]/.test(
      config,
    )
  )
    failures.push(
      `${configPath}: missing text-summary and json-summary coverage reporters.`,
    );
  for (const required of ["include:", "exclude:", "thresholds:"]) {
    if (!config.includes(required))
      failures.push(`${configPath}: missing ${required}`);
  }
  for (const name of thresholdNames) {
    const match = new RegExp(`${name}:\\s*(\\d+)`).exec(config);
    const value = Number(match?.[1]);
    if (!Number.isInteger(value) || value < 1 || value > 100)
      failures.push(
        `${configPath}: ${name} threshold must be between 1 and 100.`,
      );
  }
}

const rootPackage = JSON.parse(await readFile("package.json", "utf8"));
if (rootPackage.devDependencies?.["@vitest/coverage-v8"] !== "4.1.10")
  failures.push(
    "package.json: root coverage provider must be pinned to 4.1.10.",
  );
if (!rootPackage.scripts?.test?.includes("pnpm test:coverage"))
  failures.push(
    "package.json: the default test command must enforce coverage.",
  );

if (failures.length) {
  console.error(
    [
      "Coverage contract check failed:",
      ...failures.map((failure) => `- ${failure}`),
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log(
    "Coverage contract check passed: all workspaces enforce pinned V8 coverage thresholds.",
  );
}
