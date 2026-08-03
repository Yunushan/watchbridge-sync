import { readFile } from "node:fs/promises";

const alerts = await readFile("monitoring/prometheus-alerts.yml", "utf8");
const scrape = await readFile("monitoring/prometheus.example.yml", "utf8");
const failures = [];
for (const name of [
  "WatchBridgeApiUnavailable",
  "WatchBridgeApiHighServerErrorRate",
  "WatchBridgeApiHighLatency",
  "WatchBridgeSyncExecutionSaturated",
  "WatchBridgeApiRequestCapacitySaturated",
]) {
  if (!alerts.includes(`alert: ${name}`)) failures.push(`missing alert ${name}`);
}
for (const required of ["for: 5m", "for: 10m", "for: 15m", "severity: critical", "severity: warning"]) {
  if (!alerts.includes(required)) failures.push(`missing alert safety control ${required}`);
}
if (!scrape.includes("metrics_path: /v1/metrics") || !scrape.includes("scheme: http")) failures.push("Prometheus must scrape the private API metrics path over the documented private-network scheme.");
if (!scrape.includes("credentials_file: /run/secrets/watchbridge_metrics_api_key")) failures.push("Prometheus must source the metrics credential from a runtime secret file.");
if (!scrape.includes("watchbridge-api.internal:8080")) failures.push("Prometheus example must use a private API target, not the public edge.");
if (scrape.includes("credentials: ") || scrape.includes("Authorization: Bearer ")) failures.push("Prometheus configuration must not contain an inline credential.");
if (failures.length) {
  console.error(["Monitoring contract check failed:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exitCode = 1;
} else {
  console.log("Monitoring contract check passed.");
}
