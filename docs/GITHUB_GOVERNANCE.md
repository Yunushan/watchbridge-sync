# GitHub governance gate

This repository's CI can prove the application and release controls, but GitHub repository settings are external state. Complete and retain this gate before calling a release fully production-ready.

## Protected default branch

Protect `main` and require all of the following checks from the same commit:

- `validate`
- `container-smoke`
- `Analyze JavaScript and TypeScript`
- `Source compatibility (ubuntu-latest)`
- `Source compatibility (windows-latest)`
- `Source compatibility (macos-latest)`

Also require branches to be up to date, at least one approving review, approval after the last push, conversation resolution, administrator enforcement, and linear history. Keep force-pushes and branch deletion disabled.

## Protected deployment environments

Configure both `production-release` and `live-provider-smoke` with:

- at least one required reviewer who is independent of the repository owner;
- self-review prevention enabled;
- administrator bypass disabled; and
- deployment restricted to protected branches.

Do not use the repository owner as the only reviewer. A team reviewer is acceptable when the team has an independent member with write access.

## Verification

Run the read-only audit after every settings change and retain its output with the release record:

```bash
GITHUB_TOKEN=<read-only-token> node scripts/check-github-governance.mjs Yunushan/watchbridge-sync
```

The token is read from the environment and is never printed. A passing audit is necessary but not sufficient: the candidate must still be published, pass the protected GitHub workflows, produce a signed tagged release, and complete the off-host restore, provider reconciliation/rollback, and SLO evidence steps in [Production readiness](PRODUCTION_READINESS.md).
