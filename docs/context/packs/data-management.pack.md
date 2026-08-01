# Context Pack: Data Management

- Pack name: `data-management`

## Purpose

- Route work involving ingestion, staged source artifacts, dataset preparation, split integrity, curation, versioning, or dataset publication.
- Summarize the implemented boundary without replacing canonical architecture, ADR, security, storage, or runtime guidance.

## Use When

- Changing source format/task compatibility or Data Management UI choices.
- Staging local or repository-backed artifacts for preparation.
- Changing dataset normalization, generation, splits, results, warnings, lifecycle, or publication.
- Adding profiling, curation, quarantine, version history, dataset cards, or governed source refresh.

## Core Guidance

- Preserve ADR-0008 staged-artifact semantics and ADR-0009's separation of internal artifact identity from local and remote backing.
- `modules/contracts/runtime/dataset-preparation-capabilities.ts` owns
  advertised source/task support; do not create host-specific allowlists.
- Reject unsupported or incompatible paths before runtime work with a plain-language reason and corrective action.
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
- Staging recovers omitted byte-descriptor names and media types from the
  workspace-authorized catalog; it never guesses JSON. Provider registration
  persists task workspace on catalog and imported-source records. Parquet
  selections remain tabular even when provider media type is omitted; do not
  accommodate an unscoped write.
- Parquet preparation requires the managed worker's patched PyArrow pin and keeps bounded structured-read failures distinct from model readiness.
- Artifact Browser gives uploaded and generated data the same cards; bounds JSON/JSON Lines to 100 formatted lines, Parquet to 10 rows, and PDF to one rasterized page; renders inert Markdown without raw HTML or remote images; and hides internal system-build and all `+json` artifacts while ordinary `.json`, `.jsonl`, and `.ndjson` files remain user-facing.
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
  JSON, CSV, or Parquet serialization. Unchecked mode may unwrap one exact
  `json` fence around one bounded object before those validations; reject
  surrounding prose, partial or multiple fences, and non-object JSON.
- Treat generation `skip` as a data-only omission for an explicit no-candidate result or one section whose output remains invalid after bounded correction. Reject that output, record a warning/count, and continue; if no valid examples remain, fail the run. Never convert model-cache/load, decoder operation, inference, dependency, resource, or unexpected runtime failures into skipped examples. Validate complete model weights, indexed shards, and
  tokenizer files before accepting a Transformers cache. Preparation readiness
  is local-only; incomplete downloads stop with a distinct safe message and are
  resumed only through Step 3's explicit model-download action. That task retries transient transfer or validation failures three times, preserves bounded partial files, and cleans cache only for containment or configured size/count violations.
- Topic-aware division must enforce a minimum semantic section size before accepting a low-continuity boundary, retain the maximum token bound, and avoid one generation request per sentence. Progress must expose a safe model-loading phase globally until the first batch completes. Built-in model defaults use non-identifying capacity facts: desktop considers available memory and steps an untouched Quality 7B choice through Compact 3B to Lightweight 1.5B as needed; servers keep the total-memory reserve. Never override explicit/saved choices. Enforce only the contract-owned 0/1/4 GiB CPU overflow choices, deny CUDA overflow, reject larger live-memory shortfalls, warn globally when disk/swap is actually used, and keep model-status polling responsive during load.
- Desktop runtime startup respects an explicit Python command. Otherwise, bounded fixed probes prefer installed Python 3.10 through 3.13 for the
  decoder. With none, keep the baseline worker available, advertise decoder
  capability as unavailable, disable constraints in both hosts, and return a
  distinct safe unavailable reason for stale requests.
- Preserve desired-example field order in decoder grammar serialization while keeping integrity fingerprints order-independent. On Windows, use the pinned Outlines mask kernel's eager callable to avoid Torch's optional compiler probe without changing masking or mandatory post-validation.
- Example output layouts are edited through bounded visual fields and
  plain-language sample values, never raw schema. Compile one deterministic
  schema, schema-valid example envelope, and protected training-purpose map for
  prompt, decoder, parser, row mapping, and Parquet output. Bind all three to the
  same fingerprint. Reject unsafe or protected names, malformed samples,
  missing or duplicate purposes, incompatible purpose types, excessive bounds,
  and nested CSV before generation. Legacy dynamic extraction remains
  decoder-ineligible until its fields are explicitly defined.
- New instruction-tuning output layouts use separate Instruction, Input,
  Context, and Output purposes. Instruction is fixed to the configured behavior
  text, Input is the generated user request, and Context is attached unchanged
  from the current source section rather than generated by the model. Optional
  text-only Thought remains independent for chain-of-thought training. Legacy
  layouts without Context keep exact-span validation on their prior Input field.
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
- Group immutable versions by dataset identity, select the newest by default, and derive major/minor display labels from lineage; preparation report lines page actual ready or quarantined rows under the exact task scope and report fingerprint.
- Dataset Review lists only locally readable Parquet artifacts, presents a continuous row-by-row modal plus a 10-row paginated table, requires exact row fingerprints, and requires localization for repository-only files. Reject removes the exact row and writes a new immutable minor version; Edit changes read-only values into a bounded typed form and Approve changes does the same. The first persisted rejection or approved edit creates a 1.0 baseline plus 1.1 child. Existing rows are already approved, and Cancel exits without persistence.
- Store accepted generated review rows as a bounded, integrity-checked workspace-local temporary artifact so previews survive runtime-directory cleanup. Retain final private runtime outputs so failed approval remains retryable; clean preview and final artifacts after their terminal approval, cancellation, or discard boundary.
- Use bounded input counts, bytes, rows, document extraction, chunk counts,
  generated rows, warning counts, runtime duration, previews, and reports.
- Public diagnostics may include stage, counts, sizes, durations, provider
  names, failure classes, and bounded reason codes. Exclude source content,
  prompts, model output, credentials, provider payloads, paths, and raw logs.
- Keep the primary experience in the shared Add data, Check data, Prepare
  dataset, Review and create sequence. Put parser/model/split/performance/file
  tuning under Advanced settings.
- Every generated training task has a task-compatible default model JSON schema
  and populated visual sample. Advanced users edit plain-language fields and
  values, not raw schema. Labels remain in Step 1. Protected purposes cannot be
  removed or duplicated; instruction training defaults to a separate Context
  and may add an optional text-only Thought purpose.
- Source attribution is opt-in and separate from model output. Show locked
  companion fields beside the shape and populate them only from bounded trusted
  metadata after validation. Never ask the model to invent attribution; omit
  the companion object when the choice is off.
- Keep reusable settings outside the numbered workflow, omit task-specific settings when there are no choices, and avoid nested review cards that only restate save or publication guidance.
- Keep the optional dataset save name beside the final approval and discard actions in Review and create. One explicit approval saves the complete curated ready set. After success, switch to Artifact Browser with the exact saved dataset selected and its detail view open; do not embed post-save version history in preparation.
- Keep readiness and correction inline. Use notifications for authoritative cross-page activity; accepted dataset preparation opens and updates there.
- On acquisition success, clear Add data, return it to Files, open the completed
  notification, and scroll to the top. Keep selections after failure or
  cancellation for correction or retry; never clear the host-owned provider
  credential during form reset.

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
- For optional token constraints, test conditional dependency readiness,
  Qwen-token acceptance, processor reset/bounded cache, EOS, a bounded same-mode
  correction, safe terminal errors, no checked fallback, and semantic validation.
- Malformed, oversized, unavailable-policy, wrong-scope, stale/replayed
  approval, cancellation, cleanup, and diagnostic non-disclosure tests.
- Deterministic physical split counts, group/duplicate isolation, and output
  handle containment tests.
- Exact normalized-span lineage, bounded semantic comparison, source-cap and
  mixing invariants, synthetic schema/citation/grounding/critic/safety/diversity
  denial paths, and aggregate-only evidence tests.
- Default-schema completeness, fingerprint/purpose-path denial, custom mappings,
  trusted attribution, sanitized URLs, and unselected absence.
- Desktop/thin-client UX checks plus applicable repository gates.

## Adjacent Packs

- `context-management` for RAG databases, context packs, and browser handoffs.
- `persistence-storage` for object/repository storage or source isolation.
- `runtime` or `runtime-task-registry` for worker execution/lifecycle.
- `desktop-implementation` for renderer and thin-client experience.
- `server-host` for Express/API composition.
- `security` whenever authority, untrusted parsing, provider access,
  diagnostics, or publication changes.
