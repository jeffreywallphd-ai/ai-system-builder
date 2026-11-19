# Desktop host composition

The existing Model download application owner has an internal approved-source
entry. It retains original organization/principal, exact source, issuance ACK
and a bounded reconciler lease before dispatch. Lazy runtime composition uses
the foundation's captured cache/session with existing model storage. Missing
support never falls back to ordinary installation. Original result handles
survive shared task-history eviction; unknown starts are not discovered by ID.
Source transfer does not register a Model. Public scoped plans and actual
desktop qualification remain separate work.

The separate lazy Model source owner is available only with organization
documents and new native-consented `modelSourceRead` plan-review pairings.
Existing registrations retain earlier permissions and need a new pairing for
this provider/key-use permission. Source dispatch requires both current
registration and the live HTTP read fence after authorization; accepted tasks
keep their independent lifecycle. SDK, credential, request and egress call sites
check currentness synchronously after awaited policy checks.

Desktop resolves one immutable Python runtime endpoint during explicit lazy
foundation composition. Explicit valid loopback settings retain their meaning.
Without a configured port or base URL, the network adapter asks the OS for a
nonprivileged `127.0.0.1` port and closes its temporary listener before launch.
Both client and child receive that same endpoint. Passive status never selects
a port. Selection proves availability at that time, not a reservation through
worker startup; authenticated readiness and owned lifecycle checks still apply.
Do not restore the old PID-derived default in active composition.
The managed adapter also requires its current child's private bound-ready proof
before health or business HTTP. A healthy unowned responder cannot establish
readiness. Worker-exclusive binding and captured launch fences are adapter
controls, not renderer authority or a retry grant.

The retained Context Browser's private query owner receives the same original
installed-model resolver as generation and the existing reconciler's admission
fence. It requires exact saved bytes and source/model policy before installed-only
dispatch. Status retains only source-checked numeric citations. Existing runtime
cleanup observation is separate from completion and admission capacity. No public
query plan or query-summary handoff is exposed by this composition component.

`context.preview-query` is a separate optional plan-review metadata provider.
Current artifact/model permission and registration/liveness surround its output.
It hashes transient question text and compiles the exact saved Context's original
source/model metadata through the platform owner. It never resolves the lazy
Context/model runtime, reads source bytes or creates an execution grant. The
question stays out of records/results; transport request buffers retain their
existing bounded lifetime. Separate version-10 approval below permits queries. Query display uses separate window consent; physical qualification remains pending.

Context window intents use current artifact-read permission and the existing
separate window consent. The shared Context presentation reader verifies an exact
committed saved reference or accepted same-host/actor task before observing the
cached Context owner. The cache is populated only by existing feature use;
presentation never calls the lazy feature initializer. Missing owners deny.
Accepted-task observation retains owned output validation and existing worker
recovery under the original task lifecycle; display grants no new business task.
Fixed status/counts and opaque selectors cross the display boundary; source bytes,
models and query text do not. Lease retirement stops new display/context while
preserving independently authorized Context work. Query summaries use the separately consented selector below.

`context.preview-rebuild` is a separate optional plan-review metadata provider.
It requires current artifact/model permission and verifies immutable recorded
inputs through the platform owner. It never initializes the Context execution
owner or turns historical approval into a new grant. Physical readiness remains
not checked. A new version-9 generation approval can separately bind `rebuildOf`.
The shared compiler verifies exact current parent/source/settings/model facts
before lazy owner resolution and at final issue after staging. It uses the same
installed-only owner and accepted-task receipts, creates a new review-required
result and overwrites no parent. Query, display and physical qualification remain
separate. Original generation and save previews retain their fingerprints.

The Context artifact adapter shares the host's existing Python task reconciler
with generation. Fresh inspection/query inputs remain owned through uncertain
replies and cleanup failures. Only exact terminal status or successful owned
worker stop settles them; cancellation alone does not. This ordinary Browser
wiring grants no installed-only headless query or physical qualification.

Data window presentation composes the existing saved source/version repositories
and dataset owner through `headlessDataPresentation`. Current artifact-read
authorization surrounds reads. Only a durably accepted same-host/actor task can
resolve the lazy processor. A separate presentation registration grants display
only; ordinary plan-client ownership still governs execution/status/review/save.
No model, file-byte or provider work starts from a presentation intent. Existing
lease/document/egress controls stop display on revoke without deleting Data work.

## Restrict automatic ComfyUI setup

Set `COMFYUI_AUTO_INSTALL=0` in the Desktop host environment before launch to
disable automatic ComfyUI installation and dependency repair during image runtime
startup. The host snapshots this value when it composes the feature. An unset
value or `1` retains the existing automatic setup behavior. Other values stop
composition with a fixed configuration error.

Before every start with automatic setup disabled, the host reads the installer's
managed metadata for the exact root, target and official Git source. Missing,
unconfirmed or mismatched metadata stops startup with a fixed error. The read
cannot fall back to installation or repair.

This setting does not disable explicit installer operations or Python runtime
setup. Managed metadata does not prove file integrity or import readiness. This
setting does not prevent the launched
runtime's own network activity, or grant model download authority. Test profiles
must still verify their prerequisites and own the runtime process and files.

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`composeDesktopHost` wires desktop-host lifecycle dependencies while keeping Electron IPC transport thin.

The main process can obtain an internal headless read handler after IPC
registration, when the host has an authoritative local identity. It uses the
same saved-system readers as IPC and refuses stale, unauthorized and closed
requests. The optional connector does not start at launch. An owned desktop
window must explicitly confirm starting it for an approved workspace or
approved existing clients. The main process presents the code in a native
dialog. The connector stops admission and drains its work before persistence
closes. Pairing, status, and reads do not start a model runtime.

Current composition includes:

- artifact-object storage via filesystem adapter,
- local artifact catalog and storage-binding persistence,
- artifact-browser read + media retrieval use cases,
- artifact-repo storage composition with Hugging Face provider registration.

## Desktop artifact authorization and sender trust

When the production desktop host has its persisted local identity, it composes
workspace authorization from the canonical organization and membership
repositories. Artifact reads, mutations, uploads, and publication resolve the
local principal and workspace before protected storage/provider work. Artifact
publication requires `artifact:write` and `provider-credential:use`; creating a
missing provider repository additionally requires
`provider-repository:create` and explicit creation approval. Authorization
decisions are written to the dedicated host-owned security audit log, separate
from normal diagnostics.

Electron transport trust is supplied by the app main process, not inferred by
feature code. Artifact handlers accept only invocations from the main frame of
a live desktop window owned by that process. Tests may inject a bounded trust
double, but production registration must use the owned-window policy.

## Hugging Face token configuration

- `composeDesktopHost` passes `options.artifactRepo.huggingFaceAccessToken` into the Hugging Face adapter.
- If that option is omitted, the adapter falls back to `HF_TOKEN`, then `HUGGING_FACE_TOKEN` in the desktop host environment.
- Desktop renderer artifact-repo operations (`register`, `localize`, `publish`, `verify`) use this host path via preload/IPC and therefore depend on desktop host token configuration for private/gated repositories.
- Public Hugging Face repos may work without a token; private/gated repos surface explicit auth-required (`unavailable`) errors.

## FaceID behavior (Image Generation)

FaceID is optional in the image generation feature. When enabled in the desktop UI, users can select 1-3 uploaded image artifacts as face references and pass FaceID tuning parameters (identity/structure/noise) with the generation request payload.

The managed ComfyUI workflow prepares selected image artifacts into the runtime input directory and uses the first FaceID reference as an image-to-image latent source when no explicit latent reference is selected. This keeps facial retention usable without requiring custom InstantID/InsightFace nodes in the local runtime install.

## Feature lifecycle disposal policy

Desktop host composition keeps core startup services resident and treats feature disposal as an explicit lifecycle concern of host-owned lazy providers. Local foundations such as artifact storage, model registries, asset definitions, settings, workspace shell, logging, diagnostics, and runtime readiness remain resident or warm after first use. Clearly transient features such as artifact remote/Hugging Face adapters, website ingestion, dataset preparation without active tasks, Context Management without active generation/retrieval tasks, and image generation without active tasks may be disposed by explicit developer action or scoped idle timeout.

Context Management is composed lazily over the retained artifact and runtime
foundations. Its generation, browser, retrieval, deletion, and task-list
operations share one application facade, and active context tasks block generic
feature disposal.

Generic disposal must not delete persisted records or files, must not stop Python or ComfyUI, and must not cancel active runtime work. Python process stop, Python model unload, and ComfyUI process/runtime unload remain explicit user/runtime-control paths.

Explicit Python-backed execution requests such as dataset preparation use the
desktop host's bounded capability activation seam. When readiness initially
reports the lazy Python runtime as stopped, the execution guard starts the
supervisor, reads live supervisor-backed readiness again, and proceeds only when
the requested capability is ready. Passive readiness, task status, list, and
cancel reads do not start the runtime. Startup or readiness failures remain
fail-closed and expose only sanitized capability details.

Desktop Python composition canonicalizes both the worker bind and client base
URL to host-owned loopback HTTP, then delegates per-launch bearer generation and
rotation to the shared Python runtime foundation. Runtime launch credentials are
child-only state and must not be included in desktop logs, diagnostics, preload,
IPC, or renderer data.

Image resource views use the private organization/workspace identity port backed by
structured persistence. Public image/output/artifact/cursor aliases are random and
persisted; exact source reauthorization is required on every detail read. Reserved
CAS publication is private until both indexes agree and the source revision commits.
Unassigned/legacy JSON storage and old source-derived references never trigger a
compatibility identity fallback. See ADR-0043 and the asset/package threat model.

First-use asset composition still waits for validated Foundation definitions and
trusted implementations. Bounded bootstrap batching reduces that work; readiness
never skips integrity checks. Foundation failures retain the generic public
message with safe internal stage/version/count/code attribution.

Website ingestion receives the same canonical artifact catalog for compensation
as stream publication. Exact new capture bytes are deleted before their catalog
entries. Generic storage deletion, workspace authorization and native guards
retain their existing responsibilities.

The host retains a closed startup report outside the lazy Python foundation promise.
An uncomposed or rejected foundation remains readable without another composition.
Only actual start-attempt callbacks and existing preparation observations update
that report. Selected command/environment stay private; old/coalesced callbacks
cannot replace a newer attempt. The existing status operation carries the optional
report separately from legacy logs and model inventory. No persistent sink is added.
Effective command, arguments, capability list, bound health methods and private
environments are captured before startup observers. The trusted launch seam writes
the rotated bearer into its attempt-local child environment; HTTP authentication
keeps the same private token closure. Attached health failure updates its existing
attempt without inventing a new launch.

The Headless read composition resolves passive Context previews from the
organization's stored ingestion/version/model metadata. It never resolves the
active Context/runtime feature for preview. Plan-review purpose and current
artifact/model permission surround reads and replies; private commands stay
inside the application owner and model readiness remains unverified.

## Installed-only Context runtime

The Python feature configures the bounded async installed-environment verifier.
Task composition binds the foundation's exact retained host owner once and
reuses it on feature recomposition. Its restrictive readiness and Python POST
paths check admission; neither calls ordinary Context dependency preparation.
The foundation enforces the same owner at the actual spawn boundary and in
shared recovery. Missing support refuses without ordinary-start fallback.
Held-verifier, health and final-launch tests use the actual foundation/composition
with simulated process/HTTP replies and prove no spawn after host retirement.
Actual public Headless Context execution and physical model readiness remain
separate qualification.

Desktop Headless plan review also composes opt-in source-derived Context packs.
The shared exact-source compiler runs inside the owned plan transaction; bytes
and installed-only task dispatch stay outside it. A separate Context receipt
records one accepted task. `context.task` proves actor/client/host ownership
before the lazy Context feature is resolved. Both approval views list fixed
limits and separate review/save requirements. Source text and paths stay private;
ordinary Context UI and Data behavior keep their existing owners.

The internal RAG owner also receives a lazy saved-model resolver. It checks the
current record and existing safe-weight layout under the configured model roots
before source staging or issue. No-model packs never open model features for
this seam. Private model references stay within the runtime request; ordinary
Context generation cannot supply them. File inspection is cooperative and grants
no native mutation or offload authority. Public RAG and actual model execution
remain separate qualification.

The public plan connection separately advertises local RAG generation. Its
version-7 approval discloses model/device/source policy; current model-read and
artifact/plan authority apply to proposal and execution. The shared issuer
recompiles the exact saved-model witness after staging before a one-use start.
Accepted task review stays bounded and requires separate save. Physical model,
retrieval, later query/display and parent qualification remain separate.

With structured metadata configured, the artifact feature also supplies the
private Context result-byte publisher and owned-output reader. The Context
feature injects both into the existing generation owner. Missing capabilities
deny admitted saving before issue. Ordinary Context saving keeps its current
path. That internal composition alone grants no public save authority.

The public version-8 `context.save-result` step now binds its own exact approval
and current artifact/plan permissions to that metadata transaction fence.
Proposal validation uses only the already instantiated retained Context owner;
it never initializes the runtime inside the transaction. Confirmed receipt replay
does not require the owner to remain loaded. `context.saved` is a separate passive
indexed metadata read with current workspace/artifact permissions. It provides
no archive-readiness, query, rebuild, model or window qualification.

The opt-in version-10 `context.query` plan binds a saved RAG, original model,
question hash and explicit query bounds. Approved execution carries text only
in its transient envelope. Passive preview separately hashes its input; neither
stores the question in the plan. The retained query owner records exact acceptance once; fresh task
reads require current artifact and model permission and return citation-only
summaries. Query tasks cannot grant a generation save. See
`docs/architecture/context-management.md` and the portable Context skill guide
for request lifetime, owned policy, uncertainty and pending qualification limits.

The separate `show-context-query` window selector displays an exact accepted
query's fixed status/count/settings/hash/cleanup summary. Current artifact AND
model read and existing window consent guard display and fresh context. Accepted
same-actor/workspace/host lineage precedes cached Browser access; no lazy feature,
new query/save, source sharing or task adoption follows. Context shares only the
selector and view IDs. Generation-task display retains its artifact-only policy
and rejects query DTOs. Controlled feature checks leave physical and actual-host
qualification separate. See the Context architecture and portable skill guide.
