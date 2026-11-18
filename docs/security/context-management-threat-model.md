# Context Management Threat Model

- Status: current
- Scope: Context source selection, private staging, local generation, review,
  save/discard, Data Management handoff, and saved context artifacts
- Related:
  `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md`,
  `docs/adr/ADR-0041-context-management-and-portable-context-artifacts.md`,
  `docs/architecture/context-management.md`

## Approved saved-parent rebuild boundary

An optional `rebuildOf` reference is strict workspace/kind/UUID/digest data, not
execution authority. A new version-9 preview and current approval bind it with
the original normalized sources/settings. Both approval channels disclose the
parent and new generation effect; versions 1 through 8 retain their fingerprints.
The existing host authorizer and partition-owned compiler verify current
artifact/model access, indexed committed origin and accepted producing definition
before lazy runtime resolution, at reservation and at final issue after staging.
Missing or changed parent/source/model facts deny without replacement or adoption.
Historic approval is never reused. The established source digest is unchanged;
the full input digest and plan fingerprint bind the parent reference.

Rebuilds use the same installed-only Context owner, limits and one-use accepted
task receipts. They overwrite no parent and need separate result review/save.
A producing rebuild's later input preview verifies its own indexed definition
without recursively requiring an ancestor's index. Synthetic two-host tests cover
new approval, exact replay, substitutions and parent loss after staging. No
runtime/model installation, raw-content disclosure, native recovery or resource
qualification follows. Controlled rebuild checks alone qualify no query or display. Physical and parent
qualification remain open.

## Transient question preview boundary

Strict saved-RAG/text/device/result input is copied and the question is hashed
synchronously before asynchronous application metadata. Proxies/accessors, invalid
UTF8, nontext controls, unknown fields, foreign references and excess bounds deny.
The headless 2,000-character profile preserves existing 8 KiB transport and shared
passive guards. The metadata dependency receives no question; only recorded
saved/source/model facts cross that internal boundary. Current scope and synchronous
liveness after policy awaits fence results. Exact caller-computed hash correlation
and closed output schemas reject wrong-question replies or echoed private text.
Normal records/results/diagnostics contain no question, and no source bytes,
model/runtime, provider or task is touched. Request buffers retain existing request
lifetime; no forensic erasure or physical/parent qualification is claimed.

## Revocable Context display boundary

Strict Context selectors carry an exact saved workspace/Context/producer/kind/
digest reference or one task UUID. Current artifact-read and existing separate
window consent fence both host readers. The application copies actor/selection
before awaits and rechecks permission after metadata. Saved records require exact
committed catalog/binding/causal metadata, not caller names or generic keys.
Transient tasks require accepted same-host/actor point and plan indexes before
cached owner access. Unknown, ordinary, unaccepted, foreign or absent owners deny
without model/runtime initialization, new task dispatch or source-byte access.
For an accepted task, observation retains its original owner's output validation
and existing owned-worker recovery. Display cannot construct a lazy Context
feature or grant a new business task/save. This existing lifecycle is distinct
from the metadata-only query preview, which calls no task or runtime owner.
Fixed bounded interactive summaries omit names, instructions, excerpts, queries,
model paths and vectors. Existing window delivery/context fences stop new effects
after revoke while preserving independent work. Source freshness, public queries,
actual retrieval/resources and final qualification remain separate obligations.

## Private installed-query boundary

The retained Browser's private query owner binds copied organization/actor/
workspace, saved artifact digest/size, question hash, original model witness and
source allowlist to trusted current issue/accept callbacks. It does not use the
ordinary Browser's optional legacy authorization or backing/checksum fallback.
Exact generated catalog and primary local binding checks precede a bounded
private byte copy/hash. Current policy/liveness surrounds model/files, staging,
atomic issuance and result release. Slots are reserved before model/byte work;
history and uncertain attempts are never evicted to admit another task.

Only the existing installed query port runs. Runtime ACK and confirmed durable
acceptance precede task disclosure. Recording an already-issued outcome is
separate from outward permission; revocation withholds start/status output.
Strict results match the original ordered source ID/digest allowlist before
discarding excerpts, worker IDs, free-text field/region and private paths. Only
rank/score/source ordinal and canonical numeric coordinates remain in task state.
Foreign/malformed citations cannot become a query result or generation save.

The runtime's exact cleanup-retirement callback is observation only. It runs
after owned removal and can arrive after the result snapshot. The application
holds capacity until promise settlement and retirement proof; callback failures
or unknown custody retain the slot. Cleanup does not prove business success or
authorize retry/adoption. Focused controlled adapter/application tests do not
qualify physical models, native custody, actual app hosts or public query plans.

The optional private installed-query seam accepts only strict copied descriptors,
bounded actual byte snapshots, exact artifact/query hashes, matching scope/limits,
explicit device and a host-resolved model reference. Trusted callback capabilities
cannot come from a transport. Current policy and acknowledged one-use issue are
checked around staging, followed by a fresh host-acceptance check before installed
dispatch. The existing host lease is reserved before descriptor reads, byte copying
or an awaited policy check. Full or stopped ownership denies before allocation.
Synchronous liveness is checked again after every policy await, including final
result delivery. An exact acknowledgement must precede accepted-task recording. Unknown
issue/start/acceptance and foreign status retain the existing lease, never task
discovery or retry. Cleanup failure prevents a positive non-start proof.

Worker-approved embedding data is closed, query-only, explicit and matched to the
verified manifest's model/provider. The safe-weight loader uses the host path with
local-only/remote-code-disabled controls; imported paths are ignored. Admitted
query bytes remain exact after approval. Current permission fences private results.
Private match/citation fields are closed, bounded and copied before the final
policy await; extra fields, accessors and malformed spans/pages deny delivery.
The application still must compose current source/model authorization, citation
allowlists and egress; this component grants no public raw-content or query right.
Cooperative byte/fixture tests are not native custody or real model/resource proof.

## Protected assets

- Workspace-owned source bytes and exact source identity
- Manual context content
- Source and chunk lineage
- Model prompts, outputs, and local model references
- Embedding vectors
- Private generated output awaiting review
- Saved RAG databases and Markdown context packs
- Artifact object, catalog, and binding integrity
- Workspace, organization, and principal isolation
- Runtime launch authentication and local filesystem paths

## Trust boundaries

1. Renderer and thin client to authenticated host transport
2. Data Management or Artifact Browser handoff to Context page state
3. Application use case to workspace artifact storage and catalog
4. Host private staging to managed Python runtime
5. Untrusted source/manual text to no-summary or model-assisted generation
6. Runtime output back to application review state
7. Reviewed private output to object storage, catalog, and binding persistence
8. Saved LanceDB/ZIP bytes to runtime inspection and RAG query projections
9. Reviewed exact dependency declarations to package distribution and the
   host-selected managed Python environment

Renderer selections, filenames, media types, “already chunked” claims, model
output, citations, output handles, and source content are untrusted. Host
workspace context, storage retrieval, digests, capability checks, and local
model installation state are authoritative at their owning boundaries.

## Threats and controls

Embedding placement accepts only CPU, CUDA or automatic execution intent. It
cannot select a path, provider, model, credential, network destination or portable
artifact authority. CPU is the omitted default. Query placement is separate from
verified manifest model/dimension metadata; injected manifest placement is ignored.
Explicit unavailable CUDA and exhaustion fail without fallback or private detail.
Weights and all inputs use the same device and owned tensors/cache are released.
Tests cover propagation, compatibility, unavailable/exhausted devices, manifest
injection and unchanged cleanup/validation. Real trained-device qualification
uses fixed verified safe files, no remote code/pickle and synthetic sources;
availability or deterministic fixtures alone never qualifies model performance.

| Threat | Control |
| --- | --- |
| Cross-workspace source read or review/save | Host adds workspace context; application authorization requires artifact read/write scopes; task scope includes workspace and available organization/principal; mismatch returns not found. |
| Forged Data Management handoff | Handoff carries only workspace/artifact ids; Context resolves artifact bytes and capability again. |
| Source substitution or stale review | Source and manual bytes receive SHA-256 digests; runtime verifies staged bytes; application validates returned source evidence and re-hashes output before review and save. |
| Path traversal or symlink escape | Host creates private directories; runtime receives absolute staged paths; output handles are basename-only; application resolves canonical containment and requires a single-link regular file. |
| Oversized or malicious document/structured input | Source count, per-source, aggregate, row, archive, extracted-text, chunk, preview, and artifact limits; shared format allowlist; existing bounded PDF/DOCX/Parquet readers. |
| False “already chunked” claim | Worker requires persisted chunk and source-lineage evidence on every row; otherwise it uses bounded extraction and reports `alreadyChunked=false`. |
| Prompt injection in source data | Local-model system prompt states source chunks are untrusted data; constrained schema is used when supported; strict parse and validation always apply; only supplied citation ids are accepted. |
| Malformed Markdown or active HTML in review | Manual and generated Markdown is bounded and validated before packaging; review uses the safe React Markdown projection and never executes raw HTML. |
| Ambient network model retrieval | Embedding and text generation resolve managed local model references and use local-only Transformers loading; runtime generation never downloads a model implicitly. |
| Model-authored or malformed citation | Output schema bounds citation arrays and strings; application accepts only ids from the supplied chunk set. |
| Embedding or protected-content disclosure | Vectors and complete source content stay inside the saved artifact; previews are bounded; catalog, task metadata, logs, and errors omit embeddings, prompts, model output, manual content, and local paths. |
| Partial or misleading saved artifact | Runtime completion remains private and review-required; Save verifies bytes and uses object-then-catalog-then-binding ordering; failures compensate earlier writes. |
| Runtime task denial of service | One managed executor, bounded deadlines, per-chunk progress, cooperative cancellation, task retention limits, and hard generation bounds. |
| Substituted, partial, or raced LanceDB installation | Exact repository-owned pins and Package URLs, fixed pip arguments, supported-host checks, bounded timeout/output, asynchronous one-flight ensure, post-install import/version verification, and fail-closed task dispatch. No caller package, version, index, URL, or command argument is accepted. |
| Installer diagnostic disclosure | Public task progress uses fixed bounded messages and sanitized retryable codes. Package-manager output, environment, command lines, local paths, source content, prompts, and vectors are excluded from transports, notifications, and normal logs. |
| Passive read causes environment mutation | Only normal managed-runtime setup and explicit Context generation/inspection/query starts invoke the ensure. Readiness, capabilities, status/list, Context Browser reads, and notification polling are no-install operations. |
| Archive entry traversal | Context-pack member names are fixed by code. LanceDB packages allow only `manifest.json` and contained regular files beneath `database/`; absolute, traversal, backslash, drive-like, duplicate, link, encrypted, unsupported-compression, and unknown entries are rejected before manual private extraction. |
| Malicious saved LanceDB or ZIP | Exact workspace bytes and catalog digest are verified before runtime parsing. Package compressed/expanded bytes, entry count, file type, manifest, one-table name, exact non-null Arrow schema, row/count/id/ordinal/vector/citation integrity, and source lineage are validated before inspection or query. |
| Retrieval leaks vectors or unrelated rows | Query uses the manifest-recorded local embedding model; only top bounded excerpts, scores, and validated citations return to the host. Vectors never cross the runtime boundary. |
| Transport scope confusion | Electron requires a trusted owned-window sender and independently reconstructs the typed request; API read/write routes are separately allowlisted and centrally scoped. Both inject authoritative principal/workspace context. |
| Unsafe diagnostics | Worker logs event class, task type, bounded error code/stage only; public status maps to bounded generic messages. |
| Notification disclosure or cross-workspace task confusion | The shell bridge lists only authorized workspace tasks; records use stable workspace-scoped ids, bounded progress, and sanitized copy without paths, source text, prompts, model output, or payloads. |

## Denial and failure-path evidence

Focused tests cover:

- mismatched source and output digests,
- cross-workspace task reads,
- invalid settings and oversized inputs,
- unknown model citations,
- source prompt-injection text remaining untrusted,
- cooperative cancellation,
- catalog-write compensation,
- binding-write compensation,
- output cleanup on failure and discard,
- runtime task dispatch and progress mapping.
- exact dependency fast-path/install/re-probe, timeout, unsupported Python,
  unexpected probe, partial/mismatched install, concurrent one-flight behavior,
  sanitized task failure, and passive-read no-install behavior.
- malformed LanceDB/ZIP, archive traversal/link/duplicate/expansion attempts,
  schema/vector/citation mismatch, digest/media mismatch, untrusted IPC sender,
  unauthenticated API request, and read/write route confusion.
- malformed manual/generated Markdown, safe formatted review, Standard/Strict
  cleaning, No Summarization preservation, and notification task projection.

## Residual risk and qualification

Recorded rebuild preview uses current saved-resource authority, exact committed
save/catalog/binding descriptors and accepted-task point/plan indexes. The original
proposal fingerprint/input digest and source/model digest bind its definition.
Current metadata is recompiled and must match; a same-ID/same-time replacement
cannot substitute for the original model. Revoked historical approval supplies no
new permission. The finite output excludes private ancestry, storage keys, paths,
source bytes and embeddings; current permission/liveness surrounds release. It
cannot discover or adopt legacy/unindexed work, initialize the runtime or issue a
rebuild. Real Core/SQLite tests use controlled runtime bytes/model references;
physical model/file/native, PostgreSQL and parent qualification remain separate.

Artifact-operation lifecycle delta: mutable caller bytes are copied using intrinsic
view length/copying before the first await; the exact private copy is hashed and
written. The existing host lease bounds outstanding operations and precedes staging.
Cleanup requires exact acknowledged request/workspace/retrieval-task terminal
evidence or successful owned Python stop. Lost or mismatched starts cannot adopt
tasks; unknown status, a cancellation acknowledgement and transport failure are not
termination proof. Cleanup failure retains ownership for retry. Fixed adapter errors
omit worker messages, query/source text and paths. Focused regressions use synthetic
bytes and controlled runtime replies, not a physical embedding/retrieval or host
shutdown qualification. No historical directory is discovered or removed; process
crash orphan reconciliation remains an existing operational concern. Ordinary
dependency preparation is unchanged; public installed-only headless query/rebuild
admission remains pending.

Host reconciliation retains only accepted task callbacks and immutable scope,
preserving organization context across asynchronous observation. It does not
discover tasks or save review output. A transient read failure cannot delete
inputs still owned by a worker. Public reads reauthorize before using the same
single-flight completion path; cleanup retains ownership until removal succeeds.

- LanceDB and context-pack ZIP artifacts intentionally contain derived source content and must
  retain the same workspace access and deletion posture as their sources.
- Compensation is best effort across independent object, catalog, and binding
  stores. Operators still need orphan reconciliation when a backing service is
  unavailable during cleanup.
- Physical qualification must exercise representative local embedding and
  text-generation models on supported CPU and CUDA profiles. Tests use injected
  providers and do not prove every third-party model's numerical quality.
- Existing document parsers and local model libraries remain dependency
  supply-chain inputs covered by the repository dependency and SBOM controls.
- A first managed installation requires the approved package source and can
  fail offline. Exact native-wheel behavior still requires release-platform
  qualification; a successful install is always re-probed before Context work.

> AI documentation reminder: changes to Context inputs, models, output formats,
> publication, system use, or public transports require this threat model to be
> revisited.

Task lifecycle delta: status reads and explicit review actions serialize per
accepted scope, preventing concurrent save/discard from publishing duplicate
artifacts. Reconciliation preserves accepting organization context and does not
grant renderer write authority. Transient status failures retain staging;
confirmed terminal results or worker stop permit cleanup. Failed worker stops
or cleanup retain ownership and persistence for retry. Local deterministic
denial, duplicate-save and no-renderer lifecycle tests cover these controls;
physical worker shutdown and unavailable hardware qualification remain pending.

Allocation delta: all table vectors remain mandatory validation inputs. Native
Arrow finite/null/dimension checks run in batches of at most 256 rows, followed
by the existing per-row identity, ordinal, text and citation checks. Only
validated metadata is retained for exact result verification. Cancellation
interrupts scanning before embedding/search, closes the native reader and
removes private materialization; it cannot leave a reusable partially validated
database. Package ceilings, catalog digests and exact index-bypassed search are
unchanged. Late-batch corruption and cancellation/retry regressions exercise
this boundary. Synthetic RSS/timing evidence cannot substitute for representative
local-model CPU/accelerator and retrieval-quality qualification.

## Renderer asynchronous ownership

Protected presentation assets include workspace source/manual content, accepted
task identity, task-recovery storage, saved-artifact selection and notifications.
A late workspace/client reply, duplicate action or substituted source/task/result
can confuse those assets even when the host independently authorizes requests.
Committed layout retirement fences page and shell task-list sessions. Typed client
checks precede dispatch and follow await; reply identity is checked before use.

A synchronous action owner prevents duplicate generation, save/discard, rebuild
and delete before React renders busy state. Accepted generation ownership stays
through review and unconfirmed cancellation; terminal evidence releases it. Save
requires a matching saved result and returned artifact, never a success claim from
a nonterminal response. Newer detail/list reads retire earlier presentation.
Raw transport exceptions never become UI diagnostic copy; local Markdown
validation emits only its fixed messages. Application authorization, bounded
staging, model isolation, review authority and host task observation remain.

The focused shared-renderer cases include real pre-fix race failures, mismatched
source/task/artifact denial, duplicate actions, delayed replies, cancellation,
review and saved-artifact readback. Their client fixtures do not qualify physical
RAG semantics, host transports, provider access or native cleanup. Existing model
quality and OCR evidence is retained; unknown offload objects are untouched.

Each accepted generation has a local observation epoch. Later cancellation or
poll replies cannot replace a confirmed terminal or ready-for-review state. A
fresh explicit acceptance resets presentation for the next generation without
reviving the old observation. This is renderer ownership, not runtime authority.

Delete confirmation binds the selected artifact ID and verified storage key.
Only an acknowledgement of that exact key can clear the confirmation, refresh
the list or report deletion. A different key leaves the selected view intact.

### Manual pack content and lineage consistency

A readable package with a correct outer digest can still declare a manual digest
that does not match `context.md`, or claim missing/extra entries or source lineage.
Manual inspection now enforces the same one-entry/no-source shape as generation
and hashes exact bounded member bytes before accepting their text interpretation.
Fixed failures omit contents, digests and local paths. Existing path, outer-byte,
archive and UTF-8/Markdown checks remain mandatory; this check grants no author
authenticity. Positive Unicode/line-ending cases and substituted bytes, stale
digests, invalid shape and invalid text cases exercise the production operation.
These local fixtures do not qualify actual hosts, model semantics or native
ownership. Rollback must retain denial of inconsistent manual packages.

### Fixed manual Context app-journey support

The private provided-data fixture also permits one declared manual pack and
bounded pack inspection through production tasks. Its current candidate/run/temp
bindings, regular immediate staging, one-entry bytes and no-model/no-source rules
prevent fixture scope expansion. Existing native quotas and ownership stay intact.
The UI journey uses only public controls for mutation and scoped bounded reads
for identity, validated manifest and exact stored-byte oracles. Error/report data
exclude credentials, content and local paths. Local fixture/oracle/collection
checks do not qualify app selectors, host execution, native retirement or a parent.

### Context shell notification boundaries

Task-list replies and cached observations must form the complete bounded page
with unique normalized IDs, known generation/retrieval families and closed task
statuses before any row is published. The100-record bound follows the existing
application task-list use case; request IDs retain the existing512-character
contract bound. Committed client/workspace fences continue to reject retired
results. Unknown task state stays uncertain instead of becoming failed.

Fixed state/family messages replace arbitrary runtime progress. Only the exact
static managed-installation hint is retained; embedding text is rebuilt from
ordered safe-integer counts. A finite in-range percentage is allowed when counts
are absent. Known units alone are retained. Focused actual bridge regressions
exercise malformed/duplicate/oversized/family-invalid pages, safe copy, numeric
progress and shared snapshots. Existing installation/embedding UI regressions
remain unchanged. These fixtures grant no actual RAG/model, host, native recovery
or parent-roadmap qualification, and full testing stays deferred by user direction.

## Acknowledged Context save cleanup

A save preflight refuses an occupied or unreadable generated catalog identity.
Only the exact key acknowledged by a successful object write is retained for
compensation. Refused writes and unconfirmed returned keys are not deletion
authority. The storage adapter's implicit catalog record is included when later
Context persistence fails. Catalog cleanup precedes byte removal.

Unavailable cleanup retains the exact current request/key and private review.
Scope authorization and serialized review actions run before cleanup retry. Save,
Discard and Cancel do not start a new write or declare terminal success until
that known cleanup completes. The transient record grants no adoption, restart
recovery, hostile native-race, unknown historical file or offload authority.

Both-client composed UI evidence uses only new regular fixture files, bounded
ZIP fixture members and byte counts, finite task/transport calls and declared
synthetic worker/inspection and actor/sender boundaries. It checks late catalog
refusal, unavailable cleanup, unacknowledged writes, occupied identities, changed
review bytes, exact confirmation and wrong-workspace task recovery. Teardown
unmounts, drains owned work, discards only owned generation tasks, closes its
listener, verifies staging removal, restores exact globals/storage keys and
removes only its identity/containment/type/count/byte-checked new root. No model,
OCR, provider, production authorization, real archive parser, physical process
shutdown, native ownership or parent/final qualification follows.

A Save exception can contain a private staging path or port-controlled text. Only
fixed application-owned messages may cross HTTP/IPC. A module-private Save error
type carries literal messages for known refusals; arbitrary thrown errors use
a fixed fallback. Returned port messages and details are not reflected. Both
clients exercise an actual missing owned staged file, a private thrown error and
a private refused-result message; exact transport and rendered-output assertions
prove redaction while retaining safe retry and the existing cleanup guard.

## Preparation failure disclosure

Generation-start exceptions and source-staging binding/retrieval failures can
contain private paths or port-controlled text. These branches now expose fixed
application-owned messages. A refused result keeps its contract error code but
not its message or details. Settings validation remains contract-owned.

Ten added both-client cases reproduce thrown start errors and thrown/refused
binding or byte reads through mounted UI and registered HTTP/IPC. They assert
fixed envelopes and absence of private markers, no generation after staging
refusal, source/manual preservation and corrected retry. Only finite faults
before worker acceptance are used. The existing cleanup/lease behavior is not
changed, and no running-worker/native/host, terminal-runtime or parent/final
qualification follows. Prior Save redaction and exact byte-cleanup evidence remain
separate completed support at their recorded snapshots.

### Headless metadata preview boundary

The Context preview accepts only passive, finite source/settings records. It
rejects extra authority fields, accessors, stale revisions and foreign source,
version or model identities. A saved source's artifact key, digest, byte size,
media type and provider lineage must match its immutable snapshot. Only dataset,
train, validation and test roles can be selected. Duplicate storage targets and
oversized inputs deny; report, recipe and quarantine artifacts are not inputs.
Model point reads are recorded-only and cannot discover shared files. Model
timestamps and embedding suitability are checked without loading a model.

Current plan purpose and artifact/model permissions surround reads and egress.
Strict host and MCP/HTTP decoders reject private command/path/content extensions
and false readiness. Source labels and text are untrusted data and cannot change
commands, destinations or authority. Fixed failure codes do not expose private
repository or adapter errors. Recorded license metadata is not a license grant.
Physical/model availability, extraction, real retrieval, query egress and native
cleanup require their own subsequent execution checks; this preview qualifies
none of them.

### Approved dispatch and retained new staging

The internal admission interface contains trusted function capabilities and is
never deserialized from client/source data. Exact organization/actor/workspace,
canonical command digest and source storage/size/hash/media/format witnesses are
copied before asynchronous work. Current checks must cover the user-approved
plan, client and exact source/model authority before protected byte reads.
Reject extra fields, unsupported model/provider/placement settings, stale
commands and changed bindings. A synchronous live check closes the local await
handoff; only the issuer's atomic current-authority check grants one dispatch.

Staging copies bounded adapter buffers before later awaits. Defined descriptor
conflicts fail; omitted optional MIME/size is resolved without weakening exact
byte identity. Read/store bounds remain finite and source labels are data.
Denied attempts clean only new owned staging. Uncertain issue/start preserves
new staging and cannot retry, query/adopt a guessed task, or cancel an unknown
worker. Local retained attempts are capped; only the existing owning runtime
stop proof can retire them. No historical offload/native data is inspected.

Wrong task/type/scope terminal responses and wrong cancellation acknowledgements
cannot grant deletion or release power. Fixed errors contain no raw port paths.
Known accepted tasks keep reconciliation if later bookkeeping fails. Focused
unit and actual filesystem-adapter evidence uses synthetic sources and simulated
runtime/stop replies; it does not qualify physical model readiness, actual
Python stop, durable plan issuance, native recovery or public execution.

### Installation authority at approved start

Routine approved Context processing must not inherit ordinary runtime repair
permission. The controlled owner requires a separate internal installed-only
capability before reading source bytes. The registry has an explicit noninstalling
preparer, passive bounded snapshots and exact worker acknowledgements. Its
supervisor mode requires a successful read-only verifier and cannot join an
installing startup flight. The router never substitutes ordinary start. A fixed
bounded asynchronous probe returns no private output. Only a closed pre-dispatch
refusal releases new staging; unknown dispatch preserves custody and one-use IDs.
Focused negative tests cover policy mixing, stop during verification, missing
support, mutated requests, wrong identities and uncertain starts. Public host
composition, durable issuance and physical model/runtime proof remain pending.

The production composition now binds one host lifecycle to the foundation.
A synchronous guard at the captured spawn boundary closes the async startup
retirement race; guarded preparation and POST cannot fall back to ordinary setup.
Same-owner Desktop feature recomposition preserves this guard without replacement.
Before POST, bounded restrictive ownership retains exact task and reported scope.
Wrong task/workspace/organization replies cannot release that policy. Terminal
facts received before a lost/delayed start reply are retained to prevent known-ID
reuse and resurrection. Shared recovery captures restriction before owned exit
clears maps, then uses installed-only restart with the existing Dataset veto and
recovery fence. Simulated causal tests cover these controls. Real public Context,
model, native and parent qualification remain separate.

### Public approved source-derived Context tasks

Protect exact saved bytes, license declarations, approval, actor/client/tenant
identity, one-use task issuance and private output. Untrusted plan fields and
worker results cannot grant installer, model, publication or window authority.
Version 6 admits only bounded source-derived no-model packs. Both approval
channels show exact permissions; extra, missing or substituted limits deny.

Use a distinct Context receipt namespace and point indexes, checked in the same
root transaction as current approval and source metadata. A source digest covers
the private canonical command and complete admitted source/license witnesses.
No runtime or byte reads run in retriable transactions. Recompile before atomic
issue; only its acknowledged one-use result permits installed-only dispatch.
Reserved/issued uncertainty remains unconfirmed. A later ordinary task, matching
name, guessed UUID or foreign client cannot supply an accepted receipt.

Before polling the processor, prove exact durable accepted ownership. Recheck
authority after lookup, lazy resolution, polling and before reply. Copy request
and actor data before awaits. Return finite validated state/counts/fingerprint,
never raw processor results. Bounded confirmed IDs prevent in-session UUID reuse
from replacing an accepted task. Require result review and separate save. Bind
known license terms whole, preserve non-open/unknown states, reject conflicting
worker/descriptor declarations and do not infer rights.
Source-derived Markdown generation preserves declared terms in the archive
manifest even though its canonical request has no RAG source-check settings.
Unknown terms remain absent; the RAG attribution selection stays unchanged.

Focused tests cover substitution, revocation, lost acknowledgements, exact replay,
wrong namespace/identity, passive parsing, bounds, private-field rejection and
ordinary Data compatibility. Actual two-host pack journeys qualify only their
measured scenario. RAG/model readiness, explicit Context save/query/rebuild and
revocable presentation, native/offload and host-exit recovery remain pending.

### Admitted model references

Treat model metadata and files as untrusted data. Bind only selected exact
saved-record facts; public metadata editing cannot change host paths, ownership
or lifecycle. The application checks the current record and authorization before
and after bounded existing-file inspection. Explicit network references,
outside-root paths, missing safe weights and unsupported layouts deny admission.
The current callback must include model-read and exact approved-plan authority.

Only trusted composition supplies the private runtime reference. Public Context
start rejects it; the admitted parser copies a closed witness. Local-only safe
loading ignores mutable aliases and disables remote code. The worker excludes
the path from manifests, and the artifact reader reconstructs permitted model
fields before query. Admitted result validation rejects changed model/policy,
private fields and unselected attribution while retaining source license checks.

Root containment and file presence are cooperative checks. They do not establish
native custody, physical volume type, immutable file bytes or memory bounds.
They do not relax model-location mutation, offload or retained-tree safeguards.
Actual model/resource and public RAG qualification remain separate.

### Public approved RAG task boundary

The separately advertised RAG action uses a closed version-7 preview and current
model-read plus artifact/plan authority. It cannot introduce a path, installer,
remote-code option or external model/provider call. Both host issuers bind the
selected-model witness into the RAG source digest and recompile it transactionally
after staging. A private proposal-time model witness is retained across every
approval decision. New-start metadata validation, reservation and issue compare
against that witness; clock timestamps alone are not a model revision guarantee.
Changes present before a new start deny runtime preparation; changes during
staging deny issue, including when logical ID and timestamp stay the same.
Accepted historical receipts remain readable without
reopening the current model. Private bindings never enter public snapshots.
Exact pack receipt/key semantics remain unchanged; unconfirmed reservations
cannot be replayed as new execution. Approval views disclose model/device/policy
and remain separately authorized from execution. Bounded accepted-task review
never returns raw source text, vectors or private model references. Real model,
resource/native and later save/query/display controls retain their own evidence.

### Reviewed-result byte storage component

The byte publisher treats stream chunks and output descriptors as untrusted.
Its closed Context media types, 32-character opaque identity, captured workspace
and optional organization, nonempty 64 MiB size ceiling and exact SHA-256 reject
malformed input before publication. Intrinsic chunk length controls allocation;
a private copy is hashed and written. Full EOF size/hash validation runs before
the contained writer publishes the target. Conflicting targets survive and no
post-publication failure grants deletion or adoption authority.

This private port writes no catalog or binding. It cannot assert that the caller
owns a task or approved a save. Accepted-task ownership, exact review fencing,
one-use issue and atomic causal metadata remain obligations of the pending save
owner. Synthetic component tests cover bytes, scope, conflict, stream mutation
and sanitized failures only. Cooperative containment is not hostile native-race,
crash-recovery or physical RAG qualification.

### Internal result-save admission and metadata fence

The task owner rejects missing capabilities, foreign scope, a changed review or
unaccepted task before issue and file reads. Internal admission is never parsed
from client data. Unknown issuance or output/commit acknowledgement consumes the
attempt and forbids ordinary save/discard/cancel bypass. Private output selection
is read through bounded adapter chunks, with regular-file/link/identity/size
checks and exact final content verification. Unknown or conflicting data is not
deleted or adopted. Confirmed state is recorded before cleanup or response.

The result ledger associates one issued save with an accepted original task,
actor/client/host, source digest and independently rechecked review. Insert-only
catalog and primary binding share its causal-receipt transaction. The shared
composition requires a trusted exact-save authorizer against that same owner;
there is no permissive default or generation-approval substitution. Lost commit
reply reconciliation is one private point read and never disclosure authority.
This internal component alone supplies no public approval authority.
File/worker/native restart custody and physical retrieval remain independently
qualified obligations.

### Public save approval and passive saved metadata

The closed version-8 save request binds an accepted original task, review and
name to separate current artifact/plan authority. Generation approval cannot
authorize it. Metadata-only proposal checks use the retained owner; they cannot
initialize a runtime inside a transaction. Issue and commit recheck the exact
save and original actor/client/source association. Unknown outcomes cannot
repeat publication or bypass through ordinary save/discard/cancel.

An insert-only opaque Context index joins the causal receipt transaction. Passive
reads verify the exact index, owner, catalog and primary binding, then project
finite metadata under current workspace/artifact permission. Private owner facts,
handles, paths, source text and vectors never enter that projection. Saved-resource
read permission grants no original-task control. Version-1 private records are
not adopted. A metadata reply explicitly does not assert current byte readiness.
Synthetic SQLite/Core/SDK fixtures do not qualify real archives, models,
PostgreSQL concurrency, browser delivery, native races or process recovery.

### Proven non-start outcome integrity

Only trusted admitted-start control flow can produce a no-task-started marker.
No raw runtime field, exception, missing status, duplicate task ID or legacy
reserved/issued record can establish it. The marker is internal; public step
failure is only the fixed `headless.not-started` code. Source paths, model files,
queries and port diagnostics remain private.

A fresh owning call records the exact task/source/actor/client/plan identity in
a strictly decoded version-2 terminal task variant. Its original phase fixes
the expected revision. Counts and point indexes stay consumed; the outcome
cannot be reset, issued or accepted and supplies no task/save/window capability.
Unknown effects retain their existing staging and replay guard. Trusted outcome
recording after revocation grants no disclosure; current policy surrounds the
public reply. The SDK accepts the code only as a strict HTTP503 Context response;
ambiguous status/body or transport errors stay unconfirmed. These focused checks
do not qualify actual retrieval, native recovery or the parent increment.

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
