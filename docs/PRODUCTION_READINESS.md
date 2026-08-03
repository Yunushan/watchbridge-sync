# Production readiness gate

This repository treats production readiness as two separate claims:

- **Repository controls** are reproducible in CI: locked dependencies, immutable action and image references, source lint/test/build checks, CodeQL and vulnerability scanning, hardened containers, capacity smoke, encrypted restart/volume recovery, TLS edge checks, and non-secret evidence artifacts.
- **Deployment evidence** must be produced by the operator: an approved release tag, an independent reviewer, off-host restore, a disposable-account provider write/reconciliation drill, and a measured service-level baseline.

The first claim is testable from the repository. The second cannot be honestly inferred from a green build or a dry-run provider check.

The test inventory, numeric V8 coverage thresholds, and operational evidence gates are enforced today. Each shipped workspace pins `@vitest/coverage-v8`, runs `test:coverage`, and retains its JSON summary in CI; thresholds are intentionally workspace-specific and must be raised when coverage improves rather than bypassed.

The current local candidate scores **100/100 for automatable repository controls**: the full `pnpm check` command, all workspace coverage thresholds, the API smoke, and the authenticated capacity smoke pass on this worktree. This score is not a deployment sign-off; the remote `main` branch and external release evidence remain separate claims until this candidate is published and exercised by GitHub and the target environment.

## Required evidence for a 100/100 release decision

1. Merge through protected `main` with `validate`, `container-smoke`, CodeQL, and all three `source-compatibility` checks required by branch protection.
2. Create a `v*` tag matching every package version and wait for the protected `production-release` workflow to retain the capacity evidence and publish the checksum, SBOM, and both attestations.
3. Verify the release archive with `sha256sum --check` and `gh attestation verify`, recording the tag commit and workflow URL.
4. Restore an off-host copy into a separate failure domain and run `scripts/verify-storage-snapshot.mjs` with the storage key supplied only through the environment. Retain its checksum manifest without retaining decrypted data or keys.
5. Complete the `live-provider-dry-run` workflow for an approved disposable account pair, then perform a separately approved real write/reconciliation/rollback drill. The dry-run alone is intentionally not evidence of mutation recovery.
6. Have a reviewer who is not the last pusher approve the release and configure the deployment environment so owner self-approval/admin bypass is not the normal path.
7. Measure availability, p95 latency, error rate, recovery time, and provider reconciliation results on the intended host. Compare the results with the objectives in `docs/OPERATIONS_RUNBOOK.md`.

Run the repository's read-only governance audit with `GITHUB_TOKEN=<read-token> node scripts/check-github-governance.mjs owner/repository` before calling the release fully protected. It verifies required status checks, administrator enforcement, last-push approval, independent environment reviewers, protected deployment branches, self-review prevention, and administrator-bypass settings without printing the token. The exact GitHub settings checklist is in [GitHub governance](GITHUB_GOVERNANCE.md).

Until all seven items have evidence, report the repository as hardened and deployment-ready for controlled rollout, not as fully production-proven.
