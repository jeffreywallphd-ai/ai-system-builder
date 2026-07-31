# ADR-0040: Immutable Dataset Versions, Lineage, and Publication

- Status: accepted
- Date: 2026-07-29
- Deciders: ai-system-builder maintainers
- Related: ADR-0004, ADR-0008, ADR-0009, ADR-0015, ADR-0028,
  ADR-0029, `docs/architecture/data-management.md`,
  `docs/architecture/persistence-and-storage.md`

## Context

Dataset preparation can create a complete dataset, physical splits, a quality
report, and quarantine evidence. Those outputs were independent artifacts with
no single immutable record that answered which exact source bytes, recipe,
quality policy, and outputs formed a training dataset. Provider publication was
also an output action rather than durable evidence tied to one exact version.

Structured records and artifact content have deliberately separate persistence
and storage lifecycles. A distributed transaction across a database, artifact
storage, and an external provider would add deployment-specific coordination
and failure semantics that the current architecture does not support.

## Research basis

- The [Croissant 1.1 specification](https://docs.mlcommons.org/croissant/docs/croissant-spec-1.1.html)
  defines JSON-LD dataset metadata, `dct:conformsTo`, file distributions, and
  SHA-256 integrity fields for versioned file objects.
- [Hugging Face dataset cards](https://huggingface.co/docs/hub/datasets-cards)
  use repository `README.md` files with metadata and human-readable guidance.
- The official [Hugging Face JavaScript Hub API](https://huggingface.co/docs/huggingface.js/hub/modules)
  supports bounded multi-operation commits and returns immutable commit output.

## Security impact

This decision is security-relevant. Protected assets are workspace and
organization ownership, dataset and source integrity, reproducibility lineage,
quality approval evidence, and publication destination evidence. Threats include
cross-scope reads, mutable substitution, partial-version visibility, forged or
malformed digests, publication against a missing version, replay with altered
content, protected-content disclosure, and unbounded metadata.

Controls are exact organization-scoped repositories, workspace-qualified keys,
insert-only immutable records, idempotency only for byte-equivalent normalized
records, SHA-256 references, strict schema/version and size/count validation,
bounded documentation, and append-only publication evidence. Records contain no
dataset rows, credentials, provider payloads, local paths, or raw reports.

## Decision

- A dataset version is one immutable, schema-versioned structured record. It is
  visible only after every referenced artifact has been durably written and
  validated.
- Dataset, split, report, quarantine, recipe, dataset-card, and Croissant bytes
  remain in artifact storage. The version record contains logical artifact keys,
  media types, sizes/counts where relevant, and exact SHA-256 digests.
- Reproducibility lineage binds exact source artifacts, an immutable recipe
  snapshot, preparation implementation identity and version, deterministic split
  settings, the resolved quality policy fingerprint, and report fingerprint.
- Version metadata includes bounded documentation suitable for generating
  interoperable dataset-card and Croissant artifacts. Protected content is not
  copied into the structured record.
- Version creation is insert-only. An identical retry is idempotent; reuse of the
  same version identifier with different normalized content is a conflict.
- The repository is scoped to exactly one organization partition (or the local
  platform partition) and all keys additionally carry an exact workspace.
  Missing or mismatched scope fails closed.
- Atomic visibility uses a **record-last** protocol: write and validate immutable
  artifacts first, then insert the version record in one structured-store
  transaction. There is no claim of a distributed transaction across database,
  object storage, and providers.
- Successful external publication is separate append-only evidence tied to an
  existing version. It records the provider, repository, immutable provider
  revision, visibility, actor, and time. Publication never mutates the version.
- Failed publication does not create success evidence. A retry reconciles against
  the exact version and destination rather than inferring success from mutable
  provider state.
- Provider credentials remain adapter-owned and never enter version,
  publication, roadmap, diagnostic, or documentation records.

## Consequences

### Positive

- Training inputs can bind to an exact, reproducible dataset version instead of a
  collection of mutable-looking output references.
- Readers never observe a partial version record.
- The same repository contract works over local SQLite and managed PostgreSQL
  through the structured-document seam.
- Publication history is auditable without weakening version immutability.

### Negative

- Artifact writes that succeed before version insertion may leave unreferenced
  immutable objects; finalization must compensate or make later cleanup safe.
- Record-last atomicity does not guarantee external provider availability or
  cross-resource rollback.
- Live PostgreSQL contention and controlled provider publication remain
  qualification requirements beyond deterministic unit coverage.

## Compatibility and recovery

Existing prepared outputs are not silently promoted to versions. Creating a
version requires all current lineage and digest evidence. Structured-data export
automatically includes the new namespaces. Rollback may stop creating or reading
the new records without changing existing artifacts; it must not rewrite or
delete accepted versions or publication evidence.

> AI documentation reminder: when behavior in this area changes, update the
> related ADRs, architecture docs, context packs, threat model, and README files
> in the same change.
