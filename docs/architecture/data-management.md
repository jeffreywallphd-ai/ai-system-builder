# Data Management

- Status: current
- Related decisions: `docs/adr/ADR-0008-ingestion-and-staged-artifact-semantic-model.md`, `docs/adr/ADR-0009-artifact-identity-and-backing-domain-model.md`, `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md`, `docs/adr/ADR-0040-immutable-dataset-versions-lineage-and-publication.md`
- Verification: `docs/architecture/architecture-verification.md`

This document defines the implemented ingestion-to-dataset preparation
foundation and the rules later curation, versioning, and scale work must
preserve.

## Purpose

Data Management turns workspace-owned source artifacts into training datasets without making users understand storage adapters, runtime payloads, or provider protocols. Desktop and thin-client hosts present the same four-step sequence:

1. **Add data** selects supported workspace artifacts.
2. **Check data** explains whether the selected sources can be used and what the user can correct.
3. **Prepare dataset** applies recommended defaults; parser, generation, model, split, performance, and file controls remain under **Advanced settings**.
4. **Review and create** presents bounded quality evidence and requires explicit approval before the final dataset and splits are saved.

The primary UI uses goal and outcome language. Adapter names, schemas, prompt payloads, local paths, and provider response details do not belong in the default experience.

## Capability authority

The shared dataset-preparation capability registry under modules/contracts/runtime is the authority for advertised source formats and task compatibility. UI selectors and the application guard consume the same registry. A format or task combination must not be shown as available merely because one adapter can recognize its extension.

The implemented source formats are CSV, JSON, JSON Lines, Parquet, text, Markdown, HTML, PDF, DOCX, and supported image formats. The active task profile further limits that list. Legacy DOC, XLS, XLSX, TSV, AVIF, and HEIC paths are not advertised. Unsupported or incompatible sources fail before runtime work starts with a plain-language reason and action.

Structured readers enforce bounded file and row limits. Remote Hugging Face selections retain their explicit revision and are localized through the repository and artifact-storage ports before runtime execution. No renderer or transport performs ambient provider access.

## End-to-end path

    Desktop or thin-client ordered workflow
      -> IPC or authenticated HTTP start/read/approve/cancel adapter
      -> PrepareTrainingDatasetFromArtifactsUseCase
      -> workspace-scoped artifact bindings and object storage
      -> optional immutable provider source retrieval
      -> RuntimeTaskRegistryPort
      -> Python dataset preparation worker
      -> contained aggregate/train/validation/test/report/quarantine outputs
      -> bounded review evidence
      -> exact-fingerprint approval
      -> immutable local dataset version
      -> optional later explicit Hugging Face publication

Transport adapters validate boundary shape, authentication, and workspace context, then delegate. Recipe normalization, staging, task ownership, result validation, and materialization remain application responsibilities. Parsing, normalization, generation, and physical split creation remain runtime responsibilities.

## Split integrity

The worker produces an aggregate output plus physical train, validation, and test outputs when their configured shares are nonzero. Counts in the result are derived from those partitions and must sum to the aggregate row count.

Partitioning is deterministic for a fixed seed. Rows connected by the same source/group identifier or exact task-content fingerprint form one component and cannot cross split boundaries. When too few independent components exist to populate every requested split, the worker preserves leakage isolation and returns a bounded warning instead of separating related or duplicate rows.

## Quality policy and curation

Quality-enabled preparation resolves the requested Recommended or Strict preset
through a host-owned workspace or organization policy provider before source
staging. Missing policy authority fails closed. The resolved policy preserves
mandatory schema, exact-duplicate, bounded fuzzy-duplicate, sensitive-data,
credential, and split-leakage checks; optional license, consent, language,
benchmark, text-length, and per-source limits may tighten admission.

The worker applies the same checks to provided and generated rows. Rejected rows
enter a reversible, workspace-scoped quarantine with reason codes and source-row
lineage. Review reports contain field, source, class, and language summaries,
accepted and quarantined counts, bounded reason counts, and a small set of
sanitized examples. Raw row values are not review evidence.

## Review and approval boundary

When review is required, the application validates the worker report and resolved
policy, stores only the bounded report and quarantine evidence, and retains final
dataset outputs inside the contained runtime directory. A read returns
`review-required`; it does not materialize aggregate or split artifacts.

Approval must carry the recorded workspace and organization scope plus the exact
64-character report fingerprint. Stale fingerprints, replay, wrong scope,
malformed evidence, and blocked reports fail closed. Successful approval
materializes the final artifacts, marks the review approved, completes the task,
and cleans runtime files. Discard/cancel removes review evidence and contained
outputs. Partial materialization is compensated before an error is returned.

## Lifecycle and results

Dataset preparation is an asynchronous start/read/cancel task. Task records and
cached materialized results are owned by the starting workspace and, in managed
operation, organization. Status reads and cancellation fail as not found when
the request does not carry the recorded scope.

Progress, readiness, validation, and corrective actions remain inline. The global notification center receives only the completed cross-page outcome. Result summaries remain visible and include aggregate, training, validation, and test counts plus the saved destination and bounded warnings.

## Immutable dataset versions

A dataset version is an immutable, organization- and workspace-scoped metadata
record. It binds the complete dataset and its splits, report, quarantine,
immutable recipe snapshot, source artifacts, resolved quality policy, and
interoperable documentation by exact SHA-256 digest. Dataset rows, report
details, recipe payloads, cards, and Croissant documents remain in artifact
storage rather than being copied into structured persistence.

Version visibility uses a record-last protocol. Finalization durably writes and
validates every artifact before inserting one version record. An identical retry
is idempotent; the same version identifier with different normalized content is
rejected. This is atomic version visibility, not a distributed transaction
across structured persistence, object storage, and external providers.

Successful external publication is append-only evidence tied to an existing
version. It records the exact provider revision and visibility without mutating
the version. Failed or partial provider work is not success evidence and must be
reconciled before a retry is recorded.

Desktop and thin-client views expose the same saved-version workflow. History
reads, comparisons, and verified recipe retrieval carry authenticated workspace
context through the application authorization boundary. The default view shows
the version name, time, row count, and plain-language changes; artifact keys,
manifests, and digests remain under Advanced details. “Use this setup again”
verifies the immutable recipe digest before reselecting recorded source artifact
ids and restoring preparation settings.

Every finalized version also contains a bounded human-readable dataset card and
Croissant 1.1 JSON-LD artifact. Croissant file objects carry exact SHA-256
digests and publication-relative paths. Explicit Hugging Face publication
verifies every local artifact, defaults to Private, requires a separate Public
confirmation, commits the complete version in one bounded provider operation,
and records only the returned immutable commit identifier. Preparation never
performs automatic per-file publication when versioning is active.

## Diagnostic boundary

Worker and application diagnostics may contain task identifiers, stage names, counts, sizes, duration, provider name, failure class, and bounded reason codes. They must not contain source rows, normalized documents, chunks, prompts, model output, credentials, provider payloads, local paths, or arbitrary exception text.

## Current limits

- The thin-client foundation intentionally offers the fully supported table-data path using existing fields; model-generated missing text remains a desktop advanced path until equivalent model lifecycle controls are exposed.
- Resumable acquisition, semantic deduplication, and model-assisted
  synthetic-data review remain separate roadmap increments.

## Verification obligations

Changes must cover capability truth, malformed and oversized inputs, deterministic split invariants, duplicate and group isolation, workspace denial, provider revision behavior, cancellation and cleanup, diagnostic non-disclosure, desktop and thin-client ordered-step semantics, keyboard behavior, and actionable results.
