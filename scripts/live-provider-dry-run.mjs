import { writeFile } from "node:fs/promises";

const requestSource = process.env.WATCHBRIDGE_LIVE_SYNC_REQUEST;
const apiKey = process.env.WATCHBRIDGE_LIVE_API_KEY;
const apiUrl = process.env.WATCHBRIDGE_LIVE_API_URL;
const evidencePath = process.env.WATCHBRIDGE_LIVE_EVIDENCE_PATH;
const evidenceCommit = process.env.WATCHBRIDGE_LIVE_EVIDENCE_COMMIT;

function requiredSecret(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `${name} must be configured as a non-empty protected secret.`,
    );
  }
  return value;
}

function safeLoopbackApiUrl(value) {
  let url;
  try {
    url = new URL(requiredSecret(value, "WATCHBRIDGE_LIVE_API_URL"));
  } catch {
    throw new Error(
      "WATCHBRIDGE_LIVE_API_URL must be a valid loopback HTTP URL.",
    );
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "WATCHBRIDGE_LIVE_API_URL must be a credential-free loopback HTTP origin.",
    );
  }
  return url;
}

function liveSyncRequest(value) {
  let parsed;
  try {
    parsed = JSON.parse(requiredSecret(value, "WATCHBRIDGE_LIVE_SYNC_REQUEST"));
  } catch {
    throw new Error("WATCHBRIDGE_LIVE_SYNC_REQUEST must contain valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("WATCHBRIDGE_LIVE_SYNC_REQUEST must be a JSON object.");
  }
  const request = parsed;
  if (
    typeof request.source !== "string" ||
    typeof request.target !== "string" ||
    !request.selection ||
    typeof request.selection !== "object" ||
    Array.isArray(request.selection) ||
    request.dryRun !== true ||
    request.confirmWrite === true
  ) {
    throw new Error(
      "The live-provider request must specify source, target, a selection, dryRun: true, and must not set confirmWrite: true.",
    );
  }
  return request;
}

async function writeEvidence(request, actionGroups) {
  if (evidencePath === undefined || evidencePath === "") return;
  if (typeof evidencePath !== "string" || evidencePath.includes("\0")) {
    throw new Error("WATCHBRIDGE_LIVE_EVIDENCE_PATH must be a valid file path.");
  }
  if (
    typeof evidenceCommit !== "string" ||
    !/^[0-9a-f]{40}$/i.test(evidenceCommit)
  ) {
    throw new Error(
      "WATCHBRIDGE_LIVE_EVIDENCE_COMMIT must be the current 40-character commit SHA.",
    );
  }
  const evidence = {
    schema: "watchbridge.live-provider-dry-run-evidence.v1",
    commit: evidenceCommit,
    generatedAt: new Date().toISOString(),
    source: request.source,
    target: request.target,
    dryRun: true,
    actionGroups,
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

const request = liveSyncRequest(requestSource);
const baseUrl = safeLoopbackApiUrl(apiUrl);
const response = await fetch(new URL("/v1/sync/execute", baseUrl), {
  method: "POST",
  headers: {
    Authorization: `Bearer ${requiredSecret(apiKey, "WATCHBRIDGE_LIVE_API_KEY")}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(120_000),
});

if (!response.ok) {
  throw new Error(
    `The live-provider dry run returned HTTP ${response.status}.`,
  );
}

let result;
try {
  result = await response.json();
} catch {
  throw new Error("The live-provider dry run did not return JSON.");
}
if (
  !result ||
  typeof result !== "object" ||
  !result.job ||
  typeof result.job !== "object" ||
  result.job.dryRun !== true ||
  !Array.isArray(result.actions) ||
  !result.actions.every(
    (action) =>
      action &&
      typeof action === "object" &&
      ["previewed", "skipped"].includes(action.status),
  )
) {
  throw new Error(
    "The live-provider endpoint did not prove a successful, non-mutating dry run.",
  );
}

await writeEvidence(request, result.actions.length);

console.log(
  `Live-provider dry run completed safely for ${request.source} -> ${request.target} with ${result.actions.length} previewed or skipped action groups.`,
);
