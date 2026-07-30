# Data Management Threat Model

## Scope

This model covers workspace source selection, local and Hugging Face staging, structured and document parsing, optional local-model generation, quality policy resolution, curation and quarantine, split creation, human approval, task lifecycle transport, result materialization, immutable dataset versions, publication evidence, warnings, and diagnostics.

## Protected assets

- Source artifacts, rows, documents, annotations, prompts, generated examples, and prepared split contents
- Workspace and organization ownership, artifact identifiers, repository revisions, and lineage
- Provider and model credentials
- Runtime working directories, host paths, logs, and adapter payloads
- Integrity of recipes, effective quality policy, reports, review fingerprints, quarantine lineage, split membership, immutable version digests, publication revisions, counts, destinations, and completed results

## Trust boundaries and controls

| Boundary | Primary threats | Required controls |
| --- | --- | --- |
| UI to IPC or HTTP | forged workspace/task identifiers, oversized body, guessed task reads | deny-by-default route policy, authenticated principal and organization context, normalized workspace context, bounded requests, opaque not-found denial, no UI-only authorization |
| Artifact catalog/bindings to staging | cross-workspace reads, mutable substitution, traversal | workspace-scoped port context, contained storage locators, immutable provider revisions, early capability guard |
| Provider retrieval | credential disclosure, mutable revision, unsafe payload, unbounded transfer | repository port, organization-scoped credentials, explicit revision, bounded localization, sanitized failure |
| Runtime working directory | traversal, stale files, partial outputs, local-path disclosure | generated contained directory, validated relative output handles, format validation, terminal and cancellation cleanup |
| Parser and generator | malformed or oversized input, prompt/content leakage, arbitrary exception disclosure | file/row/chunk bounds, fail-closed parsing, bounded reason codes and counts, no raw source/prompt/output logging |
| Split stage | duplicate or source leakage, fabricated counts, nondeterminism | deterministic component partitioning, source/group and exact-content isolation, physical outputs, count invariants |
| Quality policy and curation | permissive fallback, unbounded duplicate work, hidden row loss, sensitive review samples | host-owned fail-closed policy resolution, mandatory controls, bounded candidate checks, reversible quarantine, count invariants, sanitized bounded samples |
| Review and approval | guessed task, stale or replayed approval, altered report, blocked dataset admission | recorded scope, validated effective policy/report, timing-safe exact fingerprint comparison, one-time pending state, approvalAllowed denial |
| Materialization/publication | wrong destination, partial or unverifiable result, cross-workspace output | withhold final outputs before approval, explicit destination, workspace metadata/context, result validation, partial-write compensation, later version-level atomicity |
| Dataset version persistence | partial visibility, mutable substitution, malformed or oversized metadata, cross-scope reads | artifact-first/record-last visibility, exact SHA-256 references, bounded schema validation, insert-only idempotency, organization partition, workspace-qualified key, and application workspace authorization on history/comparison/reproduction |
| Publication evidence | publication against a missing or substituted version, mutable destination inference, accidental public access, credential disclosure | require an existing exact version, authorize exact workspace/provider scopes, verify every artifact digest, private default, separate public confirmation, bounded one-commit publication, append-only immutable revision evidence, adapter-owned credentials, no provider payload persistence |
| Status and cancellation | guessed request id, cross-workspace or cross-organization observation or cancellation, retained review files | workspace and optional organization ownership recorded at start and checked on every read/approve/cancel, generic not-found response, evidence and runtime cleanup |

## Abuse and failure cases

- Missing, malformed, unsupported, deeply nested, oversized, or over-row-limit input fails before unbounded work.
- A source registered in one workspace cannot be prepared, observed, or
  cancelled through another workspace context; managed tasks also require their
  recorded organization context.
- A remote-only source without a usable immutable backing fails with a corrective action; it is not silently replaced by a mutable default revision.
- Runtime output handles containing absolute paths or traversal are rejected.
- A missing quality-policy provider, malformed report, policy mismatch, blocked report, wrong-scope approval, stale fingerprint, or replayed approval fails closed.
- Review reads expose bounded sanitized summaries and report/quarantine descriptors, never final dataset descriptors or raw row values.
- A requested split with insufficient independent groups preserves isolation and reports a bounded warning.
- Parser, provider, and model failures cannot place raw content, prompts, model output, credentials, provider payloads, or local paths into public errors or logs.
- Cancellation and terminal reads clean staged runtime files; cleanup failure must not broaden access.
- A dataset-version identifier cannot be reused with different normalized
  content, publication cannot be recorded for a missing version, and a malformed
  stored record fails closed.
- Version and publication records contain bounded metadata and logical artifact
  references only; source rows, prompts, credentials, raw reports, provider
  payloads, and host paths are excluded.
- History, comparison, and reproduction return no version data when workspace
  membership or required read scope is absent. Reproduction verifies the
  recipe bytes against the persisted digest before returning bounded settings.

## Residual risk

Automated schema, language, duplicate, personal-data, credential, safety, license, consent, and benchmark checks can produce false positives or false negatives; human approval does not replace organizational policy or legal review. Record-last finalization can leave unreferenced immutable artifacts when the final insert fails, so application finalization must compensate or make bounded cleanup safe. It does not create a distributed transaction with external providers. Live PostgreSQL contention and controlled provider publication remain required qualification evidence.
