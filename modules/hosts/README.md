The private `createOriginalHeadlessTrainingTaskOwner` wraps the existing training
bridge. It reserves a bounded slot before awaiting the original start resolver
and captures the returned private task before ledger acceptance. A caller timeout
or lost acknowledgement cannot release possible work or trigger another start.
Only positive original non-start proof releases that slot; terminal status or a
cancellation acknowledgement does not settle physical resource custody.

Training status and cancellation use exact accepted training-ledger lineage and
proposal digest. Require fresh caller, host and business policy in owned metadata
transactions, then invoke only the captured task outside those transactions.
Capture callback methods and receivers before waits, and recheck authority before
disclosure. Cancellation is at most one original request, including unknown
replies. No generic lookup, download-task namespace or replay can adopt a task.

Closed private summaries expose finite progress and pending-review availability.
They expose no paths, logs, raw data, recipes or model scores and grant no result
Save. Issued-only records cannot be adopted through accepted-task reads. These
controls do not activate public roots, supply a native producer or qualify actual
execution, resource retirement or hosts. Core/SQLite and inert application tests
are component evidence; model-quality tests remain excluded.

The internal `runPreparedHeadlessModelTraining` bridge composes the exact stored
training step with the existing private Model/Dataset readers and
`TrainModelUseCase.startApprovedLocal`. Reads and intrinsic byte copies occur
outside metadata transactions. Compare the complete current minimized Model,
Dataset version and recipe with the original stored binding. Retain that
binding's original proposal digest, including its supported legacy encoding.
Only selected training inputs enter private runtime aliases. With saved splits,
use train/validation bytes and exclude held-out and aggregate artifacts. Without
splits, preserve the existing prepared-Dataset training profile. Original source
artifacts stay excluded in both cases.

The bridge preserves original callback methods and receivers across waits. It
uses fresh request/approval admission and the original synchronous step fence
for starting, with separate original-actor Model/Data business permission for
the accepted task's lifetime. That business control is independent from entry;
acceptance can precede the outward start reply while a power hook waits. Capture
the returned private task synchronously
before awaited ledger acceptance. Unknown start/retention/acceptance replies
keep the original owner and never trigger a new start. Replay resolves no
reader, Model owner or runtime. Publish only finite correlated task references
through the existing approval/publication fence. The training result codec
requires its own explicit opt-in and grants no other capability.
The publication wrapper rechecks the captured caller policy. A separately
authorized historical receipt does not require a renewed business-write grant.

Both public roots remain unconfigured for this bridge. No native producer,
resource/readiness guarantee, task transport, result Save or physical/parent
qualification is supplied by controlled Core/SQLite application fixtures.

Managed approval treats both a model download and saving its downloaded reference
as Model writes. Require current `model:read` and `model:write` when opening the
review, deciding it and publishing either response. Recheck through the existing
transaction and stable-read publication seams. A later execution check does not
replace approval-stage policy. Ordinary plans and the existing separate result
save approval stay unchanged; source fixtures grant no actual host qualification.

The shared `composeHeadlessModelTaskReaders` factory supplies original-task and
cached-completion callbacks for the existing Desktop and Managed read handlers.
It rebuilds the original actor's current workspace and ModelRead policy in the
platform metadata owner, and reuses the accepted task/client/host ledger. It needs
no ModelWrite grant. The owner callback only peeks an already retained Model
instance. No feature, provider, runtime, generic task lookup or write is started.
The helper installs no route; public root activation and physical qualification
remain separate. SQLite composition tests are local evidence, not PostgreSQL or
running-host qualification.

Optional completed Model read bindings use the original accepted task/source ledger and
already loaded application owner. Copy exact task/plan selectors, scope and
request callbacks before awaits. Authorize ModelRead in owning transactions
before and after the cached completion read; that read runs outside transactions
and never refreshes status, resolves a runtime, inspects files or saves a record.
Return a strict historical summary only. Approval expiry/revocation preserves the
accepted result, while current original-client/workspace/read policy still gates
its disclosure. Missing or uncertain completion stays not ready. Real host reader
compositions, HTTP and SDK codecs independently validate copied targets and
finite replies. Unconfigured roots do not advertise the operation. Product
activation, current-file/save proof and physical/native/provider qualification
remain separate work.

Headless Model readers may receive an optional `readModelTask` binding to the
original accepted ledger and cached source owner. It accepts exact task/plan-step
selectors under current plan-review, ModelRead, original client and request
authority. It returns finite progress, with no private errors or lazy feature
construction. Both hosts validate the reply and reauthorize disclosure.
Unconfigured roots omit the operation. This component grants no transfer,
cancellation, registry save, readiness or native/provider/parent pass.

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Private Model execution now selects the exact stored approved step in both hosts
and reuses the existing source runner/application owner outside transactions.
Once selection identifies a Model step, every captured reservation, issue and
dispatch fence includes its operation lifetime. Desktop requires the separate
trusted `isOperationCurrent` grant callback; a short metadata `isReadCurrent`
deadline is not substituted. Managed support requires a separate strict actual
host-current callback. Capture original operation/read callback identities before
waits; replacing a grant property cannot revive either retired request. Accepted
tasks reconstruct current original-actor/workspace ModelRead/ModelWrite policy,
independent of request, token,
ambient organization context, approval deadline and window. Keep accepted receipts
and unknown custody; replay resolves no runtime owner and known non-start stays
terminal. Public roots, transport activation and registry save remain pending.

The private Model review option prepares pinned provider facts before the owned
proposal transaction in both hosts. Require current source-read consent, read
lifetime, workspace ModelRead/ModelWrite and credential-use policy before lazy
source resolution. Its binder compares the full copied request list, original
target and each Model step; it performs no I/O. The transaction rechecks policy
and currentness. Existing trusted popup/chat approval owners have a separate
stored-review opt-in and require current ModelRead/ModelWrite; they receive no
proposal method. Model status uses current consent/policy without another provider
call. Ordinary plans keep their fingerprints and dependency requirements. Actual
roots/transports and public Model step execution remain disabled pending full composition;
controlled local SQLite fixtures do not qualify PostgreSQL, real UI or provider IO.

The private shared Model task control proves an accepted original-client task or
plan-step and its exact source digest in the platform-owned metadata transaction.
The host supplies fresh ModelRead policy for observation and ModelWrite for Stop.
It touches only an already loaded Model owner, outside the transaction, and
rechecks policy/lineage before returning finite state and numeric progress. A
cancellation acknowledgement does not claim worker or receiver shutdown. No
owner, unknown start or foreign identity yields no task discovery, initialization,
ordinary fallback, registration or retry. Real host route activation, source save
and physical qualification remain separate pending work.

The private shared Model step runner composes the opt-in approved-step owner with
the existing Model download use case outside its metadata transaction. Capture
original actor/workspace/plan and use fresh request/approval admission through
the issue acknowledgement. The application captures a separate synchronous
admission-only fence immediately before source-port entry. It does not become
accepted custody: retain original host lifetime and current original-actor
business ModelWrite afterward, independently of HTTP/token/window/deadline.
Record the original admitted result even after outward access ends, then require
fresh exact policy/approval before publication. Known non-start remains terminal;
unknown ACK/start/reply cannot discover another task or retry. Replay resolves no
runtime owner. Real Desktop/Managed capability flags still use legacy preparation
and remain disabled until public status/save/composition qualify. Controlled
application fixtures do not qualify actual provider/native dispatch or parent work.

Headless `models.preview-source` uses a separate lazy organization-pinned Model
source owner. Desktop caches only that optional provider owner; Managed reuses
its configured credential-aware Model provider. Neither path warms the active
Model/runtime/task feature for preview. Plan-review purpose, strict currentness
and workspace/model-read/provider-credential-use policy fence ownership, each
provider phase and egress. Both readers verify target and normalized metadata
digest. Model inventory/record reads remain provider-free. The source read grants
no acquisition, byte verification, rights or readiness, and real host/model
qualification remains separate from the controlled composition fixtures.

Headless `models.inventory` and `models.record` use the shared passive
`composeHeadlessModelMetadata` factory. Both real bootstraps load it lazily after
the purpose-specific readers check workspace/model authority. It pins one
organization document partition, uses recorded-only ModelRegistry reads and
supplies no Model feature, runtime, task or provider. The readers capture actor
and request targets before awaits, require immediate boolean currentness, repeat
authorization before egress and independently decode minimized replies. Recorded
status is not readiness or supply qualification. Actual-host qualification is
separate from focused composition fixtures.

Generation snapshots in desktop and server copy only the optional sanitized
accelerator total from the current authenticated Python capabilities response.
They do not query an ambient GPU or carry a prior worker's total across reads.
Missing, malformed or failed worker observations stay unknown. Installed capacity
guides an initial recommendation; live worker admission, readiness and offload
ownership remain separate mandatory checks.

Desktop and server bind Studio, packages and derived customizations to the existing
workspace asset guard and their organization operation authorizer. Application
entries require an exact persisted active workspace before source/artifact or
lifecycle effects. Derived readiness also follows authorization. The server's
request-scoped organization store remains mandatory; no local or legacy fallback
is introduced when authority is absent.


The shared workspace-summary composition uses repository-owned scalar/identity
projections with explicit workspace and group authority. Both hosts bind it to
organization-scoped stores. Desktop uses independent model metadata readers and
local artifact metadata/storage checks; summary reads do not start model runtimes
or the Asset Studio coding model. Missing host authority stays unavailable.

Composition plan use cases and read models require the shared workspace asset
guard in both hosts. It resolves the exact persisted active workspace and applies
the existing organization/membership authorizer before protected I/O; missing
authority denies. Validation writes state and requires asset write authority.

Runtime lifecycle callbacks bind the accepting organization context. Both hosts
close task admission before worker shutdown and reconcile owned resources before
persistence closure. Image task authority outlives disposable feature UI and
requires persisted workspace authorization; a cache key grants no ownership.

Desktop image, dataset and Context controllers are lazy retained. Generic cleanup
cannot discard their pending reviews or finalization receipts; it does not query
unscoped public task listings. Other disposable providers serialize replacement
with cleanup and retain the existing owner on uncertainty. Heavy processes keep
their explicit stop/unload policies.

Shared Asset Library composition binds authored assets, revisions, drafts and
overrides to the same organization-scoped document store as the workspace. Custom
list and detail reads require persisted workspace sources; metadata grants no
authority and another workspace or organization cannot read those definitions.

Desktop's lazy System Builder and reuse readers preserve the same ordered batch
detail method as the scoped registry. Opening the host does not initialize that
feature. An admitted batch forwards its original workspace/options once; reader
failure propagates without replaying one full collection read per component.

Both hosts compose the same typed atomic Studio/customization publisher. Desktop
keeps definitions in the captured organization partition; server retains its
existing platform definition partition and request-owned workflow records. The
server transaction spans those existing partitions on one structured store. The
placement is fixed by composition, never a request field. Workspace authorization
and desktop sender admission remain separate required controls.

Legacy authoring IPC and API now receive the authorized workspace read facade,
while all seven mutation use cases receive the same persisted-workspace policy.
Desktop rechecks current membership even after sender admission; server resource
checks supplement its existing organization middleware. Raw internal repository
references remain internal and confer no public legacy read bypass.

Read-policy and repository failures settle as fixed unavailable API/IPC responses.
Missing required fields retain validation failures. Focused tests cover every
public read, query capture and current persisted membership. No request may
fall back to raw repositories after access is denied.

Package composition passes the existing persisted workspace/current membership policy from an early host guard, before eager server package construction. Desktop package wrappers capture commands and admit resource access before deferred feature loading, then application entries reauthorize. Upload copies at both boundaries remain bounded by the existing32MiB production default. This does not qualify Studio/derived authority, atomic publication or physical hosts.

Desktop Studio requests capture their contract values and check persisted workspace access before deferred feature construction. Shared Studio composition supplies the same policy to application use cases, which recheck access after readiness. Finite composition fixtures do not qualify physical app startup, process restart or durable storage.

Desktop derived-customization IPC validates and captures the request before awaiting its deferred service getter. The getter receives only the registered operation key and normalized captured workspace; it maps fixed read/write scope and admits before feature construction. Missing or rejected feature loaders retain fixed unavailable envelopes. Application and catalog admission repeat after readiness. Finite handler fixtures do not qualify physical app startup or durable restart.

Shared Asset Library composition also supplies the two existing private Studio and derived published-reference readers from the workflow organization store. They add exact published definition visibility only; they create no implementation release, backing row, activation or execution authority.

Model task replies now include workspace and plan fingerprint/step read from the
accepted dual-index ledger lineage. The owning helper checks the same lineage and
source again after observation. Hosts, API and SDK validate these owner-supplied
fields against the captured selector; they never stamp expected request fields
over a mismatching reply. Desktop task observation also requires the captured
HTTP read-current fence through the final awaited policy return and owner entry,
separate from registration and accepted business-task lifetimes. Held-policy and
same-workspace displaced-plan regressions preserve these boundaries.

Private Model plan compositions may opt into `cancelModelDownload` using
`peekModelDownloadTasks`, which must return only an already loaded original
source owner. Desktop captures its registration and operation callbacks.
Managed also requires the existing stable metadata proof and independent actual
host callback. Both reread current ModelRead/ModelWrite and exact accepted
client/actor/workspace/task lineage. The last policy check and source cancellation
run outside transactions. Once an effect may have happened, failed/withdrawn
outcomes are unconfirmed. Acknowledgement does not settle native custody.
No ordinary fallback, restart, registry save or public activation follows.

Both product roots connect the original-task and cached-completion read bindings.
Desktop retains the original download owner only after its existing lazy Model
feature is constructed. A read only peeks that owner. Managed uses its original
application owner. Each binds the platform transaction store, current tenant
placement and original host lifetime; shutdown denies further disclosure.
These read bindings do not configure Model download, training, cancellation or
save approval/effect paths. Source-wiring checks and controlled reader fixtures
remain separate from actual app/provider/native and parent qualification.

### Private training approval preparation

The shared private training-review helper reuses the existing application compiler
and original saved-input reader. It copies the exact target/requests, captures
callbacks and the input reader across all awaits, and prepares minimized metadata
outside the owned proposal transaction. Its binder only compares the original
organization/actor/client/host/workspace/plan and request list; it performs no file,
provider, model or runtime work. Current transaction policy remains mandatory.

Private version-4 storage support does not configure a host capability. Public
permission queries, source validators and legacy execution still refuse training.
Actual training/task control, result Save and resource/native/host qualification
remain separate implementation work. Software fixtures do not rerun model-quality
checks or grant another app/Native test attempt.

Download source and saved training-input preparation share the same private
Model-review reader capture. Capture the returned reader synchronously as soon
as its factory resolves, before the post-factory policy await. Keep that exact
reader for every selected step, including after provider waits. Inspect bounded ordinary prototype method
descriptors; refuse accessors/proxies without invoking them. Retain the original
receiver through a frozen facade without reading function name/length getters.
Recheck policy before metadata invocation or reporting reader availability.
