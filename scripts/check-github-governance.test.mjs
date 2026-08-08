import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const governanceScript = pathToFileURL(
  resolve("scripts/check-github-governance.mjs"),
).href;

const environments = {
  environments: ["production-release", "live-provider-smoke"].map((name) => ({
    name,
    can_admins_bypass: false,
    protection_rules: [
      {
        type: "required_reviewers",
        prevent_self_review: true,
        reviewers: [
          { type: "User", reviewer: { login: "independent-reviewer" } },
        ],
      },
    ],
    deployment_branch_policy: {
      protected_branches: true,
      custom_branch_policies: false,
    },
  })),
};

const weakEnvironments = {
  environments: environments.environments.map((environment) => ({
    ...environment,
    can_admins_bypass: true,
    protection_rules: [
      {
        type: "required_reviewers",
        prevent_self_review: false,
        reviewers: [{ type: "User", reviewer: { login: "owner" } }],
      },
    ],
  })),
};

function protection(overrides = {}) {
  return {
    required_status_checks: {
      strict: true,
      contexts: [
        "validate",
        "container-smoke",
        "Analyze JavaScript and TypeScript",
        "Source compatibility (ubuntu-latest)",
        "Source compatibility (windows-latest)",
        "Source compatibility (macos-latest)",
      ],
      checks: [],
    },
    required_pull_request_reviews: {
      required_approving_review_count: 1,
      require_last_push_approval: true,
    },
    enforce_admins: { enabled: true },
    required_conversation_resolution: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
    required_linear_history: { enabled: true },
    ...overrides,
  };
}

function runAudit(branchProtection, environmentPayload = environments) {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        const responses = new Map([
          ["/repos/owner/repo", ${JSON.stringify({ default_branch: "main", owner: { login: "owner" } })}],
          ["/repos/owner/repo/branches/main/protection", ${JSON.stringify(branchProtection)}],
          ["/repos/owner/repo/environments", ${JSON.stringify(environmentPayload)}],
        ]);
        globalThis.fetch = async (url) => new Response(JSON.stringify(responses.get(new URL(url).pathname)), { status: 200, headers: { "content-type": "application/json" } });
        process.env.GITHUB_TOKEN = "test-token";
        process.argv = ["node", "check-github-governance.mjs", "owner/repo"];
        await import(${JSON.stringify(governanceScript)});
      `,
    ],
    { encoding: "utf8" },
  );
  return child;
}

test("governance audit rejects a missing pull-request review policy", () => {
  const result = runAudit(protection({ required_pull_request_reviews: undefined }));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /protected main must require at least one approving review/,
  );
  assert.match(
    result.stderr,
    /protected main must require approval after the last push/,
  );
});

test("governance audit accepts complete branch and environment controls", () => {
  const result = runAudit(protection());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GitHub governance check passed/);
});

test("governance audit rejects incomplete source checks and weak environments", () => {
  const result = runAudit(
    protection({
      required_status_checks: {
        strict: true,
        contexts: [
          "validate",
          "container-smoke",
          "Analyze JavaScript and TypeScript",
        ],
        checks: [],
      },
    }),
    weakEnvironments,
  );
  assert.equal(result.status, 1);
  for (const platform of ["ubuntu-latest", "windows-latest", "macos-latest"])
    assert.match(
      result.stderr,
      new RegExp(`missing the source compatibility check for ${platform}`),
    );
  for (const environment of ["production-release", "live-provider-smoke"]) {
    assert.match(
      result.stderr,
      new RegExp(`${environment} must disallow administrator bypass`),
    );
    assert.match(
      result.stderr,
      new RegExp(`${environment} must prevent self-review`),
    );
    assert.match(
      result.stderr,
      new RegExp(`${environment} must include an independent reviewer`),
    );
  }
});
