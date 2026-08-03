const repository = process.env.GITHUB_REPOSITORY ?? process.argv[2];
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const expectedEnvironments = ["production-release", "live-provider-smoke"];
const platformNames = ["ubuntu-latest", "windows-latest", "macos-latest"];

if (!repository || !/^[^/]+\/[^/]+$/.test(repository) || !token) {
  console.error(
    "Usage: GITHUB_TOKEN=<read-token> node scripts/check-github-governance.mjs [owner/repository]",
  );
  process.exitCode = 2;
} else {
  const failures = [];
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  async function get(path) {
    const response = await fetch(`https://api.github.com${path}`, { headers });
    if (!response.ok)
      throw new Error(`GitHub API ${response.status} for ${path}`);
    return response.json();
  }

  try {
    const repo = await get(`/repos/${repository}`);
    const branch = repo.default_branch;
    const protection = await get(
      `/repos/${repository}/branches/${encodeURIComponent(branch)}/protection`,
    );
    const checks = [
      ...(protection.required_status_checks?.contexts ?? []),
      ...(protection.required_status_checks?.checks ?? []).map(
        (check) => check.context,
      ),
    ];
    for (const required of [
      "validate",
      "container-smoke",
      "Analyze JavaScript and TypeScript",
    ]) {
      if (!checks.includes(required))
        failures.push(
          `protected ${branch} is missing required status check ${required}`,
        );
    }
    for (const platform of platformNames) {
      if (
        !checks.some(
          (check) =>
            /source[- ]compatibility/i.test(check) && check.includes(platform),
        )
      ) {
        failures.push(
          `protected ${branch} is missing the source compatibility check for ${platform}`,
        );
      }
    }
    if (protection.required_status_checks?.strict !== true)
      failures.push(
        `protected ${branch} must require branches to be up to date before merging`,
      );
    if (
      protection.required_pull_request_reviews
        ?.required_approving_review_count < 1
    )
      failures.push(
        `protected ${branch} must require at least one approving review`,
      );
    if (
      protection.required_pull_request_reviews?.require_last_push_approval !==
      true
    )
      failures.push(
        `protected ${branch} must require approval after the last push`,
      );
    if (protection.enforce_admins?.enabled !== true)
      failures.push(
        `protected ${branch} must enforce rules for administrators`,
      );
    if (protection.required_conversation_resolution?.enabled !== true)
      failures.push(`protected ${branch} must require conversation resolution`);
    if (protection.allow_force_pushes?.enabled !== false)
      failures.push(`protected ${branch} must disallow force pushes`);
    if (protection.allow_deletions?.enabled !== false)
      failures.push(`protected ${branch} must disallow branch deletion`);
    if (protection.required_linear_history?.enabled !== true)
      failures.push(`protected ${branch} must require a linear history`);

    const environments = await get(`/repos/${repository}/environments`);
    const ownerLogin = repo.owner?.login;
    for (const name of expectedEnvironments) {
      const environment = (environments.environments ?? []).find(
        (candidate) => candidate.name === name,
      );
      if (!environment) {
        failures.push(`required deployment environment ${name} is missing`);
        continue;
      }
      if (environment.can_admins_bypass !== false)
        failures.push(`${name} must disallow administrator bypass`);
      if (
        environment.deployment_branch_policy?.protected_branches !== true ||
        environment.deployment_branch_policy?.custom_branch_policies === true
      ) {
        failures.push(`${name} must deploy only from protected branches`);
      }
      const rules = environment.protection_rules ?? [];
      const reviewerRule = rules.find(
        (rule) => rule.type === "required_reviewers",
      );
      if (!reviewerRule) {
        failures.push(`${name} must require an approving reviewer`);
      } else {
        if (reviewerRule.prevent_self_review !== true)
          failures.push(`${name} must prevent self-review`);
        const reviewers = (reviewerRule.reviewers ?? [])
          .map((entry) => ({
            type: entry.type,
            login: entry.reviewer?.login,
            slug: entry.reviewer?.slug,
            name: entry.reviewer?.name,
          }))
          .filter(
            (reviewer) => reviewer.login || reviewer.slug || reviewer.name,
          );
        if (reviewers.length === 0)
          failures.push(`${name} must name at least one reviewer`);
        const onlyOwner =
          reviewers.length > 0 &&
          reviewers.every(
            (reviewer) =>
              reviewer.type === "User" && reviewer.login === ownerLogin,
          );
        if (ownerLogin && onlyOwner) {
          failures.push(
            `${name} must include an independent reviewer, not only repository owner ${ownerLogin}`,
          );
        }
      }
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  if (failures.length) {
    console.error(
      [
        "GitHub governance check failed:",
        ...failures.map((failure) => `- ${failure}`),
      ].join("\n"),
    );
    process.exitCode = 1;
  } else {
    console.log(
      `GitHub governance check passed for protected ${repository}'s default branch and deployment environments.`,
    );
  }
}
