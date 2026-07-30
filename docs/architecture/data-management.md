# Data Management

- Status: current
- Related decisions: `docs/adr/ADR-0008-ingestion-and-staged-artifact-semantic-model.md`, `docs/adr/ADR-0009-artifact-identity-and-backing-domain-model.md`, `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md`, `docs/adr/ADR-0040-immutable-dataset-versions-lineage-and-publication.md`
- Verification: `docs/architecture/architecture-verification.md`

This document defines the implemented ingestion-to-dataset preparation
foundation and the rules later curation, versioning, and scale work must
preserve.

## Purpose

Data Management turns workspace-owned source artifacts into training datasets without making users understand storage adapters, runtime payloads, or provider protocols. Desktop and thin-client hosts present the same four-step sequence:

1. **Add data** chooses the exact training goal, then shows only compatible workspace artifacts.
2. **Check data** explains the checks that apply to that goal and source kind, including which content surfaces were not inspected.
3. **Prepare dataset** infers whether the user is using one ready dataset, combining compatible datasets, or creating examples from source material. It then offers only meaningful preparation methods and shows only the Advanced settings used by the selected method.
4. **Review and create** presents bounded, task-specific quality evidence and requires explicit approval before the final dataset and splits are saved.

The primary UI uses goal and outcome language. Adapter names, schemas, prompt payloads, local paths, and provider response details do not belong in the default experience.
Desktop places reusable workflow settings in an unnumbered section before the
four steps. It omits empty task-specific settings and keeps save and
publication guidance in the Review and create body instead of nested cards.

## Capability authority

The shared dataset-preparation capability registry under modules/contracts/runtime is the authority for advertised source formats and task compatibility. UI selectors and the application guard consume the same registry. A format or task combination must not be shown as available merely because one adapter can recognize its extension.

The implemented source formats are CSV, JSON, JSON Lines, Parquet, text, Markdown, HTML, PDF, DOCX, and supported image formats. Text tasks accept the first nine formats. JSON readers accept one object, an array of objects, or records under `rows`, `data`, `items`, `examples`, or `annotations`; JSON Lines uses one object per nonempty line. The active task profile further limits that list. Legacy DOC, XLS, XLSX, TSV, RTF, ODT, AVIF, and HEIC paths are not advertised. Unsupported or incompatible sources fail before runtime work starts with a plain-language reason and action.

Structured readers enforce bounded file and row limits. Remote Hugging Face selections retain their explicit revision and are localized through the repository and artifact-storage ports before runtime execution. Localization carries the authoritative workspace from the host boundary through binding reads, provider retrieval, local catalog/object storage, and binding updates; it also retains the provider filename for type classification. No renderer or transport performs ambient provider access.

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

## Governed acquisition tasks

The Add data step now starts workspace-scoped acquisition tasks for local files,
selected Hugging Face files, and explicitly selected website pages or one
sitemap. Desktop uses a sender-verified IPC command boundary and thin client
uses the authenticated `POST /api/ingestion/tasks/execute` boundary. The same
transport-neutral command contract supports create, append, finalize, read,
list, cancel, resume, run, refresh, and expired-checkpoint cleanup operations.
Renderers never receive checkpoint paths or provider credentials.

Local transfers slice each `File` into 1 MiB chunks. Contracts cap a chunk at
4 MiB, a file at 4 GiB, a task at 128 files and 16 GiB, and aggregate checkpoint
growth at 65,536 chunks. The host verifies each chunk digest and offset,
persists authoritative progress, streams finalization without joining the file
in renderer memory, and retains unfinished checkpoints for at most 24 hours.
Retry is idempotent for the last accepted chunk. Cancellation and expiry use a
durable cleanup intent.

When an acquisition reaches terminal success, the shared desktop/thin-client
workflow clears its source-specific form state, returns to the default Files
source, opens the authoritative completed activity in the global notification
dropdown, and scrolls the page viewport to the top. Failure and cancellation
retain the current form state for correction or retry. This UI reset does not
clear the separately host-owned Hugging Face credential setting.

Hugging Face acquisition accepts only an exact commit revision and records that
revision in the immutable source snapshot. Registration copies the
authoritative task workspace into both the artifact catalog record and the
imported-source binding, so a successful task is immediately visible through
the same workspace-scoped Artifact Browser. Selected `.parquet` paths retain a
Parquet media type and the tabular artifact family even when the provider file
listing does not supply a media type. The shared desktop/thin-client UI
uses the existing bounded provider browser: users find a namespace, select
datasets, and check exact files, while the browser resolves and returns each
file's immutable revision. The renderer sends only those returned coordinates
to the governed acquisition task and does not treat the visible selection as
authorization. A Hugging Face user or organization is provider provenance
only; it is never used as the application's organization scope. Before any
acquisition command is evaluated, the host adds its authoritative active
organization and principal context and rejects missing or conflicting context.
A token-only card in Step 2 reads and writes the same
host-owned Hugging Face credential setting as the main Settings area; token
values stay in a password input and credential boundary and are not included in
task commands or diagnostics. Public browsing remains available without a
token. The guided workflow is the only ingestion workflow mounted by desktop
and thin client; legacy import panels are retired from the page. Website
acquisition is intentionally not a crawler: it accepts at most 25 explicit
pages or the first bounded pages
from one same-origin page sitemap, follows no recursive sitemap or link depth,
and processes pages sequentially. Secure egress denies credentials and
private/reserved destinations, revalidates redirects, strips cross-origin
credentials, and bounds redirects, response types, bytes, duration, and broker
concurrency. Website defaults cap HTML at 5 MiB, a sitemap at 1 MiB, robots.txt
at 512 KiB, a request at 15 seconds, and redirects at five. There is no robots
override.

Raw website responses and readable-text extraction are separate immutable
artifacts. Source snapshots record requested and canonical URLs, robots
evidence, capture time, validators, and content digest. Refresh uses ETag or
Last-Modified when available and falls back to the content digest, recording an
append-only unchanged, changed, unavailable, or removed result. Task state and
its source snapshot commit in one structured-persistence transaction; a changed
refresh and its new snapshot do the same. If cancellation or a competing update
wins, newly written artifacts are compensating-deleted before the result is
returned.

## Split integrity

The worker produces an aggregate output plus physical train, validation, and test outputs when their configured shares are nonzero. Counts in the result are derived from those partitions and must sum to the aggregate row count.

Partitioning is deterministic for a fixed seed. Rows connected by the same source/group identifier or exact task-content fingerprint form one component and cannot cross split boundaries. When too few independent components exist to populate every requested split, the worker preserves leakage isolation and returns a bounded warning instead of separating related or duplicate rows.

## Quality policy and curation

Quality-enabled preparation resolves the requested Standard or Strict preset
through a host-owned workspace or organization policy provider before source
staging. Missing policy authority fails closed. The resolved policy preserves
mandatory schema, exact-duplicate, bounded fuzzy-duplicate, sensitive-data,
credential, and split-leakage checks; optional license, consent, language,
benchmark, text-length, and per-source limits may tighten admission.

Standard applies the complete baseline. Strict applies that same baseline with
narrower text-length limits and broader bounded similarity checks, so it can
place more examples in reversible quarantine for review. License, consent, and
source-association rules apply to each prepared example, regardless of whether
the original input was a table row, document span, image record, box, or mask.
They do not assume that every source is tabular.

The exact task determines the remaining checks. Text classification checks
labels and balance; extraction checks requested output fields; embedding and
reranking tasks check positive and negative relationships; diffusion and image
classification check captions or labels; detection and segmentation check
reviewed box or mask annotations. Image metadata and annotations can be
inspected, but the current worker does not inspect image pixels, run OCR, detect
faces, or claim pixel-level personal-data or credential screening.

The worker applies the same checks to provided and generated rows. Rejected rows
enter a reversible, workspace-scoped quarantine with reason codes and source-row
lineage. Review reports contain field, source, class, and language summaries,
accepted and quarantined counts, bounded reason counts, and a small set of
sanitized examples. Raw row values are not review evidence.

## Adaptive preparation

The shared adaptive plan is the authority for input intent, available methods,
the default method, and active controls. One structured dataset is checked and
split without creating a near-copy through document conversion. Multiple
compatible structured datasets are combined, checked, and split. Existing
datasets cannot be mixed with source material in one run.

Document source material offers fixed-length sections, topic-aware sections,
and, when the format carries useful structure, structure-aware sections.
Topic-aware is the default. Fixed-length alone exposes section length and
overlap. Topic-aware exposes topic sensitivity and semantic bounds without a
fixed overlap. Structure-aware preserves headings, tables, pages, and regions
and exposes only bounds used by that strategy. Creating task examples is a
separate generation decision within document methods; it is not another name
for chunking.

Diffusion and image classification can use existing filename/metadata text or
bounded model-assisted metadata. Detection and segmentation require reviewed
existing boxes or masks; automatic geometry creation is not advertised. A
method with only one valid choice is explained without padding the selector
with artificial alternatives.

Every new request carries the resolved execution plan and omits inactive
settings. The application and worker independently reconcile that plan with the
actual staged source capabilities and exact task. Contradictory, mixed-role,
legacy, or unsupported combinations fail closed with a corrective action.
Known legacy presets migrate deterministically only when their meaning remains
safe; ambiguous saved setups are not guessed.

Normalized document regions retain exact artifact, character-span, region, and
page lineage. Text-based PDF pages, DOCX paragraphs and tables, Markdown
sections, sentences, tables, and bounded token windows can be kept together.
Scanned-image text recognition is intentionally reported as unavailable until a
reviewed provider is installed; the system does not imply that image OCR ran.

Semantic curation uses a deterministic, local, bounded hashed-token comparison
before split assignment. It can set closely related rows aside, cap overgrown
sources, interleave sources, measure source coverage, and recommend task-aware
contrast examples. It stores only aggregate scores and bounded lineage pairs,
not embeddings or row text.

Generated candidates must satisfy the selected task schema, cite an exact
normalized source span, meet source-support and diversity thresholds, pass an
independent deterministic critic, and pass safety screening. Failed candidates
enter reversible quarantine with stable reason codes. No generated candidate is
saved into a dataset without the mandatory quality review and explicit user
approval.

Local example creation separates runtime-owned system rules from untrusted
source/task data and from the user-editable task objective. The runtime requests
one versioned, task-bound JSON Schema envelope, validates exact fields, bounds
nested values, and rejects mismatched tasks, extra fields, non-allowlisted
labels, or required passages that are not exact source spans. Validated values
are then assembled deterministically into the selected task profile before
JSON, CSV, or Parquet serialization. Image text generation uses metadata and
reviewed annotations only; it cannot claim pixel inspection or create boxes or
masks.

Advanced users edit that output through a visual field layout, not raw JSON
Schema. They may add, remove, rename, reorder, or nest bounded fields and choose
basic value types and allowed choices. The selected task contributes protected
training purposes, such as instruction, answer, label, query, passage, or
caption; each required purpose must remain assigned exactly once to a compatible
required field. Runtime-owned envelope names, unsafe object-property names,
unbounded recursion, external schema references, and unsupported value types are
not editable.

The shared compiler turns the saved visual layout into deterministic training-
purpose paths and one exact schema used by the prompt, optional token-level
decoder, parser, row mapper, and Parquet writer. This prevents those consumers
from interpreting separate templates. Nested output may be written as JSON or
Parquet but is rejected before generation when CSV is selected. Existing saved
recipes without a layout receive the task's compatible default. Legacy
extraction may continue to use a bounded free-form record for prompt-guided
validation, but token-level constraints remain unavailable until the user names
the extracted fields.

Source attribution is a separate quality-policy choice, not a model-generated
field. When selected, the visual editor shows a locked companion object beside
the model schema so the saved example shape is clear. After structural and
semantic validation, the worker adds the selected source artifact id and only
available bounded source name, sanitized public URL, author, and license values
from trusted source metadata. It never asks the model to invent those values;
when attribution is not selected, the companion object is absent. Prepared
artifact metadata carries the exact schema fingerprint and training-purpose
paths so later training can reject mixed or substituted layouts instead of
guessing columns.

When token constraints are checked, the Python adapter compiles only the
compiler-owned exact schema subset into a model-bound Outlines Core processor.
It masks every next-token choice, requires EOS at an accepting state, and then
parses and validates the same schema. Schema bytes, depth, nodes, properties,
allowed choices, output bytes, and the model-local compiled-processor cache have
hard limits. Any unavailable dependency, unsupported tokenizer or schema,
compilation failure, token dead end, truncation, parse failure, or schema
mismatch fails with a sanitized code and no unconstrained retry. When unchecked,
prompt-guided generation remains available but all strict structural and
semantic checks still run.

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

- Scanned-image text recognition is not installed; use text-based PDF or reviewed
  source text. The UI reports this capability as unavailable.
- Controlled large-file, private-provider, representative public-site,
  advanced local-model hardware, accessibility, and reduced-motion
  qualification remains external evidence; local tests use bounded synthetic
  fixtures and no production credentials.
- Learned embedding providers, visual document understanding, and model-assisted
  semantic critics remain future reviewed capabilities; the implemented
  semantic comparison and independent critic are deterministic and local.

## Verification obligations

Changes must cover capability truth, malformed and oversized inputs, exact
normalized lineage, deterministic split invariants, exact and semantic duplicate
isolation, generated-candidate rejection, workspace denial, provider revision
behavior, cancellation and cleanup, diagnostic non-disclosure, desktop and
thin-client ordered-step semantics, keyboard behavior, and actionable review
results.
