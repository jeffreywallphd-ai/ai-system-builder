# Context Management

- Status: current
- Related decisions:
  `docs/adr/ADR-0008-ingestion-and-staged-artifact-semantic-model.md`,
  `docs/adr/ADR-0009-artifact-identity-and-backing-domain-model.md`,
  `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md`,
  `docs/adr/ADR-0040-immutable-dataset-versions-lineage-and-publication.md`,
  `docs/adr/ADR-0041-context-management-and-portable-context-artifacts.md`
- Related areas: `docs/architecture/data-management.md`,
  `docs/architecture/runtime-model.md`,
  `docs/architecture/persistence-and-storage.md`
- Verification: `docs/architecture/architecture-verification.md`

## Purpose

### Qualification of the approved-model worker

The trained Context qualification helper has an explicit `--approved-query`
profile. Ordinary comparison behavior is unchanged. Its fixed 1,000-row corpus,
eight topic samples and pinned installed MiniLM model exercise the production
`approvedEmbedding` branch without replacing its embedding callable. The private
model reference is explicit and the ordinary cache alias is removed. Exact
repeat/constrained comparisons, original-model/digest denials, sampled memory,
tensor placement, cleanup and native exit are recorded under the existing
supervisor. The versioned ordinary baseline is reused; none of its model runs
are repeated. Python source equivalence permits only Git LF/CRLF differences.
The [approved-model worker evidence](../operations/headless-context-admitted-query-evidence.json)
preserves the observed five query cohorts, exact comparisons and negative probes.

Source tests and physical measurements are distinct. Physical worker evidence
does not qualify `queryAdmitted` runtime-adapter dispatch, Headless task/policy
ownership, real Desktop/Managed MCP/UI journeys or the parent increment. GPU
observations count Torch allocations after warmup; sampled query RSS excludes
the shared import phase. Existing resource and cleanup controls are unchanged.

### Private approved query owner

The retained `ContextBrowserUseCases` has a separate private admitted-query
owner. It requires a copied actor/workspace, exact saved artifact digest/size,
question hash, original model witness and ordered source digest allowlist, plus
current trusted host policy, one-use issue and durable exact-ACK acceptance.
It reserves the existing four-pending/256-history profile before model or byte
work. Ordinary Browser helpers and their legacy backing/checksum fallbacks are
not used. Admitted reads require the exact generated catalog record and one
primary local binding, then an immediate private byte copy and matching hash.
The actual byte reader may omit descriptor MIME. Catalog MIME remains required;
a defined conflicting descriptor MIME still denies. Canonical optional binding
metadata does not change the required exact primary locator.

Both existing host compositions supply the original installed-model resolver
and existing reconciler admission fence. Only `queryAdmitted` may dispatch.
Acceptance may return before completion. Genuine durable acceptance is retained
after outward permission retires; task disclosure remains separately fenced.
Stored summaries contain only source ordinals, rank/score and bounded numeric
citation coordinates. Raw questions, excerpts, worker IDs and private model/file
references do not enter application task history or status. Query tasks never
enter generation review/save maps.

Business completion and custody retirement are separate. The existing runtime
cleanup owner can report exact retirement through an optional private callback;
it grants no cleanup or execution right. Capacity is held until the query promise
settles and custody retirement is proven. Unknown outcomes retain their state
and cannot trigger task discovery or an ordinary retry. This private component alone grants no public query or query-summary window selector. Physical
retrieval/resource, actual host and parent qualification remain pending.

Headless `context.preview-rebuild` resolves an exact indexed saved resource to
its accepted original build and immutable proposal/model witness. The same
metadata-only input preview revalidates source revisions and full model facts;
its digest must match the accepted build and saved receipt. The result contains
bounded public source references/settings and the saved reference, never private
actor/client/plan fields, storage keys, bytes or model paths. Current artifact and
model read authority and outward liveness are required in both hosts. Historic
approval is data, not new execution permission. Archive bytes and physical runtime
readiness remain not checked. Rebuild execution requires the separate version-9
approval described below.

### Passive exact question preparation

`context.preview-query` takes an exact saved RAG reference, a transient bounded
question, explicit CPU/CUDA and result limit. It synchronously copies descriptors
and hashes exact UTF8 text. Its asynchronous application metadata frame receives
no question; recorded Context compilation rechecks committed origin, accepted
producer and original source/model witnesses. Current read/liveness fences surround
metadata and outward output. Replies contain only the exact reference/hash,
original model ID/timestamp, counts/limits and not-checked readiness. Route/SDK
codecs independently correlate the hash. The 2,000-character headless profile fits
existing request/passive guards; ordinary queries keep their existing bound.
There is no input cache, durable question, source-byte/model load or query task.
The separate version-10 approval below permits bounded queries. Query display requires separate window consent as described below.
Physical retrieval/resources remain pending.

### Revocable Context metadata display

The existing window presentation family admits `show-context-artifact` with the
full exact saved reference and `show-context-task` with an accepted task ID.
Both hosts require current artifact-read and separate window consent. Saved
selection verifies committed catalog/binding/causal lineage, kind, producer and
digest without reading bytes. Task selection proves its accepted same-host/actor
point and plan indexes before observing the existing cached Context owner.
Presentation cannot initialize the lazy Desktop feature or grant new business
work. Accepted-task observation retains owned output validation and existing
worker recovery under its original lifecycle.
An absent owner remains unavailable. Fixed summaries expose only state/counts;
the window and connector context carry opaque selectors, not source/query text.
Existing lease/document/dirty-navigation/replay/revoke fences stay in control.
Ending display preserves independent Context tasks and saved artifacts. This
metadata feature supplies no public query summary, physical retrieval, resource
or actual app-host qualification.

### Private installed-query support

Private installed-query support is a separate optional method on the existing
Context runtime port. A trusted owning application must still bind the exact
saved source/model, current actor/client/plan and result-egress scope. The adapter
reserves the existing bounded host lease before reading/copying query data or
awaiting policy. It copies query/model/callback data and archive bytes before
awaits, then releases
its private byte-buffer references after staging. One final acknowledged issue
and current host acceptance permit only the installed-only task path. An exact
acceptance callback supports an owning asynchronous job without a long synchronous
transport wait. Unknown issue/start/acceptance, mismatched status and failed cleanup
retain the existing reconciler lease. Proven non-start requires no possible
dispatch and no retained staging. Synchronous liveness is checked again after
each policy await, including immediately before result delivery.
Private matches and citations are copied through closed descriptors before that
last await. Bounded citation fields cannot carry unexpected worker data; source
and digest allowlists remain the owning application's responsibility.

The query worker's private `approvedEmbedding` matches model/provider to the
verified manifest and uses the explicit existing safe-weight path. Imported
manifest paths cannot supply that authority. Ordinary query/default behavior is
unchanged. This internal component does not compose a public query, raw-query
storage policy, citation/egress owner, revocable display or physical qualification.

### Approved Headless rebuilds

The existing generation requests accept an optional exact `rebuildOf` reference.
Version 9 identifies that parent in the approval; ordinary versions 1 through 8
retain their fingerprints. Both approval channels/modes show the original sources,
settings and existing generation limits. A separately approved step creates a new
task and review-required result. It overwrites no parent and grants no save,
query, installation or presentation authority.

`compileRecordedHeadlessContextInputs` reuses the indexed saved-result, accepted
task and producing definition checks inside the caller-owned metadata transaction.
The normal generation compiler compares exact sources/settings and full original
model identity before resolving the runtime owner, at reservation and at atomic
issue after staging. The full mutation input binds the parent while the existing
source-digest algorithm stays unchanged. Later passive reads of a rebuilt result
validate its own producing request and do not recursively depend on an ancestor's
point index. Actual retrieval/resource, native, real-host and parent qualification
remain separate from the synthetic Core and SDK fixtures.

Context Management turns explicitly selected workspace artifacts and bounded
manual entries into portable context artifacts. It does not introduce a second
upload, acquisition, or dataset system. Data Management remains the authority
for acquiring source artifacts and creating reviewed datasets; Context
Management consumes those artifact identities and preserves their provenance.

The user experience has three peer surfaces:

1. **RAG databases** selects source data, inspects or extracts chunks, configures
   a local embedding model, generates a review, and asks the user to save or
   discard. Its compact source picker follows Data Management conventions with
   readable names, file-type badges, and All, Uploaded, and Generated filters.
2. **Context packs** first chooses manual entry or source materials. Manual
   entry validates and preserves the entered Markdown. Source mode performs
   semantic chunking, topic grouping, Standard or Strict cleaning, then either
   preserves each group with **No Summarization** or generates summaries with
   an explicitly selected local model. Both modes use the same formatted review
   and explicit save/discard lifecycle.
3. **Context Browser** shows saved RAG databases and context packs in the same
   card vocabulary as Artifact Browser. **View Details** opens a bounded modal
   for metadata, preview, source navigation, RAG testing, rebuild, and deletion.

## Shared capability and Data Management linkage

`modules/contracts/context-management/context-source-capabilities.ts` consumes
the Dataset Preparation source capability authority. Context accepts textual
CSV, JSON, JSON Lines, Parquet, TXT, Markdown, HTML, PDF, and DOCX artifacts and
rejects image-only and unsupported formats before runtime work.

Artifact Browser details for compatible textual data can expose **Convert to
RAG database**. The handoff contains only the authoritative workspace id,
artifact id, and target tab. The Context page resolves the current
workspace-scoped artifact again; a renderer-provided path, media type, byte
payload, or readiness claim is never authoritative.

“Already chunked” means the selected structured artifact contains persisted
`chunkIndex` and `sourceLineage` evidence for every usable row. Context
generation reuses each row as a chunk and preserves the selected artifact
digest, row index, text field, original chunk index, normalized span, page, and
region where present. A merely structured dataset is not called already
chunked. When that evidence is absent, the normal extraction settings apply.

RAG extraction reuses
`modules/adapters/runtime/python/worker/tasks/markdown_chunking.py`, the neutral
chunker used by Dataset Preparation. The user can choose fixed-length,
topic-aware, or document-structure sections. Fixed-length uses character size
and overlap. Topic-aware uses semantic sentence boundaries with a bounded token
ceiling and sensitivity. Document-structure uses normalized headings,
paragraphs, tables, pages, and layout regions where the source parser provides
them, with a section fallback for structured rows. These controls apply only
to unchunked sources; verified persisted chunks are reused without alteration.

## End-to-end flow

    Context ordered workflow or identifier-only Data Management handoff
      -> authenticated workspace host boundary
      -> ContextGenerationUseCase
      -> workspace artifact binding, catalog, and object-storage reads
      -> private bounded staging with exact source SHA-256
      -> RuntimeTaskRegistryPort (context-generation)
      -> managed Python worker (generate-context-artifact)
      -> bounded source inspection, preview, manifest, and private output
      -> explicit Save or Discard
      -> record-last object, catalog, and binding persistence
      -> Context Browser or Artifact Browser detail selection

Application code owns authorization, staging, task ownership, output
containment, review state, save/discard, catalog visibility, and compensation.
The Python worker owns document/structured extraction, chunking, embedding,
topic/summary generation, and physical artifact creation. Renderers own only
ordered interaction state and bounded display. The shared desktop/thin-client
Context Studio uses the standard tab-panel inset and four-step workflow
components. Workspace changes clear source filters and selections, manual text,
task review state, browser selection, and query results. Only an opaque task id
may be retained for review recovery. The shell-level notification bridge
publishes authoritative bounded task progress while the tabs are open or
closed. Save, discard, and delete publish terminal outcomes; validation,
blocking diagnostics, loading, empty results, and routine reads remain inline.

LanceDB is supplied by the host-owned managed Python dependency boundary.
Normal runtime setup installs the exact reviewed package by default. Before an
explicit RAG generation, saved-artifact inspection, or query, desktop and server
repeat one asynchronous idempotent probe/install/re-probe. Concurrent requests
share one in-flight ensure. If installation is required, the same workspace task
activity reports a fixed **Installing the local vector database** message,
completion, or a sanitized retryable failure before normal Context progress
continues. Context list, passive detail metadata, readiness, capability, task
status, and notification polling never install or repair dependencies.

Saved artifacts are accessed through `ContextBrowserUseCases`. List is derived
only from the authorized workspace artifact catalog and the two context media
types. Detail re-retrieves exact bounded bytes, verifies the catalog digest,
and asks the managed runtime to parse the LanceDB package or context-pack ZIP
into a safe bounded projection. Rebuild reconstructs a generation command only when every source
remains available and no manual text would be lost. Delete delegates to the
registered-artifact deletion lifecycle.

Source/artifact inspection and query reserve the existing host-owned Python lease
before allocation or dispatch. The adapter stages and hashes the same bounded
private byte snapshot. After an exact start acknowledgement, only the same request,
workspace and retrieval-task terminal status permits cleanup. Unknown or lost start
replies cannot discover or adopt a task; successful owned worker stop settles
those inputs. Status failure, mismatch, timeout and cancellation acknowledgement
retain staging. Cleanup failure retains the lease for retry. Both hosts reuse their
existing scoped reconciler and shutdown path. Ordinary dependency preparation
remains unchanged; installed-only headless query/rebuild admission and actual
retrieval/resource qualification are separate pending work.

RAG test queries use the embedding model recorded in the verified manifest,
rank vectors inside the managed runtime, and return only bounded excerpts,
scores, and exact citations. Stored vectors and arbitrary LanceDB columns never
cross the runtime boundary.

Desktop and server hosts compose the same application facade. Electron exposes
one sender-trusted, independently validated command channel through preload.
The server exposes authenticated read and write routes with `artifact:read`
and `artifact:write` policy scopes. Both transports inject authoritative actor
context and preserve opaque cross-workspace not-found behavior.

The desktop Context page renders the shared sanitized Python runtime monitor
beneath RAG Databases, Context Packs, and Context Browser. It loads bounded
runtime status and activity with the page and keeps start, stop, restart,
refresh, and clear as explicit user actions. Source-inspection projections
always include `textFields`; document sources use an empty array so the typed
runtime boundary does not reject an otherwise valid inspection result.

## Materialized artifacts

### RAG LanceDB package

The RAG media type is
`application/vnd.ai-system-builder.rag-database+lancedb+zip`. One saved artifact
contains `manifest.json` and a `database/` subtree with exactly one `chunks`
table. Its non-null schema is `id`, `ordinal`, `text`, `citation_json`, and a
fixed-size float32 `vector`; the manifest records the exact vector dimension,
embedding model, sources, counts, and digests. The package is a portable blob,
not a registered directory or a global database singleton. Workspace and
artifact identity therefore isolate each database while the shared managed
Python worker may open many packages independently without a process per
database.

Generation writes into private staging and packages only regular contained
files. Inspection and queries verify the catalog digest, ZIP layout, duplicate
entries, link/file type, compressed and expanded bounds, manifest, table name,
exact Arrow schema, row count, unique ids and ordinals, finite vector values and
dimensions, citation digests, and source lineage before using the database.
Materialization uses a private temporary directory and never `extractall`.
Table validation scans at most 256 rows per Arrow batch, checking every vector
natively for nulls, dimensions and finite values before retaining validated
metadata. It never materializes the full vector table as Python floats.
Cancellation is checked between batches and metadata rows; the reader closes
on success, denial or cancellation. Query ranking remains exact with the vector
index bypassed. No cross-request package, vector or embedding cache is added.
Embedding vectors are not returned in previews, task metadata, catalog records,
or diagnostics. Generation uses a selected local Transformers model with
`local_files_only=true`; it never downloads a model as a side effect.

### Markdown context pack

The context-pack media type is
`application/vnd.ai-system-builder.markdown-context-pack+zip`. Every bounded
ZIP contains `manifest.json` and `README.md`. A manual pack adds one exact
`context.md`; a source-derived pack adds `topics.md` and `sources.md`.
Static archive member names prevent path traversal. Each source-derived topic
and source chunk has a citation back to the selected artifact.

No Summarization preserves each cleaned semantic group without shortening it.
Model-assisted generation requires an explicitly selected installed local
model, a maximum line count, and strict JSON output. Source text is delimited
as untrusted data, embedded instructions have no authority, and every returned
citation must match a supplied chunk id. Manual and generated Markdown is
validated before review and archive creation. Review renders a safe React
projection; raw HTML from Markdown is never executed.

## Review and persistence lifecycle

Runtime success is `review-required`, not saved. The host revalidates output
handle containment, regular-file status, byte count, media type, manifest,
source evidence, preview bounds, and SHA-256 before exposing review evidence.
Only bounded preview text and citations cross into UI state.

Save re-reads and re-hashes the same staged output. Object bytes are written
first, then a workspace catalog record is appended, then the primary local
binding is created. Catalog or binding failure compensates previous writes.
Discard removes the private runtime directory without cataloging anything.
Cancellation is cooperative and checks between chunks; terminal paths release
the power-suspension blocker and private staging.

## Bounds

- At most 32 selected artifacts and 32 manual entries.
- At most 64 MiB per retrieved artifact and 1 GiB aggregate selected bytes.
- At most 200,000 characters per manual entry and 1,000,000 aggregate. The
  manual authoring surface reports lines because that is the meaningful editing
  measure; the character ceilings remain defense-in-depth byte-growth bounds.
- At most 100,000 chunks; chunk size is 64 to 32,000 characters and overlap is
  smaller than the chunk and at most 8,000 characters. Adaptive chunking uses
  32 to 4,096 tokens per chunk and topic sensitivity from 0 to 1.
- At most 32 discovered topic groups. No Summarization groups are at most
  12,000 characters; local-model output is at most 64,000 characters and the
  requested 1 to 1,000 lines. Review remains at most 100 items and 8,000
  aggregate preview characters.
- Model prompts and outputs are separately bounded; every source and saved
  context artifact is at most 64 MiB, matching verified object retrieval.
- A RAG package contains at most 4,096 database files, no entry larger than
  128 MiB, and no more than 256 MiB of expanded bytes. Only `manifest.json` and
  regular files beneath `database/` are accepted.

## Failure and recovery

Generation may select CPU, CUDA or automatic embedding placement; omission keeps
CPU behavior. Retrieval uses its own optional `embeddingDevice` request hint.
Device is never persisted in a portable manifest, so saved packages and source
rebuilds remain placement independent. Automatic selection prefers available
CUDA; explicit CUDA fails when unavailable and never falls back on failure.
The local runtime moves weights and every token tensor to the same selected
device, preserves float32 pooling/normalization/dimensions, and releases owned
GPU tensors/cache after success or failure. UI preferences reset with workspace
changes. The model, sources and dimensions still come from verified authority.

Missing workspace, authorization, source, capability, digest, model,
dependency, citation, output containment, or storage evidence fails closed.
Public errors do not contain source text, manual content, prompts, model output,
embeddings, credentials, or local paths. Private staged directories are removed
after terminal failure, cancellation, save, or discard. A failed save remains
reviewable after compensation so the user can retry.

> AI documentation reminder: when behavior in this area changes, update the
> related ADRs, threat model, context pack, runtime docs, and host/UI READMEs in
> the same change.

## Renderer session and action ownership

Context Studio replaces its form session when the workspace or typed client
changes. Layout cleanup retires the old session during commit. Its client checks
that session before dispatch and after each asynchronous reply, before another
command, task-storage write or notification can occur. The shell notification
bridge has a separate committed workspace/client fence and remains independent
of the page. Leaving the page does not cancel or remove accepted host work.

Generation, inspection, review, query, rebuild and delete use synchronous action
ownership before the busy render. An accepted generation stays owned through
review or unconfirmed cancellation. Matching terminal status permits a later
preparation. Save/discard require their matching terminal result; Save also
requires the returned artifact before claiming success. Closing a detail view
retires its local read/query presentation. A newer detail or browser-list request
cannot be overwritten by an older reply.

Source inspection, saved detail, retrieval and generation status replies must
match the requested action and source, artifact or task identity. This renderer
fence supplements existing host authorization; it grants no backend authority.
Transport exceptions use fixed user messages. Only local fixed Markdown
validation diagnostics and renderer-owned diagnostics retain detailed copy.
Focused UI fixtures exercise these behaviors and existing RAG/pack round trips.
Actual host, model, native and final combined qualification remain separate.

Each accepted generation has a local observation epoch. Later cancellation or
poll replies cannot replace a confirmed terminal or ready-for-review state. A
fresh explicit acceptance resets presentation for the next generation without
reviving the old observation. This is renderer ownership, not runtime authority.

Delete confirmation binds the selected artifact ID and verified storage key.
Only an acknowledgement of that exact key can clear the confirmation, refresh
the list or report deletion. A different key leaves the selected view intact.

### Manual package byte identity during inspection

A saved manual pack must contain exactly one manual manifest entry and no source
artifacts, as required by manual generation. The runtime compares SHA-256 of the
exact bounded `context.md` member bytes with that entry before accepting UTF-8
and Markdown. It does not normalize line endings or text before the comparison.
The existing catalog digest protects the outer package; the member check protects
its internal content/lineage consistency. It does not authenticate an author.
Legacy/source-derived package handling, RAG validation and review/save controls
remain unchanged. Focused byte fixtures do not qualify either mounted host.

## Current-owner save failure and retry

Context save checks that its generated catalog identity is unused before writing.
Only an exact acknowledged object write becomes a compensation target. The local
object adapter can append catalog metadata during storage; Context therefore
removes that target's catalog entry on a later save failure even when its own
explicit catalog update failed. It removes the known bytes after catalog cleanup.
A refused write or an unconfirmed returned key never becomes a deletion target.

A temporary catalog/object cleanup outage retains the current request's exact key
and private reviewed output. Serialized Save, Discard and Cancel finish that
cleanup before another object write or terminal release. This is cooperative
current-owner recovery in the live application, not an atomic metadata
transaction, crash journal, native file-identity proof or adoption of old state.
The existing process-restart/native qualification remains separate.

The focused Context test composes the actual shared UI, desktop preload/IPC or
browser HTTP client, artifact/Context host helpers, application facade, runtime
adapter, JSON catalog/bindings and filesystem bytes. Manual review/save/discard,
source-derived no-summary lineage, exact-byte reopen/deletion, duplicate save,
wrong-workspace recovery and safe persistence correction have exact assertions.
Finite worker output and inspection fixtures exercise the application boundary;
they do not qualify the production archive parser, Python/model/OCR, provider
access, physical app windows, SQLite/process restart, native shutdown or final
combined testing. No accepted model accuracy is rerun.

Save error copy is owned by the application. Unknown filesystem/port exceptions
use a fixed generic message; refused port results use fixed step messages.
Private staged paths and port error text/details never become Save transport
failures. Both registered HTTP and IPC envelopes are checked directly, including
an actual missing staged file. Failed-save cleanup checks reopen the exact old
object key to prove absence, and the positive case verifies the exact durable
primary binding, not only catalog counts or a successful response.

## Preparation start and staging diagnostics

The application owns public failure copy for generation-start exceptions and
source-staging exceptions/refused binding or byte reads. Preserve the refused
contract code while replacing its message with fixed corrective text. Unknown
exceptions use a fixed step fallback. Raw adapter/runtime text and details do
not cross these error branches into registered HTTP or IPC envelopes.

Composed both-client tests capture the actual envelopes, preserve manual input
or exact source bytes, refuse generation when staging fails and permit correction
and retry. The finite registry refuses before worker acceptance; this correction
does not change or qualify existing worker ownership, cancellation, native cleanup,
process restart, terminal-runtime diagnostics or final combined testing.

### Joined retrieval and rebuild regression

An accepted Rebuild closes the old Context detail dialog before showing the
preparation/review workflow. A refused rebuild leaves the detail available for
correction and retry. The source and original saved artifact remain unchanged;
the rebuilt candidate still requires explicit review and save.

The renderer admits query results only for the selected artifact, within the
requested/canonical result and excerpt limits, with finite valid scores and
citations validated by the existing contract helper. Invalid replies get fixed
public copy before result rendering. Starting a new query clears the old answer
so a failed or refused reply cannot appear to answer the new request. These
checks support display safety; application/transport authorization remains the
authority and no UI value grants access or a device fallback.

Eighteen additional two-host composed tests check RAG review/save/query/rebuild,
source-pack rebuild/restoration, exact source/chunk/citation/device context,
reopened catalog/bindings/bytes and preserved originals. Explicit CUDA refusal
requires an explicit corrected retry. Runtime output, malformed acknowledgement,
archive inspection, embedding/query, access and in-process invocation are finite
fixtures. Real UI/clients/transports/application/staging/files are composed; the
fixture is not an actual LanceDB/model/physical-host or final roadmap pass.
Whole-app source-pack/RAG helper wiring remains separate implementation work.

### Fixed source Context processor regression

The private provided-data qualification worker admits one versioned synthetic
Markdown source and its declared source-pack/RAG settings. The existing production
processors generate, inspect and query the actual package. A finite deterministic
embedding callback replaces model execution; real LanceDB storage and query
remain in use. This callback is test support, not a new production provider.
The source digest, bounded package manifest and actual returned citations remain
checked. Actual app restart and real model/index qualification are separate.

Generated source packs now frame each topic summary with an invisible versioned
Markdown marker and its exact character count. This preserves the cleaned group
verbatim, including nested headings, citation-like lines and fenced examples.
The bounded reader uses that count to find the real citation footer. Existing
unambiguous legacy topics and manual packs retain their existing reader paths.
Malformed frames, oversized summaries and unsupported versions fail closed;
archive, topic, summary, line and citation limits remain unchanged.

### Source Context app-journey wiring

Both existing app restart cases now reuse one fixed-source Context helper. Data
details passes only the selected storage identifier into RAG preparation. Public
read results provide byte/digest/manifest/source/citation evidence; all creation,
review/save, query, source navigation, rebuild, discard and deletion actions use
existing visible controls. Immutable original records are re-read after every
successor. The original workspace is restored for existing dataset/manual cases.
A source review identified that fresh-session source-pack rebuild may not restore
the preparation mode. That separate product regression/fix remains agent work,
not a human blocker or a qualification pass. Actual app execution is deferred.

### Fresh-session saved-pack review

The earlier source-review finding is repaired at the shared renderer boundary.
An accepted, still-owned source-pack Rebuild restores its manifest input mode
before showing preparation/review. Missing legacy mode means source materials,
matching the application command. A refused rebuild keeps detail open and does
not select a mode or publish an artifact. Saved manual packs remain ineligible
for automatic rebuild because their content must be entered again. Explicit
review and save create a separate successor; original records and bytes remain.
Workspace/client/unmount tests preserve the existing scoped-client isolation;
explicit action-token checks also guard acknowledgement and error updates.
Fresh renderer tests use actual registered Desktop IPC/preload or owned HTTP,
application and filesystem catalog/bindings, with finite worker/archive fixtures.
They do not qualify actual app restart, models, native cleanup or parent closure.

### Passive Headless Context input previews

`PreviewHeadlessContextInputsUseCase` is a metadata-only compiler. It has
ingestion task/snapshot, immutable dataset-version and recorded-model metadata
ports. It has no artifact-byte, runtime, dependency-install or task-start ports.
Both host read compositions require a dedicated plan-review registration and
current workspace artifact/model read authorization before and after reads and
publication. They return only strict public DTOs; private commands and exact
storage bindings stay in the application layer.

`context.models` lists at most 32 persisted workspace entries with no shared
discovery. `readRecordedModel` is a separate point read; the ordinary registry
lookup retains its existing discovery behavior. `context.preview-generation`
binds exact saved file task/revision/snapshot lineage or an exact immutable
dataset/version/digest/data role. It accepts four sources of at most 4 MiB each
and up to 1,000 chunks. Canonical Context capability and command validation
remain authoritative. Source-derived packs use topic-aware chunking and no
summarization model; the RAG preview selects recorded embedding metadata and
explicit CPU or CUDA placement. No fallback, download or physical readiness is
implied. Both DTOs report runtime readiness as `not-checked`.

This preview does not verify contents, selected columns, runtime availability,
license rights or current model files. Later approved execution must revalidate
bindings and current authority through the existing Context owner; the preview
does not grant execution, save, provider-egress or window-control authority.

### Host-owned Context start admission

The internal approved start port is separate from ordinary Context commands and
the passive compiler. A trusted host supplies the exact current approved plan,
actor/client/workspace and source/model witnesses. Staging is bounded to four
4 MiB sources and 1,000 chunks; it checks exact keys, actual bytes and hashes,
media and format. Optional object descriptors can omit MIME/size, but defined
conflicts deny and actual bytes must still match. Resolve omitted media through
the catalog or the approved canonical source witness. Snapshot adapter-owned
buffers before any later asynchronous metadata read.

The atomic issuer must revalidate exact current authority and issue one reserved
attempt. Local callback checks and an in-memory ID guard complement that durable
issuer; they are not durable approval or crash recovery. The owner checks a live
synchronous fence immediately before issue and host acceptance before dispatch.
Only acknowledged issuance permits the reserved task's one start. A lost reply,
wrong returned task ID/state or uncertain issue does not authorize another call.
Retain only this newly created staging under its owned lease until a confirmed
terminal result or successful owning runtime stop. Do not discover/adopt unknown
tasks or touch historical native/offload trees.

Confirmed tasks acquire reconciliation before power bookkeeping. An exception
after acceptance cannot delete staging that a worker may use. Read identity,
Context task type, scope and cancellation acknowledgement must match before
cleanup. Wrong/unknown replies stay unavailable without entering the bad-output
cleanup branch. Ordinary Context review/save/discard and source limits remain.
This internal component does not advertise public execution or prove physical
model/readiness, durable issuance, real retrieval, native stop or restart recovery;
those remain subsequent Context/host qualification.

Pending power registration gates task observation and cancellation cleanup.
Runtime-stop reconciliation waits for registration to settle before release,
so a late blocker cannot be created after terminal cleanup. Focused tests use
the actual power-lifecycle service with a delayed simulated blocker.

Approved start requires the installed-only task capability before source reads.
Routine processing approval cannot implicitly repair an environment. A fixed
nonblocking installed probe and separate supervisor/registry path are composed
in both hosts; there is no fallback to ordinary installation preparation. The
foundation retains that policy during shared task recovery and checks host
admission at the actual spawn and POST boundaries.
Only an explicit proven nonstart can remove this attempt's new staging after
issuance. The task ID remains consumed. Uncertainty, malformed acknowledgements
and exceptions preserve custody. Public plan issuance, model readiness and actual
Context execution remain subsequent qualification, not a consequence of this seam.

### Approved source-derived pack plans

Dedicated plan-review clients can propose the opt-in `context.generate-pack`
operation through the existing ordered plan workflow. Preview version 6 lists
exact saved Data references, no-model cleaning/chunk settings, four 4 MiB
sources, 16 MiB total, 1,000 chunks and separate result-review/save requirements.
Both app approval channels and both approval modes use that same projection.
A source save and processing of that mutable upload cannot share a plan.

The root-owned transaction recompiles current saved metadata and binds the
command, actual source hashes and declared license terms to one reserved task.
A distinct Context namespace records reserved, issued and accepted phases with
exact organization, actor, client, host, workspace, plan and step identity.
Runtime and file effects occur outside retriable persistence transactions.
Current atomic issue permits one installed-only start. Unknown issue/start
outcomes cannot authorize another call or adopt an ordinary task. Acceptance
records the admitted outcome even if outward access has ended; reply and replay
still require current approval and policy.

`context.task` first proves that durable accepted association before resolving
the processor. It can poll the exact task or recover it from the known plan step.
The owner validates worker output through its existing lifecycle. Public replies
contain state and, when review is required, a fingerprint, source/chunk counts
and size. They never contain source text, private paths, prompts or embeddings.
The report always requires a separate save. Declared non-open terms remain
attached; absent terms stay unknown. Terms are bounded whole, never silently
clipped, and do not establish usage rights. Source descriptors cannot replace
the approved declaration; worker manifest and inspection terms must match it.
Source-derived Markdown workers include recorded attribution in both places
without the RAG-only source-check setting. RAG retains its attribution opt-out.

The Managed HTTP adapter advertises `context.task` only with plan-review
support. It validates the exact minimized task result before forwarding it.
The host still enforces plan-client, accepted-receipt and current workspace
authority; transport availability grants no task ownership.

The initial active profile is source-derived Markdown without summarization.
Active RAG/model admission, immutable Context saving, query/rebuild, revocable
Context presentation and parent qualification remain separate Increment 6 work.
No model readiness, native/offload or host-exit proof follows from these tasks.

### Recorded embedding model admission

The internal admitted RAG path also binds exact saved model facts: record id,
update time, logical model id and a private metadata digest. Passive compilation
reads recorded metadata only. After approval, the application resolver rechecks
that witness and current actor authority around the existing-file adapter.
Configured model roots and the bounded file lister constrain inspection. The
initial profile supports an existing unsharded safe-weight directory; unsupported
formats and layouts remain unavailable. Source staging and task issue follow
this check. No installer, model download or alias discovery fallback is allowed.

The trusted runtime request carries the checked local reference separately from
the logical model id. Public generation cannot supply it. The worker loads local
safe weights without remote code and omits the private reference from portable
manifests. Admitted output must retain the logical model and source-check policy.
RAG attribution can be omitted as selected; inspection still retains the exact
declared license. Unexpected attribution or private model fields deny review.

Desktop resolves model features lazily only for admitted model work. Managed
composition uses its existing configured model roots. These are cooperative
record/file checks, not native custody, immutable-byte or memory guarantees.
Actual model execution, retrieval and parent qualification remain separate.
Existing Context UI and no-model packs keep their owners.

### Approved local RAG plan connection

Hosts separately opt into `context.generate-rag`. Preview version 7 states local
embedding work, zero outside calls and the existing four-source/16 MiB/1,000-chunk
bounds. Version 6 pack and earlier Data/system previews retain their exact shapes
and fingerprints. Both popup and chat approval disclose the selected model,
device, policy and distinct review/save boundary.

The shared Context ledger preserves its historical namespaces and pack keys;
RAG has a distinct actor/client-scoped step-key family. Its source digest also
binds the private copied saved-model witness. Submission preserves that witness
for each RAG step in a private version-2 plan record; decision writes retain it.
Older version-1 pack/Data records and public fingerprints are unchanged. A
metadata-only new-start check compares the approved witness before opening the
runtime owner. Accepted receipt replay does not reopen a model or reprocess data.
Reservation and atomic issue
recompile that witness with current model-read/source/plan authority, including
after source staging. Changed model facts cannot dispatch under the old binding.
Runtime/filesystem effects stay outside retriable transactions. Accepted-only
RAG task review exposes finite counts/size/fingerprint, never paths or vectors.
The existing Context owner still checks installed runtime/files and safe loading.
Physical retrieval/resources, saving/query/rebuild and revocable presentation
remain separate implementation or qualification work.

### Private result-byte publication component

The internal `ContextResultByteStoragePort` separates exclusive byte publication
from catalog activation. Its filesystem adapter derives an opaque workspace key,
captures optional organization scope before awaits and accepts only the two
Context archive media types, exact SHA-256 and nonempty bytes within the existing
64 MiB limit. It shares the ingestion adapter's private verified-stream mechanism:
intrinsic chunk bounds and a private copy precede hash/write, and complete EOF
verification precedes final target publication. No catalog, binding, overwrite,
delete or existing-file adoption capability is composed into this adapter.

This component is not task ownership or approval. The result-save owner still
must bind an accepted task and exact reviewed output, issue one save effect and
atomically commit catalog, primary binding and causal receipt after the byte
acknowledgement. An unknown write remains retained. Public save/query/rebuild,
host wiring and native/crash qualification remain pending at this boundary.

### Internal reviewed-result save owner

`saveAdmittedContextResult` adds a separate capability-bound save path. It uses
an already accepted task, copied actor/workspace, current review fingerprint and
one acknowledged save issue. The owner supplies private directory/handle facts
to the bounded output adapter, verifies the byte acknowledgement and sends only
the exact descriptor to the metadata commit callback. It never invokes ordinary
auto-registering storage or compensates a confirmed save after cleanup failure.
Uncertain issue/write/commit keeps the attempt and prevents ordinary save,
discard or cancel from bypassing it. Exact confirmed replay performs no new IO.

The private structured result store binds the original accepted task/source
digest and verified review. Only one save can issue per task/client. Catalog,
primary binding and causal receipt commit in the same root-owned transaction,
with insert-only metadata and no ordinary-record adoption. The shared composition
requires a trusted save-specific authorizer that reads only the supplied owner;
its before-commit guard retains current host acceptance. It recompiles the exact
review/source before issue and commit. A lost commit reply permits one exact
read-only receipt reconciliation, never another write or outward authority.

Both hosts inject optional byte/source ports for structured storage. That
internal component supplies no public authority. The public connection below
binds the exact save authorizer; a generation approval is insufficient.
Synthetic lifecycle/transaction tests and cooperative file checks are distinct
from real embeddings, retrieval, native custody or process-restart recovery.

### Separately approved public result saves

Hosts opt into `context.save-result` with preview version 8. The accepted task,
exact review fingerprint and reviewed name are checked before proposal storage
and again around one-use issue and metadata commit. Both approval modes and
channels disclose the save permission and existing 64 MiB limit. Versions 1
through 7 retain their fingerprints. Saving never starts a model or processing
task and grants no query, rebuild, external publication or window authority.

New version-2 result records add an opaque Context point index to the same
catalog/binding/causal-receipt transaction. `context.saved` verifies this metadata
and returns only ID, original task, kind, digest, name and bounded counts. Its
explicit `byteAvailability: not-checked` is not archive or retrieval readiness.
Current workspace/artifact read permission can disclose saved workspace metadata;
it cannot adopt the original actor/client's task. Version-1 internal receipts
remain replayable but are not automatically indexed or publicly adopted.

Desktop proposal checks use only its cached retained Context owner, not lazy
runtime initialization inside a metadata transaction. Both hosts replay a
committed save without that owner. Unknown effects retain uncertainty and the
existing ordinary-action denial; no second publication or file adoption follows.

### Proven generation non-starts

The internal admitted-start result can carry `admittedStartOutcome: not-started`
only when the owner proves a fresh call did not dispatch a task and retains no
uncertain attempt. This includes missing model/runtime support before dispatch
and the installed-only registry's closed no-task-POST result. Duplicate IDs,
unknown issuance, possible dispatch and lost or malformed replies supply no proof.

The exact newly reserved owning call can record that proof as a version-2
terminal task outcome, with its original reserved/issued phase and indexes.
Ordinary version-1 task records retain their schema. Historical unknown records
are never inferred or adopted as non-starts. The terminal outcome cannot issue,
become accepted or authorize status/save/presentation. Current approved-step
replay reports only `headless.not-started`, without reopening a processor or
dispatching again. Outward actor/client/plan checks remain separate from trusted
outcome recording after revocation. HTTP503 carries the exact fixed code; SDK
transport preserves it only at that status and under declared Context generation
support. Lost, malformed or mismatching responses remain unconfirmed.

### Approved local Context queries

The separately opted-in `context.query` step uses build-plan preview version 10.
Its durable definition binds the exact saved RAG reference, original model record
and timestamp, question hash, explicit CPU/CUDA and 1–20 result limit. Versions
1–9 retain their fingerprints. For approved execution, only `plan.run-step` can
carry a copied transient question (maximum 2,000 characters) within the existing
8 KiB envelope. Passive query preview separately receives text only to hash it. The SDK
maps optional `contextQuery` to that envelope; other steps reject it before effects.
Plans, task/effect records, receipts, audit and returned summaries retain no text.

Metadata-only original-lineage compilation runs at proposal, reservation and
atomic one-use issue after staging. Exact runtime ACK and acknowledged durable
acceptance precede the owned phase. Original caller, client and approval gates
protect preparation, new issue and the outward start reply. Recording a genuine
already-issued ACK remains independent of caller closure or revocation. Only
acknowledged durable acceptance enables owned background policy. Then the retained Browser/reconciler and
captured verified actor reread current membership, role, workspace, saved/source
and original model facts. Closed HTTP requests, old JWTs, ambient context and old
approval lifetime cannot become background authority. Original request fences
still control the start reply. Lost acceptance proof grants no phase switch,
adoption, discovery, rerun or recovery authority.

Fresh status proves the accepted client/host/actor and current artifact AND model
read permission before cached query owner access and at final host publication.
An unknown definition denies before either query or generation owner. Generation
reads retain their original artifact-only policy. Results are closed numeric
rank/score/citation coordinates with original public source references/digests,
question hash, settings and separate cleanup state. They contain no question,
excerpt, vector, private path, worker ID or instruction, and grant no save.

Both approval modes/channels reuse the existing modal. No new engine, scheduler,
retention, provider, model download or native/cleanup policy is introduced.
Controlled Core/SQLite, API, SDK, policy and UI tests are feature evidence only.
Consented query-window display, physical retrieval/resources, actual app hosts and
parent/chunk qualification remain separate. Rollback disables query/v10 admission
and retains consumed history; it never restores a weaker execution path.

### Query results under separate window consent

`show-context-query` is distinct from generation's `show-context-task`. Desktop
and Managed selectors require current artifact and model read before metadata,
at final display and during fresh observation. The original query plan is history,
not a window grant. Accepted same-actor/workspace/host lineage can use a different
window connection; original client identity never leaves the host.

The shared reader reconstructs the exact query, checks original saved/source/model
facts in an owned metadata snapshot and only then reads the retained Browser.
External root policy runs outside that snapshot to avoid recursive transaction
entry, with checks before and after. No lazy feature, model, task, ordinary-query
fallback, save or recovery follows. Legacy generation display rejects query DTOs.

A fixed bounded card shows state, match/source counts, CPU/CUDA, result bound,
question hash and independent cleanup state. It shows no excerpt, question,
source handle or model/runtime path. Window context remains selector/view IDs.
The current modal lists this permission. Existing consent/delivery/replay/revoke
semantics and backend task independence remain. Controlled Core/SQLite/DOM/SDK
and source-wiring checks do not qualify physical resources or actual app hosts.
