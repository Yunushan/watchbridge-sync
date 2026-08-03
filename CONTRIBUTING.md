# Contributing

Connector contributions are welcome when they are legal-safe and user-authorized.

Before adding a connector:

1. Link official API/export/import documentation.
2. Add capabilities to `packages/core/src/capabilities.ts`.
3. Add tests for rating/status conversions.
4. Implement dry-run.
5. Implement backup before write.
6. Document limitations.

Do not contribute scraping or ToS-bypass automation.

Workflow changes must use immutable 40-character GitHub Action commit pins, keep top-level permissions at `contents: read`, and set `persist-credentials: false` for `actions/checkout`. The CI workflow must retain its encrypted-storage recovery smoke test, snapshot verification, source compatibility matrix, coverage summaries, and capacity evidence; the release workflow must retain GitHub provenance attestation and release coverage/capacity artifacts. Run `pnpm check:workflow`, `pnpm check:release-metadata`, `pnpm check:test-inventory`, `pnpm check:monitoring`, `pnpm check:coverage`, and `pnpm check:package-contents` before opening a pull request. Owners should also run `GITHUB_TOKEN=<read-token> pnpm check:governance` before a release decision.
