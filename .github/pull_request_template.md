## Production change checklist

- [ ] The change has a focused scope and no unrelated generated files.
- [ ] `pnpm lint`, `pnpm test`, and `pnpm build` pass with the locked toolchain.
- [ ] Source compatibility checks pass on Ubuntu, Windows, and macOS when the change affects runtime or tooling portability.
- [ ] Production container smoke, recovery, and security checks pass when applicable.
- [ ] Storage/recovery changes include encrypted snapshot verification and a non-secret manifest when applicable.
- [ ] Runtime capacity or limit changes include the production capacity smoke result and updated SLO notes when applicable.
- [ ] Workspace code changes preserve the pinned V8 coverage provider, thresholds, and retained coverage summaries.
- [ ] Security-sensitive changes include regression coverage and CodeQL review.
- [ ] Connector or provider changes document capability and fidelity limits.
- [ ] Release, migration, backup, rollback, and operator-impact notes are included when applicable.
- [ ] No credentials, tokens, personal data, or provider secrets are present in the diff.

## Verification evidence

List the CI run, test command, recovery drill, or manual evidence that supports this change.
