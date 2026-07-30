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
  runtime-local paths. Localization is an explicit application/storage action
  that requires workspace context at the boundary and preserves that context
  through binding, provider, object-storage, and catalog operations.
- Add data acquisition uses bounded workspace-scoped tasks. Local files stream
  through digest-verified ordered checkpoints; provider files require exact
  commit revisions; website capture is secure-egress mediated, robots-aware,
  user-bounded to explicit pages or one sitemap, and has no recursive crawl or
  permissive robots override.
- The shared Hugging Face selector browses a bounded namespace and bounded
  importable file list through host clients, lets users check exact files, and
  passes only adapter-returned immutable revisions to the governed task. Do not
  reintroduce free-form provider paths or mutable revision entry in the primary
  workflow. Provider users and organizations are source coordinates, never
  application organization scope; the host must add authoritative organization
  and principal context and reject missing or conflicting context before task
  creation.
- Provider registration must persist the authoritative task workspace on both
  the catalog record and imported-source binding before task success. Parquet
  selections must remain tabular and use a Parquet media type even when the
  provider listing omits one; workspace-filtered browsing is not relaxed to
  accommodate an unscoped write.
- Hugging Face Step 2 may read or update only the host-owned token setting
  needed for private or gated datasets. Keep the token out of task commands,
  errors, logs, and roadmap evidence. The guided workflow is the sole mounted
  ingestion path; do not restore the retired Other import tools beside it.
- Acquisition progress comes from persisted host state. Task/source snapshot
  visibility and changed-refresh/new-snapshot visibility commit atomically;
  cancellation races compensate any uncommitted artifact writes.
- The baseline worker emits aggregate plus physical train, validation, and test
  outputs. Fixed-seed results are deterministic; source groups and exact
  duplicates cannot cross splits.
- Quality-enabled preparation resolves a host-owned effective policy before
  staging, applies mandatory checks to provided and generated rows, and sends
  rejected rows to reversible quarantine with bounded reason evidence.
- Derive input intent, available preparation methods, defaults, and active
  controls from the shared exact-task adaptive plan. One ready dataset is
  checked and split, compatible datasets are combined, and source material is
  converted with only task-relevant methods. Never pad a selector with
  meaningless choices or serialize inactive controls.
- Document fixed-length, topic-aware, and structure-aware methods expose only
  compatible settings; topic-aware is the default when document conversion is
  needed. Generation is separate from chunking. Image tasks use metadata or
  reviewed annotations, and detection/segmentation must not imply automatic
  boxes or masks.
- Standard quality checks are the complete baseline; Strict includes the same
  checks with tighter bounded admission rules. Apply task-specific checks and
  per-example source association without assuming tabular rows.
- Preserve exact normalized artifact/span/region/page lineage. Report unavailable
  OCR or other capabilities honestly and fail closed instead of implying work ran.
- For images, distinguish inspected metadata/annotations from uninspected
  pixels. Do not claim OCR, face detection, or pixel-level personal-data or
  credential inspection when those capabilities did not run.
- Run bounded semantic curation before splitting. Persist aggregate metrics and
  bounded lineage references only, never source text or embedding vectors.
- Generated candidates require task schema, exact source citation, source
  support, independent critic, safety, and diversity checks. Failed candidates
  enter reversible quarantine and admitted candidates still require approval.
- Local generation keeps runtime-owned system rules above editable objectives
  and untrusted source/task data. Require one versioned task-bound JSON envelope,
  reject unknown fields, labels, tasks, versions, oversized/nested values, and
  non-source passages, then map validated values to the task row contract before
  JSON, CSV, or Parquet serialization.
- Example output layouts are edited through bounded visual fields, never raw
  schema. Compile one deterministic schema and protected training-purpose map
  for prompt, decoder, parser, row mapping, and Parquet output. Reject unsafe or
  protected names, missing or duplicate purposes, excessive bounds, and nested
  CSV before generation. Legacy dynamic extraction remains decoder-ineligible
  until its fields are explicitly defined.
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
- Every generated training task has a task-compatible default model JSON schema
  shown through the visual output editor. Advanced users edit plain-language
  fields rather than raw schema keywords; protected training purposes cannot be
  removed or duplicated.
- Source attribution is opt-in and separate from model output. Show its locked
  companion fields beside the example shape, then populate them only from
  bounded trusted source metadata after validation. Never ask the model to
  invent attribution, and omit the companion object when the choice is off.
- Keep reusable settings outside the numbered workflow, omit task-specific
  settings when there are no choices, and avoid nested review cards that only
  restate save or publication guidance.
- Inline readiness and correction belong near the affected step. Use the
  notification center only for cross-page outcomes and authoritative
  long-running activity.
- On acquisition success, clear the shared Add data form, return it to Files,
  open the authoritative completed activity in the notification dropdown, and
  scroll the page viewport to the top. Keep selections after failure or
  cancellation so users can correct or retry them; never clear the host-owned
  provider credential as part of this form reset.

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
- For optional token constraints, test exact conditional dependency readiness,
  flat and nested Qwen-token acceptance, processor attachment/reset and bounded
  cache eviction, accepting EOS, truncation/dead-end denial, sanitized errors,
  no checked-mode fallback, and retained unchecked-mode semantic validation.
- Malformed, oversized, unavailable-policy, wrong-scope, stale/replayed
  approval, cancellation, cleanup, and diagnostic non-disclosure tests.
- Deterministic physical split counts, group/duplicate isolation, and output
  handle containment tests.
- Exact normalized-span lineage, bounded semantic comparison, source-cap and
  mixing invariants, synthetic schema/citation/grounding/critic/safety/diversity
  denial paths, and aggregate-only evidence tests.
- Default-schema completeness for every generated task, schema-fingerprint and
  purpose-path mismatch denial, selected trusted attribution, sanitized public
  URLs, and absence of attribution when unselected.
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
