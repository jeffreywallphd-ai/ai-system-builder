# Application Use Cases

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Use cases in this folder own application orchestration and remain adapter-agnostic.

- Governed ingestion task use cases
  - persist workspace-scoped progress before reporting it to clients;
  - accept idempotent bounded file chunks and finalize through an async stream;
  - retain retryable checkpoints for 24 hours, then expose bounded stale-task cleanup;
  - register Hugging Face files only at immutable commit revisions and retain
    completed items when a later provider item must be retried;
  - carry the authoritative task workspace into both the imported artifact
    catalog record and its source backing before reporting provider success,
    and infer the Parquet media type from a selected `.parquet` path when the
    provider listing omits it.
  - resolve bounded page or sitemap scope through secure egress, preserve raw
    website captures separately from derived readable text, and append honest
    source refresh outcomes from validators and content digests;
  - commit task/source lineage atomically; uploaded/provider artifacts survive
    ambiguous metadata acknowledgement and cancellation races;
  - publish local files through an exclusive private reservation, durable byte
    acknowledgement, one acknowledged origin-issued metadata attempt and exact
    conditional primary origin; recovery never recreates missing/deleted origin.
    Checksum rejection
    before reservation preserves the normal resume workflow, while uncertain
    writing stays recovery-pending without adoption or destructive compensation.

- `StoreArtifactUploadUseCase`
  - validates upload input at a basic, honest level,
  - delegates artifact persistence to `ArtifactStoragePort`,
  - emits structured start/success/failure events through `LoggingPort`,
  - returns a narrow descriptor-based result aligned to upload contracts.

- `LocalizeArtifactFromRepoUseCase`
  - requires authoritative workspace context and carries it through binding
    reads, provider retrieval, local object/catalog storage, and binding
    updates;
  - retains the provider path as original-file metadata so localized Parquet
    and other typed files keep their correct name and artifact family;
  - fails closed before provider or storage work when workspace scope is
    missing.

- `PrepareTrainingDatasetFromArtifactsUseCase`
  - validates bounded source selection, task, split, and output settings before
    staging;
  - validates optional advanced content, semantic, and synthetic settings,
    denies unavailable capabilities, and requires quality review for generated
    candidates;
  - resolves workspace-scoped local bindings and explicitly localizes supported
    remote repository sources;
  - compiles a private OCR source map only from copied, authorized PDF bytes,
    with exact length and SHA256, short generated names and an independent
    source hasher in both hosts; requires explicit language/structure-aware
    settings and the exact worker protocol before source access. Caller runtime
    maps cannot grant authority. Public OCR remains unavailable until worker
    consumption and actual app delivery are qualified;
  - retains a private process-wide owner after unknown OCR allocation, cleanup
    or task-start effects. A cleanup attempt is terminal and never retried;
    recorded task/stage maps clear only after confirmed filesystem cleanup.
    Ambiguous starts keep their files and exact host-issued request identity.
    This does not claim durable crash recovery or native/task retirement;
  - owns asynchronous task start/read/cancel orchestration and enforces recorded
    workspace plus optional organization ownership;
  - validates and materializes role-tagged aggregate/train/validation/test
    outputs through storage/provider ports without exposing runtime paths.
  - returns bounded advanced readiness and aggregate review evidence without
    exposing source text, embeddings, prompts, or generated candidate text;
  - reads separately contained accepted or quarantined records only through
    fixed 10-row, scope- and report-fingerprint-bound pages, with byte, line,
    field, depth, and display-value limits and no runtime-path disclosure;
  - resolves requested quality presets through a host-owned policy provider and
    fails closed when policy authority is unavailable;
  - validates bounded quality reports and reversible quarantine evidence,
    withholds final dataset outputs while review is pending, and materializes
    them only after a one-time scope- and exact-fingerprint-bound approval;
  - compensates partial materialization and cleans report, quarantine, and
    contained runtime outputs on discard or cancellation.
  - when dataset-version composition is available, retains exact source
    digests, writes and verifies complete local outputs plus an immutable recipe
    snapshot, inserts the version record last, returns its stable identity, and
    compensates dataset/split artifacts if finalization fails.
  - stores the exact optional advanced recipe in that immutable snapshot so
    reproduction can restore the selected preparation style without silently
    substituting a currently unavailable capability.

- `ContextGenerationUseCase`
  - validates bounded RAG or Markdown context-pack requests and reauthorizes
    every selected workspace artifact before private staging;
  - owns asynchronous start/read/cancel orchestration, task ownership, exact
    source/result digest verification, and contained runtime-output validation;
  - returns successful generation as a review-required candidate and writes
    nothing to durable artifact storage until the user explicitly saves;
  - saves with artifact-first catalog and local-binding finalization, compensates
    partial failures, and lets discard remove the staged candidate without
    creating an artifact.

- Dataset-version read use cases
  - authorize the exact workspace before listing, comparing, or reproducing;
  - compare two versions of the same dataset using bounded source, row,
    artifact-role, recipe, policy, and documentation changes;
  - retrieve the bounded immutable recipe artifact, verify its exact digest,
    and return the saved setup plus stable source artifact ids without exposing
    source rows.

- Dataset-review use cases
  - list only locally readable workspace Parquet artifacts and locally readable
    immutable version outputs; repository-only or stale catalog records remain
    unavailable until localization restores workspace-owned bytes;
  - read bounded row pages without placing row values in structured persistence
    and bind rejection or editing to the exact version, artifact key, row index,
    and returned row fingerprint;
  - preserve the parent artifact, create an imported 1.0 baseline when needed,
    and make each approved edit a new immutable minor version; replacement row
    content stays out of version records.

- `PublishDatasetVersionUseCase`
  - authorizes the exact workspace operation and relevant provider scopes;
  - defaults to Private, requires destination confirmation, and requires a
    separate confirmation before Public publication;
  - verifies every immutable local artifact before one bounded provider commit;
  - records append-only success evidence only after an immutable provider
    revision is returned, leaving the local version intact on every failure.


Workspace summaries resolve the persisted active workspace and authorize before
protected group reads. A group failure preserves independently available metrics.
Dataset summary counts share the review journey's logical identity, Parquet and
local-availability rules, while avoiding unrelated raw artifact/catalog/content
reads. Neither summary operation finalizes model downloads or starts a runtime.

Image-generation request bounds are pure shared contracts used by the application
and ComfyUI runtime/mapper. Effective selected host defaults are checked before
supervisor startup, reference preparation or prompt submission. Existing limits
remain:10000-character positive/negative text,64..4096 dimensions,16777216 pixels,
1..200 steps,1..8 images, finite CFG(0,50] and denoise[0,1], at most3 face references.
Invalid batches are rejected rather than floored. Primitive/descriptor checks reject
coercion and accessors; engine hints are bounded JSON data, and seeds are safe
integers. Workspace authority, queue/history limits, deadlines and truthful
cancellation remain intact. These caps do not prove combined workload GPU capacity,
per-actor fairness or physical model qualification; those remain pending.
Admission consumes one detached descriptor-safe request snapshot before authority,
model, runtime-start or reference-preparation awaits. Nested reference collections,
reference identities and hint data cannot change through caller-owned aliases after
validation. Prompts retain their exact allowed content; display sanitization is not
used to construct runtime input.

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

Website compensation uses the existing optional artifact catalog-delete port
when stream storage also registers output. It removes only current-call capture
keys, after successful byte cleanup. A byte failure retains catalog evidence;
a derived-write failure compensates only the raw output. This does not change
registered user deletion, old source snapshots or native recovery policy.
