# Release verification

Official releases are created only from a pushed `v*` tag by the **release** GitHub Actions workflow. The workflow installs the locked dependency graph, runs the production dependency audit and full check suite, then builds the shipped Compose API and web images and waits for both containers to become healthy before gating publication on live readiness, non-root/read-only container settings, authenticated metrics, proxy security headers, and encrypted vault recovery across an API restart. It separately creates a temporary certificate to gate the shipped TLS edge on HTTPS proxying, HSTS, security headers, and HTTP-to-HTTPS redirection. It creates a deterministic source archive, publishes its SHA-256 checksum and CycloneDX SBOM, then creates GitHub build-provenance and SBOM attestations using GitHub's OIDC identity.

Before using an archive, verify both its checksum and provenance:

```bash
sha256sum --check watchbridge-sync-vX.Y.Z-source.tar.gz.sha256
gh attestation verify watchbridge-sync-vX.Y.Z-source.tar.gz --repo Yunushan/watchbridge-sync
gh attestation verify watchbridge-sync-vX.Y.Z-source.tar.gz --repo Yunushan/watchbridge-sync --predicate-type https://cyclonedx.org/bom
```

The provenance check must identify the `release.yml` workflow in this repository and the expected release tag commit; the CycloneDX predicate check must succeed against the attached `*-sbom.cdx.json` asset. Do not treat a matching filename, GitHub release page, or checksum copied from an untrusted channel as sufficient evidence.

The release archive is source plus the committed deployment definition. Build the pinned container images locally or through the tagged workflow; registry image tags are not a substitute for verifying the source-release provenance.
