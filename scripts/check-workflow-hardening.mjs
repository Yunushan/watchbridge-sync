import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const WORKFLOW_DIRECTORY = ".github/workflows";
const SHA = /^[0-9a-f]{40}$/i;
const DOCKER_DIGEST = /@sha256:[0-9a-f]{64}$/i;

async function workflowFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await workflowFiles(path)));
    else if (/\.ya?ml$/i.test(entry.name)) files.push(path);
  }
  return files;
}

const failures = [];
const workflowSources = new Map();
for (const file of await workflowFiles(WORKFLOW_DIRECTORY)) {
  const source = await readFile(file, "utf8");
  workflowSources.set(file.replaceAll("\\", "/"), source);
  const lines = source.split(/\r?\n/);
  if (!/^permissions:\s*\n\s{2,}contents:\s*read\s*$/m.test(source)) {
    failures.push(
      `${file}: workflows must declare least-privilege top-level contents: read permissions.`,
    );
  }
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*-\s*uses:\s*([^\s#]+)/.exec(lines[index]);
    if (!match || match[1].startsWith("./")) continue;
    const [repository, ref] = match[1].split("@");
    if (!repository || !ref || !SHA.test(ref)) {
      failures.push(
        `${file}:${index + 1}: action references must use a 40-character immutable commit SHA.`,
      );
      continue;
    }
    if (repository === "actions/checkout") {
      const hasCredentialOptOut =
        lines[index + 1]?.trim() === "with:" &&
        /^persist-credentials:\s*false\s*(?:#.*)?$/.test(
          lines[index + 2]?.trim() ?? "",
        );
      if (!hasCredentialOptOut) {
        failures.push(
          `${file}:${index + 1}: actions/checkout must set persist-credentials: false.`,
        );
      }
    }
  }
}

const ciWorkflow = workflowSources.get(".github/workflows/ci.yml") ?? "";
if (
  !/docker compose -f docker-compose\.production\.yml up --build --detach/.test(
    ciWorkflow,
  ) ||
  !/docker compose -f docker-compose\.production\.yml restart api/.test(
    ciWorkflow,
  ) ||
  !/Verify encrypted volume recovery after full stack loss/.test(ciWorkflow) ||
  !/docker volume create "\$RECOVERY_VOLUME"/.test(ciWorkflow) ||
  !/docker compose -f docker-compose\.production\.yml down --volumes --remove-orphans/.test(
    ciWorkflow,
  ) ||
  !/docker compose -f docker-compose\.production\.yml up --no-build --detach/.test(
    ciWorkflow,
  ) ||
  !/ci-volume-recovery-token/.test(ciWorkflow) ||
  !/Verify the shipped TLS edge profile/.test(ciWorkflow) ||
  !/docker-compose\.tls\.yml/.test(ciWorkflow) ||
  !/openssl req -x509 -newkey rsa:2048/.test(ciWorkflow) ||
  !/Strict-Transport-Security: max-age=31536000/.test(ciWorkflow) ||
  !/https:\/\/127\.0\.0\.1:18443/.test(ciWorkflow) ||
  !/watchbridge-tls-body\.bin/.test(ciWorkflow) ||
  !/body_status/.test(ciWorkflow) ||
  !/http:\/\/127\.0\.0\.1:18081/.test(ciWorkflow) ||
  !/watchbridge\.production-recovery-evidence\.v1/.test(ciWorkflow) ||
  !/encryptedVolumeRecovery: "passed"/.test(ciWorkflow) ||
  !/verify-production-recovery-evidence\.mjs evidence\/production-recovery-evidence\.json/.test(
    ciWorkflow,
  ) ||
  !/actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/.test(
    ciWorkflow,
  ) ||
  !/retention-days: 30/.test(ciWorkflow) ||
  !/\/v1\/oauth\/vault/.test(ciWorkflow) ||
  !/\/v1\/metrics/.test(ciWorkflow) ||
  !/\.well-known\/security\.txt/.test(ciWorkflow) ||
  !/HostConfig\.ReadonlyRootfs/.test(ciWorkflow) ||
  !/HostConfig\.Memory/.test(ciWorkflow) ||
  !/HostConfig\.MemorySwap/.test(ciWorkflow) ||
  !/HostConfig\.NanoCpus/.test(ciWorkflow) ||
  !/HostConfig\.PidsLimit/.test(ciWorkflow) ||
  !/State\.Health\.Status/.test(ciWorkflow) ||
  !/web_id/.test(ciWorkflow) ||
  !/= "nginx"/.test(ciWorkflow) ||
  !/Content-Security-Policy/.test(ciWorkflow) ||
  !/X-Request-ID/.test(ciWorkflow) ||
  !/development dependency present/.test(ciWorkflow) ||
  !/watchbridge_api_requests_limit/.test(ciWorkflow) ||
  !/watchbridge_sync_executions_limit/.test(ciWorkflow) ||
  !/aquasecurity\/trivy-action@[0-9a-f]{40}/i.test(ciWorkflow) ||
  !/watchbridge-api:ci/.test(ciWorkflow) ||
  !/watchbridge-web:ci/.test(ciWorkflow) ||
  !/pnpm smoke:production-api/.test(ciWorkflow)
) {
  failures.push(
    ".github/workflows/ci.yml: the production smoke test must prove encrypted restart and full-volume recovery, retain machine-readable recovery evidence, validate authenticated metrics, runtime container hardening, proxy security controls, production-only dependencies, the sync execution budget, and fixable high/critical image vulnerability scanning.",
  );
}
if (
  !/Cache-Control: no-store/.test(ciWorkflow) ||
  !/Cache-Control: public, max-age=31536000, immutable/.test(ciWorkflow) ||
  !/asset_path/.test(ciWorkflow)
) {
  failures.push(
    ".github/workflows/ci.yml: the production smoke test must verify fresh application-shell and immutable hashed-asset caching behavior.",
  );
}

const releaseWorkflow =
  workflowSources.get(".github/workflows/release.yml") ?? "";
if (
  !/actions\/attest-build-provenance@[0-9a-f]{40}/i.test(releaseWorkflow) ||
  !/anchore\/sbom-action@[0-9a-f]{40}/i.test(releaseWorkflow) ||
  !/actions\/attest@[0-9a-f]{40}/i.test(releaseWorkflow) ||
  !/sbom-path:\s*release\/watchbridge-sync-\$\{\{ github\.ref_name \}\}-sbom\.cdx\.json/.test(
    releaseWorkflow,
  ) ||
  !/gh release create/.test(releaseWorkflow) ||
  !/attestations:\s*write/.test(releaseWorkflow) ||
  !/id-token:\s*write/.test(releaseWorkflow) ||
  !/Gate release on the shipped production containers/.test(releaseWorkflow) ||
  !/docker compose -f docker-compose\.production\.yml up --build --detach/.test(
    releaseWorkflow,
  ) ||
  !/trap cleanup EXIT/.test(releaseWorkflow) ||
  !/healthy=0/.test(releaseWorkflow) ||
  !/for attempt in \{1\.\.15\}; do/.test(releaseWorkflow) ||
  !/HostConfig\.ReadonlyRootfs/.test(releaseWorkflow) ||
  !/Content-Security-Policy/.test(releaseWorkflow) ||
  !/watchbridge_api_requests_limit 16/.test(releaseWorkflow) ||
  !/release-recovery-token/.test(releaseWorkflow) ||
  !/docker compose -f docker-compose\.production\.yml restart api/.test(
    releaseWorkflow,
  ) ||
  !/Gate release on the public TLS edge/.test(releaseWorkflow) ||
  !/docker-compose\.tls\.yml/.test(releaseWorkflow) ||
  !/watchbridge-release-tls-cert\.pem/.test(releaseWorkflow) ||
  !/Strict-Transport-Security: max-age=31536000/.test(releaseWorkflow) ||
  !/https:\/\/127\.0\.0\.1:18443/.test(releaseWorkflow) ||
  !/watchbridge-release-tls-body\.bin/.test(releaseWorkflow) ||
  !/body_status/.test(releaseWorkflow)
) {
  failures.push(
    ".github/workflows/release.yml: releases must gate publication on shipped HTTP and TLS Compose paths plus encrypted restart recovery, then publish provenance and CycloneDX SBOM attestations with OIDC identity.",
  );
}

const liveProviderWorkflow =
  workflowSources.get(".github/workflows/live-provider-dry-run.yml") ?? "";
if (
  !/workflow_dispatch:/.test(liveProviderWorkflow) ||
  !/environment:\s*live-provider-smoke/.test(liveProviderWorkflow) ||
  !/WATCHBRIDGE_LIVE_SYNC_REQUEST:\s*\$\{\{ secrets\.WATCHBRIDGE_LIVE_SYNC_REQUEST \}\}/.test(
    liveProviderWorkflow,
  ) ||
  !/node scripts\/live-provider-dry-run\.mjs/.test(liveProviderWorkflow) ||
  !/WATCHBRIDGE_LIVE_EVIDENCE_PATH/.test(liveProviderWorkflow) ||
  !/WATCHBRIDGE_LIVE_EVIDENCE_COMMIT/.test(liveProviderWorkflow) ||
  !/test -s "\$WATCHBRIDGE_LIVE_EVIDENCE_PATH"/.test(liveProviderWorkflow) ||
  !/actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/.test(
    liveProviderWorkflow,
  ) ||
  !/retention-days: 30/.test(liveProviderWorkflow) ||
  !/pnpm install --frozen-lockfile/.test(liveProviderWorkflow) ||
  !/pnpm build/.test(liveProviderWorkflow)
) {
  failures.push(
    ".github/workflows/live-provider-dry-run.yml: the manual provider drill must be environment-protected, use a secret request, build locked source, invoke the non-mutating runner, and retain only non-secret evidence.",
  );
}

const codeqlWorkflow =
  workflowSources.get(".github/workflows/codeql.yml") ?? "";
if (
  !/schedule:/.test(codeqlWorkflow) ||
  !/workflow_dispatch:/.test(codeqlWorkflow) ||
  !/security-events:\s*write/.test(codeqlWorkflow) ||
  !/github\/codeql-action\/init@[0-9a-f]{40}/i.test(codeqlWorkflow) ||
  !/github\/codeql-action\/analyze@[0-9a-f]{40}/i.test(codeqlWorkflow) ||
  !/languages:\s*javascript-typescript/.test(codeqlWorkflow) ||
  !/queries:\s*security-extended/.test(codeqlWorkflow)
) {
  failures.push(
    ".github/workflows/codeql.yml: static analysis must run on changes and a schedule, use immutable CodeQL action SHAs, request only security-events write, and analyze JavaScript/TypeScript with security-extended queries.",
  );
}

const dockerfile = await readFile("Dockerfile", "utf8");
const dockerStages = new Set();
for (const [index, line] of dockerfile.split(/\r?\n/).entries()) {
  const match = /^FROM\s+([^\s]+)(?:\s+AS\s+([^\s]+))?/i.exec(line);
  if (!match) continue;
  const [, image, stageName] = match;
  if (!dockerStages.has(image) && !DOCKER_DIGEST.test(image)) {
    failures.push(
      `Dockerfile:${index + 1}: production base images must use an immutable sha256 digest.`,
    );
  }
  if (stageName) dockerStages.add(stageName);
}
if (
  !/pnpm --filter @watchbridge\/api --prod deploy \/runtime/.test(dockerfile) ||
  /COPY --from=build --chown=watchbridge:watchbridge \/workspace\/node_modules/.test(
    dockerfile,
  ) ||
  !/CMD \["node", "dist\/server\.js"\]/.test(dockerfile)
) {
  failures.push(
    "Dockerfile: the API runtime must be assembled with pnpm deploy --prod and start the deployed package directly.",
  );
}
if (
  !/mount=type=secret,id=watchbridge_registry_ca,required=false/.test(
    dockerfile,
  ) ||
  !/apt-get install --no-install-recommends -y ca-certificates/.test(
    dockerfile,
  ) ||
  !/NODE_OPTIONS=--use-system-ca/.test(dockerfile) ||
  /NODE_TLS_REJECT_UNAUTHORIZED=0/.test(dockerfile) ||
  /strict-ssl=false/.test(dockerfile)
) {
  failures.push(
    "Dockerfile: the Node build and runtime must use a standard CA bundle, support only an optional BuildKit CA secret for intercepted registries, and never disable TLS verification.",
  );
}
if (
  !/FROM nginx:[^\n]+ AS web[\s\S]*USER nginx[\s\S]*ENTRYPOINT \["nginx", "-g", "daemon off;"\]/.test(
    dockerfile,
  )
) {
  failures.push(
    "Dockerfile: the web runtime must execute Nginx as its unprivileged nginx user.",
  );
}
if (
  (dockerfile.match(/HEALTHCHECK /g) ?? []).length !== 3 ||
  !/wget -q -O \/dev\/null http:\/\/127\.0\.0\.1:8080\/ \|\| exit 1/.test(
    dockerfile,
  ) ||
  !/FROM nginx:[^\n]+ AS edge[\s\S]*USER nginx[\s\S]*edge-healthz/.test(
    dockerfile,
  )
) {
  failures.push(
    "Dockerfile: API, web, and optional TLS edge targets must define bounded health checks and run unprivileged.",
  );
}

if (failures.length) {
  console.error(
    [
      "Supply-chain hardening check failed:",
      ...failures.map((failure) => `- ${failure}`),
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log("Supply-chain hardening check passed.");
}
