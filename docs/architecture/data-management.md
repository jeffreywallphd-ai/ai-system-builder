# Data Management

The private [provided-data version qualification](../../dev-tools/scripts/qualification/visual-composer/provided-dataset-qualification.md)
composes the real packaged processor and local SQLite adapter for two-host
save, compare, setup reuse and restart journeys. The browser test closes and
reopens complete server resources and its caller-owned SQLite connection;
it does not substitute an in-memory history store or qualify PostgreSQL.
Production host composition and normal qualification entry points are unchanged.

- Status: current
- Related decisions: `docs/adr/ADR-0008-ingestion-and-staged-artifact-semantic-model.md`, `docs/adr/ADR-0009-artifact-identity-and-backing-domain-model.md`, `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md`, `docs/adr/ADR-0040-immutable-dataset-versions-lineage-and-publication.md`, `docs/adr/ADR-0041-context-management-and-portable-context-artifacts.md`
- Verification: `docs/architecture/architecture-verification.md`

This document defines the implemented ingestion-to-dataset preparation
foundation and the rules later curation, versioning, and scale work must
preserve.

## Purpose

Data Management turns workspace-owned source artifacts into training datasets without making users understand storage adapters, runtime payloads, or provider protocols. Desktop and thin-client hosts present the same four-step sequence:

1. **Add data** chooses the exact training goal, then shows only compatible workspace artifacts.
2. **Check data** explains the checks that apply to that goal and source kind, including which content surfaces were not inspected.
3. **Prepare dataset** infers whether the user is using one ready dataset, combining compatible datasets, or creating examples from source material. It then offers only meaningful preparation methods and shows only the Advanced settings used by the selected method.
4. **Review and create** presents bounded, task-specific quality evidence, colocates an optional meaningful dataset save name with the final actions, and requires one explicit approval before the complete curated ready set and its splits are saved.

The primary UI uses goal and outcome language. Adapter names, schemas, prompt payloads, local paths, and provider response details do not belong in the default experience.
Desktop places reusable workflow settings in an unnumbered section before the
four steps. It omits empty task-specific settings. Both hosts keep the save-name
control in Review and create. After successful approval they switch to Artifact
Browser, select the exact saved dataset, and open its detail view for inspection
or optional Hugging Face publication. Dataset Preparation does not embed version
history after save.

Both Artifact Browser detail views now load saved versions through the existing
workspace-authorized clients. Only one exact `dataset` role artifact key may
identify the selected dataset; file names and the newest record are not identity.
History and comparison failures retain visible retry controls. Refresh is also
available for empty and successful history. Publication defaults to private,
requires explicit dispatch, and validates the returned workspace, version,
repository and visibility. Changing publication inputs clears public consent.
Desktop Browser offers setup reuse through a page-owned one-use handoff. Its
Preparation consumer waits for current sources and acknowledges actual settings
application from the resulting form commit. Thin reuse remains absent pending
its complete supported-settings consumer.

Preparation source loading in both hosts distinguishes loading, failed and
successfully ready lists, including a genuine empty result. Add data offers a
direct retry after failure. Source replies are bound to the current workspace,
client and request lifetime; retired reads and errors cannot replace newer data
or user selections. A current successful list is required before task dispatch.
Source read failures retain fixed contextual text rather than overwriting task
progress. Desktop source and version-list replies without an array fail instead
of claiming an empty result. The shared thin-client HTTP source client also
rejects missing or nonarray source items. Its real-client Preparation test covers
safe failure followed by direct retry to a genuine empty list. These controls prepare
for setup reuse; each host must also enforce its page and consumer checks.

The internal Desktop restore hook now validates the exact selected version/file,
complete current sources and every saved setting. It builds a full replacement,
reconstructs the normal request and requires the same normalized meaning before
any configuration setter. The last committed form frame and source request must
still match. Edits, source retry, client/workspace changes, unmount and task start
retire old callbacks; active tasks and reviews retain their progress unchanged.
A successful restore retires that invocation and resets provider destinations to
local-only. This synchronous internal result is not page acknowledgment. Desktop
now carries one bounded frozen ephemeral request through the surviving page,
claims it with an opaque consumer session and acknowledges only from the resulting
committed form render. Edits, scope/navigation changes, source failure and
supersession retire older delivery; no queued navigation, stale panel or canceled
request can announce success. Request data is released after settlement. Reuse
starts no task, model or publication. Thin reuse and actual host/provider/scale
checks remain pending.

The shared Artifact Browser uses the same card presentation for uploaded and
generated artifacts. User data remains previewable without exposing active
content: JSON and JSON Lines are formatted and capped at 100 displayed lines,
Markdown is rendered from an inert element allowlist with raw HTML and remote
images disabled, and Parquet shows at most the first 10 rows through the
workspace-authorized dataset review reader. PDF preview rasterizes only the
first page to a bounded image with the pinned PDF.js parser instead of embedding
the browser PDF viewer. Internal system-build artifacts, including evidence,
provenance, policy, workflow, manifests, and build bundles, remain stored for
traceability but are excluded from both registered and unregistered
user-facing Artifact Browser lists. More generally, any filename or media type
ending in `+json` is treated as internal metadata and omitted. Only ordinary
`.json`, `.jsonl`, and `.ndjson` JSON-family files are user-facing.

For compatible textual datasets, the detail view also exposes **Convert to RAG
database**. That action navigates to Context Management with only the selected
artifact identifier; the Context application boundary repeats workspace
authorization, capability resolution, digest verification, and private
staging. “Already chunked” has a strict meaning: every structured row includes
a valid `chunkIndex` and `sourceLineage` object. Context generation then
preserves those row boundaries and exact lineage instead of rechunking. Other
compatible sources enter the same bounded extraction pipeline used by Dataset
Preparation. See `docs/architecture/context-management.md`.

## Capability authority

The shared dataset-preparation capability registry under modules/contracts/runtime is the authority for advertised source formats and task compatibility. UI selectors and the application guard consume the same registry. When filesystem byte retrieval omits descriptor metadata, staging reconciles the original name and media type from the workspace-authorized catalog record before capability resolution; it never guesses that an unknown object is JSON. A format or task combination must not be shown as available merely because one adapter can recognize its extension.

The implemented source formats are CSV, JSON, JSON Lines, Parquet, text, Markdown, HTML, PDF, DOCX, and supported image formats. Text tasks accept the first nine formats. JSON readers accept one object, an array of objects, or records under `rows`, `data`, `items`, `examples`, or `annotations`; JSON Lines uses one object per nonempty line. The active task profile further limits that list. Legacy DOC, XLS, XLSX, TSV, RTF, ODT, AVIF, and HEIC paths are not advertised. Unsupported or incompatible sources fail before runtime work starts with a plain-language reason and action.

Structured readers enforce bounded file and row limits. The managed worker
probes and repairs an exact patched PyArrow dependency before advertising
runtime readiness so Parquet input and output do not depend on an uninstalled
training-only package. A non-generating structured-data method reports a
structured read or schema failure and never falls through to model-generation
guidance. Automatic local-model placement likewise uses an exact managed
Accelerate dependency that is probed and repaired during startup. Preparation
preflights that component before source generation and returns a sanitized
repair action if it is unavailable; a missing runtime component must not be
collapsed into a misleading zero-example result. Remote Hugging Face selections retain their explicit revision and are localized through the repository and artifact-storage ports before runtime execution. Localization carries the authoritative workspace from the host boundary through binding reads, provider retrieval, local catalog/object storage, and binding updates; it also retains the provider filename for type classification. No renderer or transport performs ambient provider access.

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
wins, newly written website artifacts are compensating-deleted before the result
is returned. Local-file publication instead retains uncertain byte or metadata
effects; a retry cannot adopt, overwrite or delete them.

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
sanitized examples. Aggregate reports never contain raw row values. During the
private review window, an authorized caller may follow a ready, set-aside, or
reason-count line to a separately stored, bounded page of the underlying rows.
That review stream is scope- and exact-report-fingerprint-bound and is removed
with the other contained runtime outputs after approval, cancellation, or
discard.

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

The Generation prompt separates runtime-owned system rules from untrusted
source/task data and from the user-editable system prompt instructions. The runtime requests
one versioned, task-bound JSON Schema envelope, validates exact fields, bounds
nested values, and rejects mismatched tasks, extra fields, non-allowlisted
labels, or required passages that are not exact source spans. Validated values
are then assembled deterministically into the selected task profile before
JSON, CSV, or Parquet serialization. Image text generation uses metadata and
reviewed annotations only; it cannot claim pixel inspection or create boxes or
masks.

Advanced users edit that output through a visual field layout, not raw JSON
Schema. They may add, remove, rename, reorder, or nest bounded fields, choose
plain-language value types, and provide a bounded example value for each field.
Those values form one schema-valid sample JSON output. Instruction is compiled
as a fixed value that the generator must copy exactly; the remaining generated
values guide format rather than becoming enumerated choices. Labels remain authoritative in the Step 1
training-goal settings and are not duplicated here. The selected task contributes
protected training purposes, such as Instruction, Input, Context, Output, label,
query, passage, caption, or the optional instruction-training Thought field.
For new instruction-tuning layouts, Input is the user request while Context is
the supporting source section; they are never combined into one sample value.
The generation schema omits Context, and the worker attaches the current source
section unchanged before validating the completed record. This makes Context a
runtime-supplied evidence field rather than model-authored content and leaves the
evidence-provider boundary available for a future retrieval-backed source.
Each required
purpose must remain assigned exactly once to a compatible required field.
Instruction, Input, Context, Output, and Thought purposes accept text only.
Runtime-owned envelope names,
unsafe object-property names, unbounded recursion, external schema references,
and unsupported value types are not editable.

The shared compiler turns the saved visual layout into deterministic training-
purpose paths, one exact schema, and one schema-valid example envelope used by
the prompt, optional token-level decoder, parser, row mapper, and Parquet writer.
The compiler fingerprint binds both the schema and example so the host and worker
cannot interpret separate templates. The worker retains that fingerprint-validated
purpose-path map through generation, quality admission, reporting, and output
writing; a compiled layout never falls back to legacy literal field names during
quality checks. Pre-quality synthetic or semantic quarantine findings do not make
the schema mapping incomplete unless purpose resolution or required values are
also missing. Every generation prompt requires exactly
one JSON object that matches the runtime schema and forbids prose, Markdown,
code fences, or other text before or after it. In unchecked compatibility mode,
the worker may remove one exact `json` fence surrounding one bounded object
before parsing; prose, partial or multiple fences, non-object JSON, and every
schema or semantic mismatch still fail. Nested output may be written as
JSON or Parquet but is rejected before generation when CSV is selected. Existing
saved recipes without a layout receive the task's compatible defaults. Legacy
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
compiler-owned exact schema subset into a model-bound lazy Outlines adapter.
It masks every next-token choice, requires EOS at an accepting state, and then
parses and validates the same schema. Schema bytes, depth, nodes, properties,
allowed choices, output bytes, and the model-local compiled-processor cache have
hard limits. Any unavailable dependency, unsupported tokenizer or schema,
compilation failure, unsupported runtime, or tokenizer mismatch fails with a
sanitized code. A recoverable decoder/output failure may receive one bounded
correction attempt that retains the same schema and constrained/unconstrained
mode; checked generation never falls back. Every attempt runs the same strict
structural and semantic checks. Grammar serialization preserves the desired
example field order even though its integrity fingerprint remains
order-independent. The private compiler preserves the exact pinned Core regex,
default whitespace and singleton-token string projection, including EOS-alias
removal. Bounded LLGuidance matchers disable forced tokenization and construct
only reached states. Eager Torch operations apply safe byte masks without
importing either backend's optional compiled kernel. The original schema remains
the final validator. See the limits in [Runtime Model](runtime-model.md).

The desktop Python host respects an explicit `PYTHON_RUNTIME_COMMAND`.
Without one, it uses bounded fixed version probes and prefers an installed
Python 3.10 through 3.13 executable, matching the reviewed Outlines support
range, instead of an unsupported platform-default Python. When no compatible
interpreter exists, the baseline worker can still run, decoder capability stays
false, both dataset-preparation hosts keep the checkbox unavailable, and a
stale explicit request fails with a distinct sanitized unavailable code.

Generation preflight validates the physical Transformers snapshot rather than
trusting a persisted model lifecycle label. A usable text model requires its
configuration, complete single or indexed weights, every referenced shard, and
tokenizer files. An incomplete cache remains available for resumable download
but cannot satisfy readiness or model loading. Preflight is local-only and
cannot start or resume network acquisition; an incomplete snapshot stops with a
distinct sanitized reason, and only the explicit model-download task may resume
it. Dataset Preparation exposes that action in the main body of Step 3 rather
than Advanced settings and opens the global notification activity immediately.
The download worker makes three bounded attempts for transient transfer or late
snapshot-validation failures and preserves bounded partial files for a later
resume. Cache cleanup remains limited to containment or configured file/byte
policy failures. Download progress is structured and rate-limited, and the
redundant unstructured stderr progress renderer is disabled. Terminal download
errors distinguish an interrupted transfer from an invalid completed snapshot
without exposing provider exception text. The generation `skip` policy is
limited to source sections for which the model explicitly returns no candidate
or whose generated example remains structurally or semantically invalid after
one bounded correction attempt. That output is rejected, the section is counted
and warned as skipped, and later sections continue. Model loading, constrained
decoder operation, inference, dependency, resource, and unexpected runtime
errors fail the task with distinct sanitized codes and fixed corrective
guidance. A run that produces no valid examples still fails.
The renderer uses non-identifying capacity facts to step an untouched built-in
selection down from Quality (7B) to Compact (3B), then Lightweight (1.5B) when
necessary. Desktop includes currently available system memory so its default
matches the worker's live preflight; server hosts may retain the conservative
total-memory reserve without exposing shared-host utilization. Explicit and saved
choices are preserved. Immediately before construction, the worker compares
physical model weights with currently available CPU and accelerator memory. The
closed model policy permits no system-memory overflow, at most 1 GiB, or at most
4 GiB; desktop defaults to 1 GiB, while omitted non-desktop requests remain
memory-only. The allowance applies only to CPU/automatic placement and never
substitutes for CUDA memory. A larger shortfall fails with a sanitized resource
code. When an allowed shortfall is actually present, the worker records a bounded
`memory-overflow` progress phase and the app shell publishes a deduplicated warning
that disk/swap use may slow generation. Model-status reads remain nonblocking
during a valid load so resource telemetry and global progress continue to update.

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

Readiness, validation, and corrective actions remain inline. After the host accepts a dataset-preparation start (or the renderer begins bounded recovery of an uncertain accepted start), the app-shell notification bridge opens the workspace-scoped notification dropdown and polls the same authoritative task read by request id. Bounded progress and terminal success, review-required, failure, cancellation, or unknown status therefore remain visible after the user leaves the page. The bridge does not duplicate task state or expose raw runtime payloads. Result summaries remain visible on the preparation page and include aggregate, training, validation, and test counts plus the saved destination and bounded warnings.

Topic-aware division applies a minimum semantic section size before treating
low lexical continuity as a topic boundary. This prevents ordinary documents
from degenerating into one generation request per sentence while preserving the
configured maximum token limit and exact source spans. Before the first
generation batch, authoritative task progress enters a `loading-model` phase;
the global notification explains that model loading and the first batch can
take longer. If the live preflight activates bounded system-memory overflow, a
separate warning remains in notification history while ordinary task progress
continues after every completed source section, even when generation retains a
larger configured batch size. These updates expose only bounded counts and safe
phase messages, not source or model output.

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

Dataset presentations group immutable records by dataset identity rather than
rendering one card per version. The newest record is selected by default and a
version selector exposes older records. Presentation labels are derived from
immutable lineage: independent roots receive successive major labels and their
descendants receive successive minor labels. The labels do not mutate stored
version identity or content digests.

The shared review navigator presents actual preparation records and Parquet
rows in desktop and thin-client hosts. Each actionable preparation report line
opens the underlying ready or quarantined records rather than treating the
aggregate report section as a review item. Dataset Review lists only locally
readable workspace Parquet artifacts plus locally readable versioned Parquet
outputs; repository-only entries must be localized before review. Cards expose
separate Review rows and View table actions, the table shows 10 rows per page,
and the modal traverses rows continuously without exposing page controls. Row
values never enter structured persistence.
Rejecting or editing a row requires an authenticated write scope and the exact
index-and-SHA-256 fingerprint last returned to the caller. A stale fingerprint
fails closed. Rejection removes the exact row; editing preserves the columns and
value types while replacing its values. The revised Parquet artifact is written
and verified before an immutable child version becomes visible, and the parent
remains unchanged. The first persisted rejection or approved edit to an
unversioned artifact creates an imported 1.0 baseline followed by a 1.1 child;
each later persisted row change advances the minor label. Version lineage stores
only bounded operation and fingerprint evidence rather than row content.

Final dataset output handles remain in their private runtime working directory
until approval either finalizes successfully or is explicitly discarded. The
accepted-row review stream is copied into bounded workspace-local temporary
artifact storage, verified by SHA-256 on each preview read, and removed from the
runtime directory. It is deleted after approval, cancellation, or discard. A
failed approval remains retryable with the same review fingerprint; final-output
cleanup runs only after terminal success, cancellation, or discard.

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

Parquet dataset review propagates the existing64MiB artifact retrieval maximum and
checks actual returned source bytes before runtime admission. The Python adapter
rejects oversized source before staging, the worker checks staged size before
Parquet parsing, and revised output uses one bounded file-handle read with a growth
probe instead of unbounded readFile. Application output bounds precede hashing
or storage. Output I/O failures have static outward messages. Worker Parquet
handles close explicitly. Footer row counts select only overlapping row groups;
preceding batches use num_rows, and only page slices convert to Python rows.
Exact row fingerprints, curation semantics and workspace authorization remain.
Small installed-PyArrow fixtures qualify these local controls. Compressed-source
limits and display budgets do not bound decoded-cell memory; adversarial decode
memory, host admission fairness, private-stage filesystem identity and physical
resource qualification remain pending. Existing worker queue/deadline controls
remain in force, including the two-hour dataset-review deadline. No new expanded
memory budget, model/provider download or runtime authority is introduced.

Dataset preparation output names are validated in the Python model and again at
task entry, before planning/source/model/generation/output effects. The worker
mirrors the existing host save-name rule: ECMAScript whitespace trimming,128
UTF-16 code units, no path punctuation/control characters, dot/dot-dot or trailing
period. Blank names keep the existing default; safe spaces/Unicode remain valid.
A captured primitive name feeds both row and JSON-report emitters even if a
callback mutates the request. Rejections use static text. The worker's canonical
absolute/non-symlink output-directory check remains in force. These controls do
not qualify source-path authority, parent substitution, identity-preserving native
file operations or controlled resource behavior; those R30 gaps remain pending.
Rollback retains stronger naming denial.

## Optional local generation memory mode

Dataset Preparation carries the default-off versioned memory profile through its
recipe, saved/reproduction settings, request builders, runtime capacity and model
status. Desktop and thin client preserve an explicit selection across reload and
show unavailable/invalid settings instead of silently changing profile or model.
The application rechecks exact worker support before source staging/start.
Optional loading limits weight placement separately from total process memory;
fixed native-model/tokenizer support, resource denial, cached model ownership and
agent-executable qualification are specified in
`docs/operations/optional-low-memory-inference.md`. Existing output validation,
curation, workspace/source authority and truthful running-cancellation behavior
remain authoritative.

Fresh generated uploads record a workspace-owned primary local storage binding
at their verified write origin before catalog success. Desktop/server inject the
binding writer for buffered and streamed uploads with structured persistence.
Distinct create-if-absent operations use each metadata family's revision CAS;
the check is repeated on conflict and cannot fall back to append/upsert. Existing
append/upsert callers remain compatible. Non-authoritative JSON compatibility
does not acquire this conditional capability. This repairs preparation of
new sources without adopting explicit-key/legacy records or relaxing missing-
binding denial. Failed metadata publication reports failure; retained unregistered
owned bytes and native publication/reparse races remain distinct recovery and
qualification concerns.

Uploaded-file and provider task finalization retain stored artifacts after an
uncertain task/snapshot acknowledgement. Error handling cannot infer destructive
cleanup ownership. Recovery reads the existing scoped task, verifies its immutable
definition and exact finalized file/output, then compares the immutable source
snapshot (including the original capture time when reconciling a new commit).
Missing, foreign, changed or unavailable readback fails without deleting bytes.
Explicit cancellation can remain authoritative without adopting an output.

A completed upload retry checks the requested digest and persisted snapshot
relationship before returning. Succeeded tasks are returned without another task
write or checkpoint effect. Failed/cancelled states are not resurrected by cleanup.
Checkpoint-cleanup completion acknowledgement loss reconciles only the exact
intended persisted task; ordinary cleanup failure retains the existing pending
state. Tests use actual disposable bytes/checkpoints and the structured repository
with lost-acknowledgement and conflicting/missing-readback injection.

Resumable local files now use a private versioned per-task/file publication intent.
Bounded checkpoint inspection rejects a bad checksum before reservation, preserving
the existing failed/resume/retry workflow. A fresh opaque candidate and exact
reserved-to-writing CAS authorize one exclusive byte write. The dedicated adapter
checks size/SHA at stream EOF before linking the target and never compensates by
deleting a published candidate. A lost writing/byte acknowledgement remains
recovery-pending, without adoption or another byte write.

Durable byte acknowledgement precedes a separate origin-issued CAS. Only its
exact successfully acknowledged invocation may attempt conditional primary
binding/catalog creation. Lost issuance acknowledgement grants no effect authority.
Recovery from an issued intent reads complete exact origin without creating it;
missing, partial, deleted, foreign or tombstoned metadata remains recovery-pending.
This prevents a retry from resurrecting registration after authorized deletion.
Exact complete readback can reconcile metadata acknowledgement loss. The structured transaction
checks the complete acknowledged output and stable source snapshot, then commits
private receipt, task and snapshot together. Finalized file outputs are immutable;
ordinary task saves cannot bypass publication. Desktop preserves its existing
unprefixed object mapping; server retains organization-prefixed bytes and current
HTTP task admission denials. Preparation queries exact workspace/key metadata and
rejects a mismatched returned record before runtime admission.

These cooperative controls do not qualify native byte integrity after publication,
hostile parent races, protected crash recovery or filesystem/metadata atomicity.
Unknown candidates stay retained. Generic explicit-key/legacy data is never bound
on read or retry; missing committed private receipts cannot be manufactured.
Dataset Preparation's missing/foreign-binding denial remains mandatory. Composed
desktop staging tests use synthetic bytes and a fake runtime, not model inference
or complete UI/native/parent qualification.

## Memory admission notifications

Dataset Preparation memory-admission failures use the workspace notification
center in desktop and thin client, without a duplicate inline memory error.
Desktop preflight denial publishes before dispatch; post-start desktop failures
remain in the existing background task activity. Thin-client observed task
failures publish to notification history. Contextual form validation and other
security/readiness blockers keep their existing presentation and enforcement.

The worker projects only the known memory-failure code and a bounded numeric
shortfall: resource kind (RAM, VRAM or combined), required bytes, currently
available bytes and explicitly permitted overflow. API/IPC and UI normalize
these facts again. Guidance rounds the remaining shortfall upward to MiB after
subtracting already permitted overflow. It describes a point-in-time observation,
not a guarantee that a later retry will fit. Unknown or malformed measurements
use safe smaller-model/retry guidance without inventing an amount. No exception
text, model/source details, filesystem paths, prompts or raw logs enter the new
public field. Existing guards, limits, admission, cleanup and offload opt-in
controls remain unchanged; notifications never authorize a denied model load.

## Ordinary file import and HTTP admission

The shared panel reuses the ingestion command normalizer for the complete file
selection. It checks canonical name/size pairs before create/resume and uses the
same map for byte lookup. Whitespace aliases cannot bypass uniqueness. Unique
canonical names and equal names with distinct sizes remain valid. Ambiguous
saved task entries fail before byte transfer.

The shared Add data panel refuses two selected files with the same name and size
before creating a task. Otherwise its transfer/resume match could choose the
first file twice. It preserves the selection and asks for a rename and reselection;
equal names with different sizes remain supported. Real host journeys cover
multi-file chunked transfer, completion and source discovery after renderer reload.
Observed bounded slices do not establish whole-process memory use.

The exact `POST /api/ingestion/tasks/execute` endpoint uses the existing
`artifact:write` coarse permission, including read/list actions in that
multiplexer. Authentication and organization middleware precede body parsing.
The owning application repeats organization, workspace, task and file checks;
the route permission does not supply resource ownership. Unknown methods/paths
and other unsupported task families stay denied. A read-only task API is not
introduced. Rollback denies this exact route while preserving all application,
byte-integrity, publication and isolation controls.

Ingestion host composition requires organization-scoped documents and the active
organization context provider together. Server application composition connects
its authenticated request scope for explicitly injected scoped stores and for
PostgreSQL. Missing context leaves ingestion unavailable before acquisition;
raw or global document storage is not an ingestion fallback.

## Bounded replaceable OCR provider boundary

[ADR-0046](../adr/ADR-0046-replaceable-local-document-ocr.md) records the owner's
Windows OCR selection. The managed runtime adapter owns `ocr/protocol.py`;
application orchestration keeps its existing runtime and task-registry ports.
WinRT, helper processes and future supplier details must remain adapter-owned.

Immutable source requests and result types preserve exact source SHA-256,
provider/version, language and original page identities. Line rectangles are
finite, positive and inside bounded decoded pages. Total recognized pages,
lines and text are limited. Empty recognition is retained without inventing
text or confidence. Recognized content is untrusted source data, not executable
instructions or diagnostic material.

The protocol and its portable tests are a foundation, not provider readiness.
Windows helper/resource, lifecycle, installed-language checks, normalization,
readiness and host UI wiring still need implementation and actual qualification.
Existing OCR requests remain unavailable until that work passes. Standard
extraction, supported task/source compatibility and accepted model quality stay
unchanged. A future Tesseract or service adapter must satisfy this same boundary
and separately establish its supply-chain, execution and egress authority.

## Private Windows OCR helper protocol

The runtime-owned `ocr/wire.py` encodes only exact bounded request objects and
parses exact readiness/document response fields. Private frames use a four-byte
unsigned little-endian UTF-8 JSON byte length: at most 23000000 request bytes and
2097152 response bytes. Duplicate keys, invalid UTF-8, unknown fields, non-finite
numbers and global page/line/text overflow are refused. Parsed metadata must still
pass the authorized source/provider/language/page check before use.

The Windows helper source has no application/domain/UI dependency and no file,
executable or service selector. It accepts PNG/JPEG/PDF bytes and requires exact ordinal equality between the
requested canonical language tag and the actual engine language. Substitutions,
aliases and tag-spelling differences are unavailable. It validates dimensions/pixels before bitmap decode
or PDF render and retains original selected PDF page numbers. Line geometry is
relative to the rendered pixel page, not original PDF points. Unicode scalar
counts match the Python contract. A managed 110-second wait includes input reads.

The source and a successful SDK compilation supply no native containment,
readiness or product pass. The future owner must verify a trusted built resource,
create its Job membership before execution, bound private I/O and resources,
honor cancellation and prove all owned processes and handles retired. Do not
start or advertise OCR until those native checks and actual Windows/provider,
normalization/capability and both-host UI integration qualify. Existing runtime
task ports and Standard document extraction remain unchanged.

## Bounded Windows OCR process and resource ownership

The managed worker's private OCR transport launches only its fixed installed x64
helper resource. The application/runtime ports and provider-neutral records stay
unchanged. No caller chooses a command, path, environment, URL or fallback.
A bounded manifest binds the raw helper source, executable digest and byte count;
native read leases pin files and ancestors until the process is retired. Missing,
changed, redirected or incomplete resources remain unavailable. The manifest is
trusted build metadata, not a signature against an installation writer.

The owner creates a one-member Windows Job at process creation, starts suspended,
checks membership and 512 MiB process/job commit ceilings, then resumes. Only three
pipe handles are inherited. The environment contains only the Windows directory
variables. The parent bounds time at 120 seconds, checks cancellation, counts and
discards stderr, and caps the private result at 2 MiB plus framing. Successful
return requires the root's native exit, zero active job members, pipe-thread
retirement and acknowledged handle closes. Uncertainty retains ownership and
prevents another request; there is no adoption/reset interface.

Portable tests and the explicit model-free native qualification have separate
roles. The native operator compiles fresh synthetic local bundles using installed
tools, never downloads or enables OCR, and leaves prior runs unchanged. Trusted
build/package composition, provider/readiness/normalization and actual document
and desktop/browser UI qualification remain pending. Standard extraction, model
accuracy and old retained offload data are unchanged.

## Replaceable OCR provider composition

The worker-private `ocr/provider.py` composes the neutral OCR contract with the
fixed Windows transport. The factory has no probe or file/process side effect.
Each recognition checks fresh installed-language readiness, parses bounded frames
and checks exact source/provider/version/language and selected original pages.
Missing platform/helper/language is explicit; response corruption never activates
a fallback. Application/runtime task ports remain supplier-neutral.

The explicit synthetic document operator checks PNG/JPEG, EXIF rotation, selected
scanned-PDF pages, empty results and malformed/size/cancellation paths in fresh
local bundles. It grants no product availability. Trusted development/package
resource composition, normalization and desktop/browser delivery remain pending.

## OCR development and package resource composition

The development-only builder in `dev-tools/scripts/native/` produces the fixed
worker resource from pinned repository source and installed compiler/SDK inputs.
Forge calls it through `generateAssets` before start/package; the existing worker
resource copy includes the output. It has no inward application/domain dependency
and creates no runtime supplier selector. Standard startup remains available on
unsupported platforms or without optional development tools.

Fresh UUID source copies, bounded compiler time/output, exact root retirement,
native input leases and manifest-last publication detect stale or partial builds.
Installed Windows servicing links are permitted only for literal system build
inputs; runtime single-link checks are unchanged. The compiler is a trusted
development tool, not a contained parser for user content. Runtime recognition
retains its creation-time Job, fixed resource and finite limits. Fixed-path and
copied-resource checks do not qualify normalization, readiness, either host's
product journey or the parent roadmap.

## Provider-neutral complete scanned-PDF normalization

The runtime's private `ocr/recognition.py` composes the replaceable `OcrProvider`;
it has no Windows, process, file or transport import. It obtains page one, bounds
the total to 16 and reads exactly every remaining original page with the same
immutable source, ready provider/version and explicit language. Source page
counts cannot change between calls. Aggregate neutral result limits apply after
merging, independently of each private Windows frame limit.

Document normalization has explicit private OCR language/cancellation keywords.
PDF is the only existing application source format that opts in; Standard and
other formats remain unchanged. A bounded immutable read is checked against
regular-file identity, size, modification time and available creation time.
Change time is compared between the two open-handle readings. Cross-API Windows
change-time equality is invalid; see the reproduced
[CPython issue](https://github.com/python/cpython/issues/157671) and
[Python stat semantics](https://docs.python.org/3.12/library/os.html#os.stat_result).
These metadata checks detect observed changes, not hostile path-race isolation.

Normalized OCR line spans use exact Python character offsets and original page
numbers. The attached immutable OCR document retains rendered dimensions and
line rectangles, including blank pages; confidence is absent. Content-bearing
fields are hidden from representations. Text hygiene is not OCR accuracy.
Cancellation and OCR-specific failures bypass ordinary unsupported-file skipping.
Public capability/task integration, source staging and both-host UI evidence
remain required before product availability or parent-roadmap closure.

## OCR staged-source snapshot boundary

The managed-runtime adapter owns private native PDF capture, not source
authorization. Its exact stage/artifact/child/length/digest binding is compiled
only from the application's authorized retrieved bytes. It reuses the OCR
native read lease while keeping the trusted helper-resource factory fixed.
Pinned non-reparse ancestors and a single-link file deny write/delete and
ancestor replacement through the bounded capture. Every close must acknowledge
before bytes return; uncertainty retains ownership and fences successors.
This is neither a child-creation fence nor a retained offload-tree control.
Synchronous disk cancellation is checked between bounded reads. The component
does not make OCR available or qualify public task, capability or host delivery.

Before file acquisition, the adapter queries the explicit drive anchor and
requires fixed local media. Drive-letter syntax is not a network-drive guard.

## Application-owned OCR task source map

The application now compiles the internal versioned map from each authorized
storage retrieval. It copies bytes before later asynchronous catalog work and
uses that same copy for staging, the independent source-integrity hash and
optional version lineage. Both hosts inject the source hasher even when version
storage is absent. Only validated canonical prefixed SHA256 is converted to the
native reader's raw hash representation.

OCR requires explicit structure-aware/layout/PDF-normalization settings and a
language. Missing hashing or the exact worker protocol denies before source
access. Workspace/artifact binding and catalog scope checks remain authoritative;
caller maps and metadata cannot supply source identity. All selected sources must
be PDFs of 1 byte through 16 MiB. Generated ordinal names are short and omit
private display titles. Standard staging keeps its existing behavior.

The map grants no reader readiness. The managed preparation task consumes it as
described below. App controls, desktop/browser journeys and full packaging remain
agent-owned implementation and qualification work.

Fresh OCR staging retains a private owner before allocation or removal. Cleanup
uses one terminal result per owner; rejected or synchronously thrown effects
retain the owner and prevent admission across use-case instances. Task maps clear
only after confirmed cleanup. OCR starts use a fresh host-issued identity and
require the same request identity in the response. Ambiguous or missing start
acknowledgements preserve files, exact request/promise and real task reservation.
They cannot be interpreted as proof that no worker ran. This is process-local
failure containment, not durable crash recovery, worker retirement or an old-tree
recovery path. Public errors contain no private paths or source-map diagnostics.

## Managed scanned-PDF preparation

`ocr/task_sources.py` validates the complete ordered host map before any task file
or model access. The API validates it before resolving the output directory, and
direct preparation validates it again. Strict OCR/layout booleans reject coerced
strings and numbers. Bindings select PDF capture independently of display names;
the structured-source loader and metadata-only OCR read path cannot run here.
Native capture checks the exact bytes and closes its read leases before recognition.

The Windows capability identifies protocol support, without an engine probe on
ordinary startup. Every recognition checks the installed reader and exact chosen
language. Successful reports contain actual supplier/version/language and complete
document, page and line counts. The extraction score describes text hygiene; it
does not estimate OCR accuracy or supply a confidence value.

Long lines split within character and word-estimate limits while retaining exact
Unicode code-point offsets and original page identity. Actual model tokenization
keeps its existing input bound. Quality, critic, diversity and review checks remain
active. Cancellation is cooperative between completed operations, and the worker
keeps the task running until those operations unwind. A failed native retirement
does not count as cancellation. Synthetic generation fixtures test task plumbing;
they grant no model-quality, app UI, packaging or parent-roadmap pass.

## Scanned-PDF preparation controls

Desktop and browser preparation share an optional scanned-PDF control. It starts
off. Choose Document-structure sections, select only PDFs of at most 16 MiB each,
and enter the exact installed Windows language tag. No language is guessed or
installed. The task checks the reader and language before recognition; startup
and form rendering do not probe them. Protocol support alone is not readiness.

The shared contract validates raw flags, language syntax, method, source count and
the complete renderer source-format selection before dispatch. Request builders
include the language only for an explicit valid opt-in. Public commands contain
no internal source map or staging data. Application authorization and exact
host-compiled byte bindings remain authoritative and are rechecked independently.

An explicit method or training-goal change turns recognition off. Adding an
incompatible source keeps a checked choice visible and prevents submission until
the user corrects it or turns it off. Running-task controls stay locked until the
observed terminal result. Desktop named settings and workspace drafts retain a
valid explicit choice; old settings default to off. Invalid saved flags cannot
activate or silently downgrade recognition. Version reuse refuses missing or
non-PDF sources before changing the current form. Browser page loads start off.

Review shows actual recognized document, page and line counts and the language.
The text-character check measures replacement/control-character hygiene, not OCR
accuracy or model quality. Fixed bounded labels replace raw supplier identity.
Portable form tests use declared synthetic clients. They do not replace actual
native recognition, both-host task journeys or complete package qualification.

Scanned-PDF recognition accepts at most 16 pages per PDF. Split a longer PDF
into smaller source files before using recognition. A version replay must retain
the exact structure-aware/layout/Markdown settings and a compatible training goal;
an explicit saved plan cannot bypass those checks.

## OCR delivery qualification

The controlled OCR test entry imports the actual newly packaged worker. Both hosts
retain their production Python dependency preparation and authenticated task
lifecycle. Only bounded deterministic generation is substituted. A shared
Playwright journey covers file import, explicit language selection, unavailable
language, actual recognition facts, review, approval/reload, cancellation/retry
and source visibility in a second workspace. The fixed launch plan uses relative
arguments from the real worker directory so repository paths with spaces do not
change the existing host argument-tokenization contract. Default controlled Node
worker journeys are unchanged.

Source-bound package/resource, native cleanup and host observations are separate
from portable component tests and model accuracy. See
[OCR qualification](../../dev-tools/scripts/qualification/visual-composer/ocr-qualification.md).

The guided local file selector also lists PDF source material. Its missing-MIME
fallback identifies a PDF extension without changing raw-byte ingestion, backend
policy or authoritative PDF recognition. The focused regression captures the
original excluded-PDF failure and corrected bounded transfer behavior.

Both hosts associate preparation-method captions and help separately. The shared
OCR language field does the same for its caption, recognition limits and language
guidance. React-generated IDs preserve each form's associations without changing
task settings, authorization or readiness. Exact-caption host queries and focused
description-association regressions cover this behavior.

## Saved preparation setup validation

`modules/ui/shared/dataset-version/datasetVersionReplay.ts` is a pure shared
integrity check for the ADR-0040 saved-version reuse path. Before any form change,
it validates the exact selected workspace, requested version, dataset identity,
complete-dataset artifact key and canonically normalized immutable lineage. Each
ordered source ID must match one current authorized source-list row with the
same logical storage key and compatible source capability. Metadata has no byte
digest; this check does not authorize or prove current source bytes.

`projectDatasetVersionReplaySources` selects all observed matching lineage IDs,
including incompatible duplicates in their original order. The 256-row bound
applies to matching rows, not unrelated workspace files. Oversized matches,
malformed records and accessors deny the whole projection. It proves neither
catalogue completeness nor authority; a first match, map or page is not proof.

Both apps' ordinary browse remains capped at 250. Saved setup reuse instead captures
a bounded frozen request, rejects observed duplicate/conflicting rows, and resolves
at most 100 unique exact source keys through the existing workspace-authorized
artifact-detail operation. Reads are sequential with a 15-second whole-batch
deadline and current page/client/frame checks before and after every await.
The returned locator must equal the requested canonical key; the source ID is
derived from that locator. A missing non-key legacy ID has no such identity proof
and is rejected. Metadata lookup does not read source bytes or contact providers.
Both transports use shared `readDatasetVersionReplaySources` for these limits and
safe metadata projection. Timeout stops the caller and later reads; it does not
cancel an already-issued read-only transport request.

Resolved options stay private until complete replay validation and the actual
persisted request roundtrip agree. Only then may one current setter transaction
merge the validated sources and replace the form. The consumer acknowledges an
async result only after the resulting form commit. Input, navigation, workspace,
client, source retry, task start and disposal retire stale work without late
form/option writes or progress changes. An unchanged selection filter preserves
its array identity, so a source-ready housekeeping render does not cancel a valid
lookup. Actual host/provider, scale-runtime and parent qualification remain separate.

The helper reads the actual finalizer snapshot: recipe, optional advanced
configuration, split, output format/name and form-supported quality choices.
Snapshots containing only operation or split metadata are not reusable setups.
It validates every supported active setting before returning a complete deeply
frozen value. Inactive settings have canonical absence, without merging current
form values. Missing optional settings use contract defaults. Explicit unknown or
contradictory values fail as a whole. An explicit saved execution plan must equal
the full canonical method tuple; it cannot bypass OCR or source compatibility.

The current methods can replay standard legacy recipes and current topic-aware
or structure-aware producer configurations. A historical advanced recipe whose
fixed layout, curation or critic settings cannot be expressed by the current
form is rejected rather than silently changed. OCR replay requires exact
structure-aware/layout/Markdown settings, only PDF inputs and a valid explicit
language. It does not establish installed engine or language readiness.

This component performs no I/O, dispatch, notification, persistence, provider
operation or form mutation. It returns no destination or historical approval
authority. Reuse still needs page-owned request freshness, ready source state,
one-use consumption and an applied/not-applied acknowledgment in both apps.
Both apps now connect the real Browser panel and Preparation consumer through
the shared ephemeral handoff. Thin rebuilds its actual command and checks identical
normalized meaning before any setters. Its smaller form rejects unsupported
values, including split seeds or disabled shuffle, CSV/JSON output, strict
normalization, nondefault chunk-boundary/count settings and unsupported generation
parameters. It does not silently replace them with defaults. Both apps preserve
explicit saved output layouts through the restore commit's defaulting effects and
observed conflicts and active-task/review state. Whole-host journeys, publication
and parent qualification remain separate from these local component checks.

Saved omissions retain implemented worker behavior: batch size 1, maximum new
tokens 256, no explicit temperature/top-p override, no overflow permission, and
strict document normalization. An omitted generation failure policy follows
normalization (best-effort skips; strict fails). Explicit null is invalid, not
an omission. Current thin-client duplicate prompt/memory/model form fields are
accepted only when consistent with the primary recipe and are not returned as
a second source of authority.

An omitted shuffle flag keeps the worker default (off). Task mappings and
prompt styles that the current forms cannot express are rejected; labels that
contain a comma are also rejected because the form uses comma-separated labels.

Generation inference mode must be present. Historical omission requests worker
discovery, but current forms serialize an explicit auto mode that the application
normalizes differently. Reject that missing meaning instead of selecting chat.

### Add data session and cancellation presentation

The shared Add data renderer scopes a form session to its workspace, task client
and source-browser client. It admits one synchronous start/retry owner, fences
late responses and commands after replacement/unmount, and validates response
workspace/task identity before local progress or notifications. This presentation
guard does not replace application authorization or cancel an accepted host task
on navigation. Host-owned work and persisted checkpoints remain authoritative.

Cancellation is confirmed only by a matching terminal task response. Failed or
nonterminal cancel responses keep admission closed and expose an explicit task
status read. Early cancel waits for task identity; duplicate control requests
are refused and old progress cannot replace the confirmed outcome. Local files
retain the existing bounded slices, chunk integrity and finalization protocol.
Actual host/provider/native and final cross-roadmap qualification remain separate
from deterministic renderer/client-fixture tests.

Session retirement runs in the layout cleanup of the committed tree, before
passive effects. This closes the commit-to-passive interval for late completion
and notification effects without changing accepted host task ownership.

### Browser preparation session and review ownership

The browser Dataset Preparation form replaces its session when its workspace,
artifact client or preparation client changes. Layout cleanup retires the old
form during commit. The narrow typed preparation client checks that session
before dispatch and after reply. Client replacement cannot continue an old poll
or publish an old approval through the new form. Accepted backend work is not
cancelled merely because the form closes. UI imports use the owning shared
Data Management, Dataset Review, notification and workflow families.

Synchronous admission prevents duplicate starts and review mutations before a
busy render. A confirmed active task stays owned while status reads fail, return
another task or report Unknown. The form continues observation and cancellation
instead of admitting another task. A matching terminal result ends observation.
Task and approval replies must name the requested task. Prepared review pages
must match the requested line and page; a local review/page sequence prevents an
older reply from replacing a fresh review. Unconfirmed discard retains review.

Unexpected transport exceptions use fixed copy. Existing memory denials retain
the notification-center path and bounded memory-shortfall suggestions. No RAM,
VRAM, disk, OCR, quality, model-loading or worker policy is changed. Focused UI
cases cover all nine training goals with explicit structured-source commands,
including labels, extraction strictness, image concept, box and mask settings,
80/10/10 splits and mandatory quality review. These client fixtures do not prove
physical transformation or model accuracy. Real host and final testing stay
separate; completed model quality and OCR evidence is retained.

A review-required result retains task ownership until its quality report and
review state exist, the state is review-required and their fingerprints match.
Incomplete or inconsistent evidence keeps observation and Stop preparation
available. It cannot admit a fresh start, save or review-page request.

## Composed website acquisition test boundary

The focused website-acquisition UI fixture mounts the current shared Add data
panel with both production host clients. It composes actual preload/registered
IPC or loopback HTTP, the command and website use cases, the structured
acquisition repository and new filesystem artifact storage. Explicit pages and
a single sitemap each produce two synthetic captures, with exact raw/readable
bytes reopened through a fresh storage adapter and immutable source metadata.
The fixture also checks same-task retry, safe capture errors, foreign-task denial
and cancellation while a capture is held.

Capture and access policy are finite offline fixtures. The structured document
store is the real in-memory adapter; it does not qualify durable database restart.
These checks do not qualify real URL resolution, robots policy, HTML extraction,
production authentication, physical hosts, native races or final combined tests.
The existing refresh command remains an application/API capability. The guided
panel has no refresh control; application refresh tests are not UI evidence.

Website compensation now removes the catalog entry for a known newly created
capture only after its corresponding byte-delete result succeeds. Both hosts
wire the existing canonical catalog-delete port. A failed byte cleanup keeps
its catalog evidence. A failed derived write compensates only the successful
raw output. Old committed snapshots and unknown resources are not cleanup
inputs. This local correction does not qualify crash recovery or uncertain
cleanup; existing task compensation failures still require separate evidence.

## Browser artifact read and deletion ownership

The browser Artifact Browser scopes list and preview responses to the current
committed workspace/client lease. Layout cleanup retires the exact lease before
passive effects; a suspended replacement cannot invalidate the committed view.
Monotonic read identities discard superseded replies.
Changing scope clears selection and typed deletion intent. A shared synchronous
guard admits one single or bulk delete until all dispatched requests settle.
Deletion retires earlier reads, so late previews cannot hide a failure. On a
partial bulk failure, the UI refreshes authoritative records and retains only
failed targets for explicit retry. An accepted host deletion continues after
navigation; its old reply cannot refresh or notify another workspace.

The composed feature test mounts the actual browser UI and secure HTTP client
with registered routes, application use cases, JSON catalog/bindings and fresh
filesystem objects. It checks text, CSV, JSON, JSONL and inert Markdown previews,
hidden internal metadata, workspace isolation, exact confirmation, duplicate
admission, failure retry, delayed replies and partial bulk outcomes. Access and
scheduling are finite synthetic fixtures. A separate client-boundary fixture
checks retirement before passive cleanup; a suspended-render case retains the
committed view. Physical browser/image/PDF decoding,
production authentication, SQLite/restart, provider publication and native
recovery remain separate qualification. The current browser has Refresh and
selection controls; desktop search/filter/paging requirements are not claimed
as browser UI behavior.

## Desktop Artifact Browser request lifetimes

Desktop list ownership includes the workspace, client and current type/storage
filters. Each committed layout owns a fresh lease; cleanup retires that exact
lease. Reads also carry an ordered request identity. Selection ownership uses
the workspace/client and an ordered selection identity, including continuation
checks before content/media reads and after image/PDF preparation. Orphan
object URLs are revoked through the existing renderer cleanup path.

The detail popup checks its own committed scope and request identity after
selection and Parquet reads. A suspended replacement cannot retire the visible
view. Single registered/unregistered deletion uses one synchronous pending
owner, preserves exact confirmation after failure and reports completion only
to its original current scope. Leaving the view does not cancel accepted host
work. Existing application authorization and local cleanup order are unchanged.

Composed component tests use default desktop clients, actual preload/registered
IPC and application/catalog/filesystem implementations. They assert exact
rendered text, CSV, JSON, JSONL and Markdown, actual type/storage filters, hidden
metadata, workspace refusal, deletion retry and delayed/suspended/retired view
behavior. Sender admission, disabled provider/settings operations and timing
are finite fixtures. Physical Electron, production access, SQLite/restart,
image/PDF decoding, live providers and native recovery remain separate checks.

Deletion captures the selected target, committed lease and selection sequence
before dispatch. Completion clears only that exact selection; choosing another
artifact or choosing the same artifact again creates a new selection. A newer
preview is a retained snapshot, not proof that deleted bytes still exist. Clearing
the current selection also closes its detail popup.

After a current-workspace deletion succeeds, refresh uses the latest committed
list callback. Changing type or storage filters while deletion is pending cannot
leave the removed item in the displayed list. The callback is updated in layout,
never during an uncommitted render; the existing workspace/client lease check
still prevents refreshing another view.
