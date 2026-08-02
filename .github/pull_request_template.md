## Production change checklist

- [ ] The change has a focused scope and no unrelated generated files.
- [ ] `pnpm lint`, `pnpm test`, and `pnpm build` pass with the locked toolchain.
- [ ] Production container smoke, recovery, and security checks pass when applicable.
- [ ] Security-sensitive changes include regression coverage and CodeQL review.
- [ ] Connector or provider changes document capability and fidelity limits.
- [ ] Release, migration, backup, rollback, and operator-impact notes are included when applicable.
- [ ] No credentials, tokens, personal data, or provider secrets are present in the diff.

## Verification evidence

List the CI run, test command, recovery drill, or manual evidence that supports this change.
