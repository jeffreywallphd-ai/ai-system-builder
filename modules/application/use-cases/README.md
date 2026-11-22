# Application Use Cases

Private `ReadHeadlessModelTrainingModelUseCase` reuses the authorized Model
metadata owner and persisted-only point reads to select a saved local reference.
It retains original actor/client/host and read policy, captures reader methods
before waits, and compares both metadata and the private reference before return.
It never uses discovery, ordinary record resolution, ModelWrite, files, providers
or runtime ports. Its detached frozen path-bearing result is private execution
preparation, not a public tool response. It checks no installation, Model bytes,
native custody, compatibility, resources or license rights, and grants no training
or save approval. The narrow feature check includes actual Core/SQLite cases;
the controller executes those assertions and the paired type check.

Private `ReadHeadlessModelTrainingDatasetUseCase` reads actual saved Dataset
training/validation and recipe bytes under original current authority. It reuses
the authorized exact-version reader and scoped storage with explicit byte limits,
checks copied content length/SHA-256, and rechecks immutable version metadata.
A declared split requires training shards; held-out test, aggregate, source,
report and quarantine files cannot substitute. An unsplit dataset can train.
The result contains private detached byte copies for a future execution owner,
never a public tool response, approval or durable file fence. Model-byte,
compatibility, runtime/resource, rights and quality checks remain separate.

`PrepareHeadlessModelTrainingPlanUseCase` binds supported task/method/settings
syntax and a safe output name to exact saved Model and immutable Dataset-version
metadata. It reuses `PreviewHeadlessModelTrainingInputsUseCase`, retains original
actor/client/host and callbacks through return, and freezes a deterministic
proposal digest. Neither owner has a runtime, installation, provider, file,
training-task or write capability. Metadata and settings syntax leave bytes,
compatibility, resources, rights and quality unchecked. Exact training approval,
installed-only execution and separate result saving remain required; private
proposal construction does not advertise or enable a public plan operation.

Private `ModelDownloadTasksUseCase.readApprovedSource` and `cancelApprovedSource`
require the original accepted source descriptor, exact manifest digest and actor
and workspace ownership. Stop additionally requires explicit ModelWrite authority.
They reuse that descriptor's captured source task; an ordinary/shared task cannot
substitute and observation never registers the model. Hosts still prove original
client/host ledger ownership and current policy. Existing ordinary methods retain
their behavior; these methods do not expose a public Headless route.

`PrepareHeadlessModelDownloadPlanUseCase` copies a strict exact-source proposal,
captures original actor/client/workspace/host and source-read controls, and
independently matches the existing provider preview and canonical digest. It
rejects active values before reflection and retains original callbacks across
awaits. Unknown/non-open license metadata remains declared data, not rights.
Its frozen output still requires download approval and byte/runtime checks.
It has no transaction, filesystem, task, runtime or registry dependency. Future
hosts must prepare provider metadata outside their owned proposal transaction,
then bind that exact preparation under fresh original scope inside it. This
component alone enables no public transfer or registration capability.
Its file-transfer profile is public without credentials; saved access remains
metadata-only, and private/gated acquisition stays unavailable. Native stop or
cleanup uncertainty remains unconfirmed rather than receiving deadline credit.

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Private Model source admission can also carry an original synchronous
`isAdmissionCurrent` callback. Capture it before awaits, require literal true
after each admission await and immediately before source-port entry, and reject
active/asynchronous callbacks. Its lifetime ends at admission; accepted custody
retains the separate original host/business controls. This closes caller
revocation during the final post-ACK policy check without losing an admitted
outcome or changing existing internal callers that omit the optional fence.

The private `ModelDownloadTasksUseCase.peekApprovedSourceReview` reads only the
original captured cached completion after accepted successful terminal source
work. It checks exact actor/workspace ownership and original host lifetime before
and after awaits, validates model/pin/manifest/download confirmation and returns
detached frozen finite historical metadata. It never returns the cache path,
refreshes worker status, inspects files, registers or retires a source. Historical
selected-byte verification does not establish current file authority, model
readiness or license rights. Ordinary source completion still refuses automatic
registration. The eventual headless host must independently enforce the exact
ledger client/plan and current ModelRead/publication policy; former ModelWrite
is not a read grant or requirement. Public host/task/save integration stays pending.

`PreviewHeadlessModelSourceUseCase` prepares a source through the private Model
port. It captures exact actor/client/workspace/host and copied request targets,
requires fresh current permission before provider work and egress, and supplies
trusted page/credential policy controls. A four-second public budget fits the
retained five-second Desktop/SDK routes; the private default remains20seconds.
The result hashes normalized provider metadata, keeps byte/runtime checks pending
and always requires separate download approval. No task, download or runtime
owner is available to this use case.

Use cases in this folder own application orchestration and remain adapter-agnostic.

Pinned Model downloads carry one strict copied revision through both synchronous
and asynchronous lifecycle paths. Registration requires matching worker-confirmed
revision and model identity. Missing/changed confirmation is not a successful
download and cannot create a model record. Saved provenance records that source
selection only. Ordinary unpinned requests, scoped completion authority, explicit
retry and terminal task ownership retain their existing behavior.

`ReadHeadlessModelMetadataUseCase` is a private persisted-only metadata owner.
It binds the captured organization and current principal/workspace, copies the
request, disables discovery/shared storage on inventory reads and requires the
recorded-only point lookup without a legacy fallback. Current policy surrounds
reads and outward projection. A captured synchronous liveness fence and actor
check run at the actual read/return handoffs after each awaited policy gate.
Adapter Proxies are rejected before owner reflection, including nested tags.
It selects own data descriptors for declared
metadata; private path/card/metadata fields are not evaluated. Contaminated,
malformed or revoked responses expose no partial inventory. It has no runtime,
provider, task, filesystem or write port. This component alone supplies no public
Headless operation, verified supply/readiness or parent roadmap pass.
The bounded `headless-model-metadata-owner-unit` and
`headless-model-metadata-owner-types` checks cover this component and related
model/read-contract compatibility. Their exact source mapping retains generic
verification for unknown paths or an explicitly requested generic check.

`ReadHeadlessDatasetMetadataUseCase` minimizes the existing authorized dataset
point-read and comparison results. Its host supplies current plan-review authority
around each read. It admits at most 16 sequential point reads and never scans
history. Exact tenant/workspace/dataset/version checks precede the bounded
projection; raw recipes, documents, storage keys and source contents stay inside
the application. It starts no preparation, runtime or publication task.

`PrepareHeadlessDatasetInputsUseCase` privately maps exact completed local
source references into the existing provided-row preparation command. It checks
current authority and source lineage, bounds files, bytes and mapping fields,
and preserves workspace quality policy and review. Its preview contains no
source content or storage key. This metadata-only compiler grants no public
transport, runtime admission or dataset save authority.

`startAdmittedLocalProvidedDataset` reuses the existing dataset processor through
a separate trusted admission parameter. It verifies bounded local bindings and
copied source bytes against expected format, media, digest and size. Worker
filenames are internal and descriptor metadata cannot retarget parsing. Source
denial starts no runtime; acknowledged issuance precedes warming and the exact
host-issued task call. Changed app authority gates future transport replies,
while host shutdown prevents new runtime calls. Uncertain effects and failed
cleanup retain their lifecycle slot until successful owned-runtime stop and
cleanup. No durable issuer or public host/MCP execution is provided by this method.

Training start failures can carry a fixed `MODEL_TRAINING_START_*` diagnostic code
for request validation, runtime readiness, base-model lookup, dataset resolution,
task dispatch or task registration. The original error object, message and cause
remain intact. Existing codes, typed denials, frozen errors and proxy values are
not changed. These labels grant no runtime readiness or task acceptance.

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
  - report an exclusive website file conflict without failing the shared task
    or adopting the existing files;
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
a derived-write failure compensates only the raw output. When the save response
is lost, exact task or refresh records and the matching snapshot confirm success.
Keep files when the outcome is uncertain. Initial capture may clean its files
after confirmed terminal cancellation with no saved snapshot. Registered user
deletion, old source snapshots, and native recovery policy are unchanged.

Headless local dataset preparation compiles exact saved local references and uses the existing `PrepareTrainingDatasetFromArtifactsUseCase` through a trusted one-use admission. `ReadHeadlessDatasetTaskStatusUseCase` requires a durable accepted association before requesting the owning processor's passive status. Passive reads do not materialize, approve, save or clean up outputs. Worker success remains distinct from application result review, failure and cancellation.

The private training reader refuses selected keys that also name excluded
artifact roles or source lineage. Selected train/validation SHA-256 digests must
also differ from recorded held-out test digests, including under alternate keys.
This check reads no test bytes and proves neither row-level separation nor fresh
test-content or model quality. A different versioned source or aggregate key
can legitimately contain the same bytes as a training shard.

### Run-local training image copies

The existing training use case keeps one private staged copy per source image ID
inside each invocation. Every reference still rereads its actual workspace local
binding. A changed locator or changed staged-file identity denies before dispatch;
no metadata binding is invented or adopted. Source filenames use unique per-run
ordinals, so separate source IDs with the same basename cannot collide. Repeated
references use the exact original path string, matching the worker's unambiguous
source-map rule. There is no cross-run cache or source overwrite.

Fresh copies retain existing source-count and 64 MiB file/256 MiB aggregate
budgets. Charge physical bytes once per created copy. Reuse checks regular-file,
single-link, canonical path/device/inode/size/timestamp/mode facts. Existing input/
output root identity and uncertain-start retention still own cleanup. These are
read-time known-copy checks, not an adversarial native fence, model/resource or
actual-host qualification. Original stored images are never moved or deleted.
