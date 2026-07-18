import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const API_KEY = "watchbridge-production-smoke-key-000000";
const STORAGE_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(
          new Error(
            "Could not reserve a loopback port for the API smoke test.",
          ),
        );
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchEventually(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return response;
      lastError = new Error(`${url} returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await wait(125);
  }
  throw lastError ?? new Error(`${url} did not become available.`);
}

function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    let forced = false;
    const forceStop = setTimeout(() => {
      forced = true;
      child.kill("SIGKILL");
    }, 5_000);
    child.once("exit", (code, signal) => {
      clearTimeout(forceStop);
      resolve({ code, signal, forced });
    });
    child.kill("SIGTERM");
  });
}

function assertCleanShutdown(shutdown) {
  // Windows cannot deliver POSIX SIGTERM to a child Node process; Node maps it
  // to termination there. Linux CI asserts the actual signal-handler drain.
  if (
    process.platform !== "win32" &&
    (shutdown.forced || shutdown.code !== 0 || shutdown.signal !== null)
  ) {
    throw new Error(
      `Production API did not drain cleanly after SIGTERM (code ${shutdown.code}, signal ${shutdown.signal}, forced ${shutdown.forced ?? false}).`,
    );
  }
}

let output = "";

function startApi(port, temporaryRoot) {
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
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  return child;
}

const temporaryRoot = await mkdtemp(
  join(tmpdir(), "watchbridge-api-production-smoke-"),
);
const port = await reserveLoopbackPort();
let child = startApi(port, temporaryRoot);

try {
  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await fetchEventually(`${baseUrl}/healthz`);
  const readiness = await fetchEventually(`${baseUrl}/readyz`);
  const metrics = await fetchEventually(`${baseUrl}/v1/metrics`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const metricsBody = await metrics.text();
  if (
    !metricsBody.includes("watchbridge_process_start_time_seconds ") ||
    !metricsBody.includes("watchbridge_api_requests_limit 16") ||
    !metricsBody.includes("watchbridge_sync_executions_limit 2")
  ) {
    throw new Error(
      "Authenticated production metrics did not expose the required process, request-budget, and sync-budget gauges.",
    );
  }
  const vaultResponse = await fetch(`${baseUrl}/v1/oauth/vault`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      service: "trakt",
      context: {
        accessToken: "production-smoke-vault-access-token",
        apiKey: "production-smoke-vault-client-key",
      },
      confirmStore: true,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  const vault = await vaultResponse.json();
  if (!vaultResponse.ok || !vault || typeof vault.id !== "string") {
    throw new Error(
      "The production API could not create an encrypted OAuth vault record.",
    );
  }
  assertCleanShutdown(await stopProcess(child));
  child = startApi(port, temporaryRoot);
  await fetchEventually(`${baseUrl}/readyz`);
  const deletion = await fetch(`${baseUrl}/v1/oauth/vault/${vault.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${API_KEY}` },
    signal: AbortSignal.timeout(5_000),
  });
  const deleted = await deletion.json();
  if (
    !deletion.ok ||
    !deleted ||
    deleted.id !== vault.id ||
    deleted.deleted !== true
  ) {
    throw new Error(
      "The encrypted OAuth vault record did not survive an API restart.",
    );
  }
  console.log(
    `Production API smoke test passed (health ${health.status}, readiness ${readiness.status}, metrics ${metrics.status}, encrypted restart recovery, run ${randomUUID()}).`,
  );
} catch (error) {
  throw new Error(
    `Production API smoke test failed. Child output:\n${output}`,
    { cause: error },
  );
} finally {
  const shutdown = await stopProcess(child);
  await rm(temporaryRoot, { force: true, recursive: true });
  assertCleanShutdown(shutdown);
}
