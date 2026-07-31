# ADR-0035: Layered Derived Asset Customization

- Status: accepted
- Date: 2026-07-18
- Related: ADR-0018, ADR-0019, ADR-0030, ADR-0031, ADR-0032

## Context

The existing asset-authoring boundary supports conservative safe-field overrides,
while Asset Studio supports bounded source proposals, immutable source snapshots,
and human review. The Assets experience now needs one guided workflow that can
customize both an asset definition and its related implementation without mutating
the built-in, imported, linked, or authored source.

Copying every unchanged field and source file into a mutable draft would obscure
lineage and duplicate logical content. Storing source text in Asset Kernel or
general authoring metadata would violate the established trust boundary. Treating
definition changes and implementation changes as unrelated workflows would not
provide a coherent customization review.

## Decision

Adopt a workspace-owned **layered derived customization** pinned to an exact base:

1. The semantic base is an exact `asset-definition-version` reference.
2. The implementation base is an exact implementation release plus its immutable
   source snapshot and source artifact digest.
3. The mutable customization record contains only an allowlisted sparse semantic
   patch and, when source changes exist, a descriptor for a bounded changed-file
   overlay. Raw source paths and text are accepted only inside an authorized Asset
   Studio authoring command or proposal and are persisted as verified immutable
   artifacts, never as Asset Kernel metadata, list/readiness DTOs, logs, or safe
   diagnostics.
4. Unchanged semantic fields and source files remain logically referenced through
   the exact base identities. This decision does not require or claim physical blob
   deduplication by a storage adapter.
5. Review materialization revalidates the base, overlay, dependencies,
   capabilities, sizes, paths, content, digests, and optimistic revision before it
   produces a complete immutable source snapshot.
6. Publication creates a distinct workspace-owned definition and implementation
   lineage with explicit provenance. It never mutates, overwrites, activates,
   deploys, or executes the base.

The protected source identity, ownership, lifecycle, trust, package, release,
snapshot, provenance, and policy fields are read-only. A later decision and typed
schema are required before any of those fields become editable.

Customization lifecycle and conflict states are explicit. A missing or changed
base identity, unavailable source snapshot, stale optimistic revision, invalid
overlay, or revoked/unavailable implementation blocks review and publication. No
automatic rebase, floating base remap, or silent conflict resolution is allowed.

## Consequences

### Positive

- The original asset, package, release, and source snapshot remain immutable.
- Sparse logical storage preserves exact provenance and makes reused versus changed
  content reviewable.
- Definition and implementation changes share one lifecycle without moving source
  code into Asset Kernel records.
- Review/build/release continue to use the existing immutable artifact and Asset
  Studio security boundaries.

### Negative

- Application services must coordinate semantic records, artifact content, source
  snapshots, optimistic revisions, and publication as one recoverable workflow.
- Base availability and revocation must be checked again at materialization and
  publication time.
- The UI must distinguish editable, protected, reused, changed, conflicted, and
  materialized content.

### Follow-up

- Add the application lifecycle, persistence, target catalog, host transports, and
  guided UI in ordered implementation increments.
- Keep create/publish operations unavailable until workspace authorization,
  materialization, and host composition are complete.
- Qualify accessibility and the untrusted-source security boundary before the
  workflow is described as production-ready.
