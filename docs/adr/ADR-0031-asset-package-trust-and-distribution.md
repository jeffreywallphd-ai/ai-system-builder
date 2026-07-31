# ADR-0031: Asset Package Trust and Distribution

- Status: accepted
- Date: 2026-07-17
- Deciders: ai-system-builder maintainers
- Related: ADR-0015, ADR-0016, ADR-0017, ADR-0018, ADR-0029, ADR-0030, `docs/architecture/asset-implementations-and-packages.md`

## Context

Installing an asset package may introduce executable code, dependencies, migrations, and permission requests. Browsing or inspecting a package must not execute it. Package identities, trust, ownership, activation, and rollback must also work across local, organization-managed, and cloud shapes without turning a public marketplace into an implied feature.

OCI 1.1 supplies a useful content-addressed manifest/artifact/referrer vocabulary, SLSA supplies provenance semantics, and Sigstore supplies interoperable signature bundles. These standards do not prove that code is safe, so admission still needs product policy, inspection, scanning, review, and constrained execution.

## Decision

- Use a versioned AI System Builder package manifest whose artifacts are content-addressed and OCI-compatible in identity and descriptor semantics. Local `.aisb-package` archives are the initial transport; an organization-approved OCI registry adapter may be added without changing application use cases.
- Inspection is a pure, bounded operation: parse, normalize, inventory, verify digests/signatures/provenance, evaluate compatibility and requested capabilities, and report conflicts. It performs no scripts, dependency installation, activation, migration, or code import.
- Imported packages enter quarantine. Admission requires manifest/schema validity, digest verification, supported format/runtime, dependency policy, capability review, trust-policy evaluation, and an explicit authorized approval.
- Signatures use pluggable verifiers. Sigstore bundle verification is the preferred managed adapter; local development may use explicitly configured local trust roots. Unsigned packages are never silently trusted.
- SLSA-compatible provenance, an SBOM, dependency inventory, build evidence, and signer identity are associated by digest. Provenance is evidence, not a safety guarantee.
- Installation stores immutable package content and safe records. Activation is separate, workspace/organization scoped, reversible, and references exact versions. Same-ID content is never overwritten.
- Updates require a fresh inspection/admission decision. Automatic updates, public discovery, ratings, billing, and marketplace publisher governance are out of scope.
- Downgrades, revoked signers/releases, duplicate identities, traversal, links, device paths, oversized entries, archive expansion limits, unsupported compression, and content/digest mismatches fail closed.
- Removal cannot delete content referenced by active bindings, system releases, or audit retention. Disablement and rollback are preferred to destructive deletion.

## Consequences

### Positive

- Browse/import remains non-executing and auditable.
- Local files and approved internal registries share one package model.
- Integrity, provenance, activation, rollback, and revocation are explicit.

### Negative

- A valid signature does not remove the need for scanning and review.
- Registry and transparency-log availability can affect managed verification.
- Archive and dependency policy add operational complexity.

### Follow-up

- Implement local-file inspection and organization-approved sources first.
- Keep public marketplace behavior decision-required.
