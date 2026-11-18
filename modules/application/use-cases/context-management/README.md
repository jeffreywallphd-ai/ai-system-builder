# Context Management Application Use Cases

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This area owns the workspace-scoped lifecycle for generating RAG databases and
portable Markdown context packs from cataloged artifacts or bounded manual
context.

`ContextGenerationUseCase` is the authority boundary between transport hosts,
artifact storage, and the runtime task registry. It:

- requires `artifact:read` for start/read and `artifact:write` for
  save/discard/cancel;
- resolves every artifact through the authenticated workspace before staging
  exact bytes in a private temporary directory;
- validates shared source capabilities, request limits, source digests, task
  ownership, contained result paths, and result digests;
- exposes successful runtime output only as a review-required candidate;
- writes durable bytes, an artifact catalog record, and a local binding only
  after explicit save; and
- compensates partial save failures and removes staged output on discard,
cancellation, or terminal validation failure.

`ContextBrowserUseCases` owns the saved lifecycle: workspace catalog listing,
exact-byte and digest verification, safe runtime inspection, source freshness,
bounded RAG test queries, source-only rebuild, and registered-artifact deletion.
Each RAG database remains one cataloged artifact blob with media type
`application/vnd.ai-system-builder.rag-database+lancedb+zip`; its embedded
database directory is internal package structure, never a storage root or
global singleton. The pre-release SQLite RAG format is rejected and is not
migrated. Unrelated application and system-runtime SQLite persistence is outside
this feature boundary.

Status transport failures retain active task identity, staging and power for
retry. Host-owned reconciliation validates successful output into review state
without a page read; it never saves that candidate automatically. Terminal
cleanup retains its owned directory until removal succeeds.
`ContextManagementCommandUseCase` is the single typed facade used by desktop
IPC and server API clients, including bounded generation/retrieval task lists.

Renderer selection and navigation state are not authorization. Public results
and diagnostics contain only bounded metadata, counts, lineage, and safe reason
codes. Source text, prompts, embedding vectors, model output, credentials, and
runtime paths remain outside public application state.

See `docs/architecture/context-management.md`, ADR-0041, and
`docs/security/context-management-threat-model.md`.

## Approved existing embedding models

The internal RAG path binds a selected saved-model witness to existing local
files through `ResolveApprovedContextEmbeddingModelUseCase`. It reads only
recorded metadata, checks the exact selected facts before and after filesystem
inspection, and rechecks current actor authority. Model discovery, installation
and network model downloads are outside this operation. Unsupported formats or
layouts stay unavailable; a missing resolver denies before source staging.

Only this admitted path can add `localModelReference` to the runtime request.
Public generation rejects that field. The runtime uses the checked local
reference with safe weights and disabled remote code, then omits the reference
from portable manifests. Admitted result review binds the logical model and
source-check settings. It preserves declared licenses in inspection and follows
the selected RAG attribution setting in the manifest. These controls do not
expose a public RAG plan or qualify physical model execution and retrieval.

## Acknowledged save compensation

Saving first requires an unused catalog identity. A refused or mismatched storage
acknowledgement does not grant deletion authority. An exact successful write owns
its new key for compensation, including any record already appended by the
filesystem adapter. A later Context catalog failure removes that record before
removing the acknowledged bytes, so ordinary retry does not leave a dead entry.

If catalog or object cleanup is unavailable, retain the exact current-owner key
and reviewed output. Save, Discard and Cancel retry that cleanup before any new
write or terminal release. They report an unavailable result until it succeeds.
This recovery record is transient application state. It does not adopt old files,
recover after process restart, establish native atomic ownership or qualify
unknown retained offload data. Existing binding/storage and native qualification
limits remain separate.

Composed both-client UI tests cover late catalog refusal, storage refusal, catalog
identity denial, exact-byte correction and cleanup outage/retry in new local
fixtures. Worker and inspection results are synthetic; actual model/runtime,
physical host and final combined qualification remain pending.

Save returns only fixed application-owned public messages. Arbitrary filesystem
and port exceptions use a generic failure. Refused storage, catalog and binding
results use fixed step messages without port text or details. Existing public
catalog/binding messages remain compatible. Cleanup still runs before failure;
a retry retains the same private review until its save succeeds.

## Preparation error boundary

Generation-start exceptions and source-staging exceptions use fixed public
messages. Refused binding and source-byte results retain their contract error
codes but use application-owned corrective text. Port messages, paths and
details are not reflected through these branches. Input validation, workspace
checks, staging limits, cancellation and existing cleanup ownership are unchanged.

Both-client composed regressions inject finite failures before worker acceptance,
check the registered response and UI, preserve input/source bytes and retry.
These cases do not prove real worker exit, native cleanup or terminal-runtime
error sanitization. Those qualifications remain separate.

## Internal approved start admission

`startAdmittedContext` consumes a trusted host capability, never a transported
command. It copies a canonical private command and exact source bindings,
requires an owning reconciler and current approved plan/actor/client/source/model
scope before byte reads, and checks a synchronous live fence at the handoff to
atomic one-use issuance. Only acknowledged issuance permits one runtime call
with the reserved task ID. Later withdrawal affects replies and remaining steps,
not the already admitted task. Source-derived no-model packs and explicit
CPU/CUDA RAG settings have the finite Headless profile limits.

Staging validates the selected storage key, actual byte count/hash and resolved
media/format. Descriptor media and size are optional; defined conflicts deny.
Catalog or approved canonical media supplies omitted MIME. A bounded private
byte snapshot prevents adapter buffer changes across awaited catalog checks.
This path cannot save or publish output; ordinary review-before-save stays.

A denied attempt cleans its newly created staging. Uncertain issue/start or a
mismatched start ID/state retains that exact new directory and lease without
task discovery, guessed cancellation or a second dispatch. Four uncertain starts
bound this local retention. Only a successful owning Python stop can retire an
unknown start. An ordinary confirmed start also keeps its staging if later power
bookkeeping fails; attach its lease before that bookkeeping.

While power registration is pending, observation/cancellation cannot report
terminal cleanup. Runtime-stop cleanup waits for that registration to settle,
then releases its actual blocker. This avoids creating a late power blocker
after a fast task or host stop has already attempted release.

Status ID/type/scope and cancellation ID/acknowledgement must match before
terminal cleanup. An unknown or mismatched status is unavailable, not a queued
or terminal proof. Invalid replies leave staging and power ownership intact.
Tests use fresh owned storage and simulated runtime/stop evidence. The internal
entry is not yet a public Headless action or physical model/runtime qualification.

The internal approved entry now requires `startTaskWithoutInstalling` before
source access. It never calls ordinary runtime start. Only the closed unavailable
result proves no business dispatch and permits fresh staging cleanup. The issued
ID remains consumed. Lost or contradictory responses retain the exact owned
lease. This additive path does not alter ordinary Context preparation and is not
yet advertised through public Headless host composition.

The separate internal `saveAdmittedContextResult` entry uses the exact accepted
task and current review fingerprint. It requires both optional result-byte and
owned-output ports and a trusted save-specific admission. It serializes review
actions, acknowledges issue before file effects, validates exact publication
size/hash/identity and delegates activation to one atomic metadata commit.
Unknown issue, byte or commit replies retain the attempt and prevent another
admitted or ordinary save/discard/cancel. Proven pre-issue denial creates no byte
effect. A confirmed save is recorded before staging cleanup or outward reply;
later failures cannot delete it or permit another write. Tests inject cleanup
refusal and lost acknowledgements in synthetic owned fixtures.

Private save compilation is metadata only. It exposes no raw output content or
path. The shared host composition requires an exact save authorizer in the same
root-owned transaction and performs one exact read-only reconciliation of a
possibly committed reply. It does not provide a public save action, native
restart recovery or physical RAG/retrieval qualification.
