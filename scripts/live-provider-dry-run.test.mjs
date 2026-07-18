import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function runRunner(environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["scripts/live-provider-dry-run.mjs"],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...environment },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not start the loopback test server."));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("live-provider runner submits only a dry-run to a loopback API without logging its request", async () => {
  const providerToken = "live-provider-token-that-must-not-be-logged";
  const apiKey = "loopback-api-key";
  const evidencePath = join(
    await mkdtemp(join(tmpdir(), "watchbridge-live-evidence-")),
    "evidence.json",
  );
  let received;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received = {
      authorization: request.headers.authorization,
      body,
      url: request.url,
    };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        job: { dryRun: true },
        actions: [{ status: "previewed" }],
      }),
    );
  });
  const port = await listen(server);
  try {
    const result = await runRunner({
      WATCHBRIDGE_LIVE_API_URL: `http://127.0.0.1:${port}`,
      WATCHBRIDGE_LIVE_API_KEY: apiKey,
      WATCHBRIDGE_LIVE_EVIDENCE_PATH: evidencePath,
      WATCHBRIDGE_LIVE_EVIDENCE_COMMIT: "a".repeat(40),
      WATCHBRIDGE_LIVE_SYNC_REQUEST: JSON.stringify({
        source: "trakt",
        target: "tmdb",
        selection: { ratings: true },
        dryRun: true,
        sourceContext: { accessToken: providerToken },
        targetContext: { accessToken: providerToken },
      }),
    });
    assert.deepEqual(
      { code: result.code, signal: result.signal },
      { code: 0, signal: null },
    );
    assert.equal(received.url, "/v1/sync/execute");
    assert.equal(received.authorization, `Bearer ${apiKey}`);
    assert.equal(JSON.parse(received.body).dryRun, true);
    assert.match(result.stdout, /Live-provider dry run completed safely/);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      new RegExp(providerToken),
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    assert.deepEqual(evidence, {
      schema: "watchbridge.live-provider-dry-run-evidence.v1",
      commit: "a".repeat(40),
      generatedAt: evidence.generatedAt,
      source: "trakt",
      target: "tmdb",
      dryRun: true,
      actionGroups: 1,
    });
    assert.doesNotMatch(JSON.stringify(evidence), new RegExp(providerToken));
  } finally {
    await close(server);
  }
});

test("live-provider runner fails before network access when dryRun is not explicitly true", async () => {
  const providerToken = "live-provider-token-that-must-not-be-logged";
  const result = await runRunner({
    WATCHBRIDGE_LIVE_API_URL: "http://127.0.0.1:1",
    WATCHBRIDGE_LIVE_API_KEY: "loopback-api-key",
    WATCHBRIDGE_LIVE_SYNC_REQUEST: JSON.stringify({
      source: "trakt",
      target: "tmdb",
      selection: { ratings: true },
      dryRun: false,
      sourceContext: { accessToken: providerToken },
    }),
  });
  assert.notEqual(result.code, 0);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /must specify source, target, a selection, dryRun: true/,
  );
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    new RegExp(providerToken),
  );
});
