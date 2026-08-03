import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const API_KEY = "watchbridge-capacity-smoke-key-000000";
const STORAGE_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const REQUEST_COUNT = 64;
const WORKERS = 16;

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a loopback port for the capacity smoke test."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const forceStop = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("exit", () => {
      clearTimeout(forceStop);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function waitForReady(baseUrl) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/readyz`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The process may still be compiling/loading its provider registry.
    }
    await wait(125);
  }
  throw new Error("The production API did not become ready.");
}

async function main() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "watchbridge-api-capacity-smoke-"));
  const port = await reserveLoopbackPort();
  const child = spawn(process.execPath, ["apps/api/dist/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      WATCHBRIDGE_PORT: String(port),
      WATCHBRIDGE_API_KEY: API_KEY,
      WATCHBRIDGE_STORAGE_KEY: STORAGE_KEY,
      WATCHBRIDGE_BACKUP_DIR: join(temporaryRoot, "backups"),
      WATCHBRIDGE_JOB_DIR: join(temporaryRoot, "jobs"),
      WATCHBRIDGE_OAUTH_VAULT_DIR: join(temporaryRoot, "vault"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    try {
      await waitForReady(baseUrl);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`);
    }
    const durations = [];
    const failures = [];
    let next = 0;
    async function worker() {
      while (true) {
        const index = next;
        next += 1;
        if (index >= REQUEST_COUNT) return;
        const started = performance.now();
        try {
          const response = await fetch(`${baseUrl}/v1/metrics`, {
            headers: { Authorization: `Bearer ${API_KEY}` },
            signal: AbortSignal.timeout(5_000),
          });
          const body = await response.text();
          if (!response.ok || !body.includes("watchbridge_process_start_time_seconds ")) {
            failures.push(`request ${index} returned ${response.status}`);
          } else {
            durations.push(performance.now() - started);
          }
        } catch (error) {
          failures.push(`request ${index} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    await Promise.all(Array.from({ length: WORKERS }, () => worker()));
    durations.sort((left, right) => left - right);
    const p95 = durations.length === 0 ? Number.POSITIVE_INFINITY : durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)];
    if (failures.length > 0 || durations.length !== REQUEST_COUNT || p95 > 2_000) {
      throw new Error(`Capacity smoke failed: ${failures.length} errors, ${durations.length}/${REQUEST_COUNT} successes, p95 ${p95.toFixed(1)}ms.\n${output}`);
    }
    console.log(JSON.stringify({ schema: "watchbridge.production-capacity-evidence.v1", requests: REQUEST_COUNT, concurrency: WORKERS, failures: failures.length, p95Ms: Number(p95.toFixed(1)) }));
  } finally {
    await stopProcess(child);
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
