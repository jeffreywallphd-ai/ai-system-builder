# Context Pack: Data Management

- Pack name: `data-management`

## Purpose

- Route work involving ingestion, staged source artifacts, dataset
  preparation, split integrity, curation, versioning, or dataset publication.
- Summarize the implemented boundary without replacing canonical architecture,
  ADR, security, storage, or runtime guidance.

## Use When

- Changing source format/task compatibility or Data Management UI choices.
- Staging local or repository-backed artifacts for preparation.
- Changing dataset normalization, generation, splits, results, warnings,
  lifecycle, or publication.
- Adding profiling, curation, quarantine, version history, dataset cards, or
  governed source refresh.

## Core Guidance

- Preserve ADR-0008 staged-artifact semantics and ADR-0009's separation of
  internal artifact identity from local and remote backing.
- `modules/contracts/runtime/dataset-preparation-capabilities.ts` is the
  authority for advertised source/task support. Do not create host-specific
  allowlists.
- Reject unsupported or incompatible paths before runtime work with a
  plain-language reason and corrective action.
- Carry workspace and managed organization context through transport,
  application, storage/provider, runtime-task, result, and publication
  boundaries. UI selection is not authorization.
- Renderer and thin-client code must not fetch provider objects or handle
  runtime-local paths. Localization is an explicit application/storage action.
- The baseline worker emits aggregate plus physical train, validation, and test
  outputs. Fixed-seed results are deterministic; source groups and exact
  duplicates cannot cross splits.
- Quality-enabled preparation resolves a host-owned effective policy before
  staging, applies mandatory checks to provided and generated rows, and sends
  rejected rows to reversible quarantine with bounded reason evidence.
- A review-required result exposes only sanitized report/quarantine evidence.
  Final aggregate and split artifacts remain contained until a scope- and exact
  fingerprint-bound approval succeeds; stale, replayed, blocked, or wrong-scope
  approvals fail closed.
- A complete dataset version is an immutable, organization- and
  workspace-scoped structured record that binds exact source, recipe, quality,
  output, and documentation artifact digests. Write and validate artifacts
  first, then insert the record; never expose a partial version.
- Publication evidence is append-only, requires an existing exact version, and
  records an immutable provider revision. Credentials and provider payloads
  remain adapter-owned.
- Every version includes a readable dataset card and Croissant 1.1 metadata with
  exact file digests. Provider publication is an explicit, authorized,
  private-by-default one-commit action; Public requires separate confirmation.
- Version history, comparison, and reproduction are workspace-authorized.
  Reproduction returns a recipe only after exact digest verification and uses
  stable source artifact ids to restore the ordered preparation workflow.
- Use bounded input counts, bytes, rows, document extraction, chunk counts,
  generated rows, warning counts, runtime duration, previews, and reports.
- Public diagnostics may include stage, counts, sizes, durations, provider
  names, failure classes, and bounded reason codes. Exclude source content,
  prompts, model output, credentials, provider payloads, paths, and raw logs.
- Keep the primary experience in the shared Add data, Check data, Prepare
  dataset, Review and create sequence. Put parser/model/split/performance/file
  tuning under Advanced settings.
- Inline readiness and correction belong near the affected step. Use the
  notification center only for cross-page outcomes and authoritative
  long-running activity.

## Canonical Sources

- `docs/architecture/data-management.md`
- `docs/security/data-management-threat-model.md`
- `docs/architecture/persistence-and-storage.md`
- `docs/architecture/runtime-model.md`
- `docs/adr/ADR-0008-ingestion-and-staged-artifact-semantic-model.md`
- `docs/adr/ADR-0009-artifact-identity-and-backing-domain-model.md`
- `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md`
- `docs/adr/ADR-0040-immutable-dataset-versions-lineage-and-publication.md`

## Verification

- Capability truth and unsupported early-denial tests.
- Malformed, oversized, unavailable-policy, wrong-scope, stale/replayed
  approval, cancellation, cleanup, and diagnostic non-disclosure tests.
- Deterministic physical split counts, group/duplicate isolation, and output
  handle containment tests.
- Desktop/thin-client ordered-step, advanced-disclosure, actionable warning,
  keyboard, reflow, and reduced-motion checks.
- Applicable docs, architecture, agent-support, host build, package, and full
  repository gates after an increment is complete.

## Adjacent Packs

- `persistence-storage` for object/repository storage or source isolation.
- `runtime` or `runtime-task-registry` for worker execution/lifecycle.
- `desktop-implementation` for renderer and thin-client experience.
- `server-host` for Express/API composition.
- `security` whenever authority, untrusted parsing, provider access,
  diagnostics, or publication changes.
