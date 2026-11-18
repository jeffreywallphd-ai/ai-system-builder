# Context runtime and approved start ports

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`ContextArtifactRuntimePort` owns bounded source/artifact inspection and query
calls. It is active runtime work, not a passive metadata reader.

`ApprovedContextGenerationAdmission` is an internal capability supplied by the
trusted host after a current user-approved plan step. Never deserialize it from
a client command or place it in request context. It binds the reserved task,
organization, actor, workspace, canonical private command and exact saved source
bytes. Its current checks must include the approved plan/client/source/model
authority. The issuer must atomically revalidate that authority and issue the
exact attempt once. A timestamp or this data interface alone is no authority.

The controlled profile accepts up to four sources of 4 MiB each and 1,000 chunks.
It supports source-derived packs without summarization and the bounded CPU/CUDA
RAG command shape. Admitted RAG also requires a copied saved-model witness and
the optional installed-model resolver. The host's current-authority callback
must cover model read, exact plan/client/actor and saved-record permission.
Resolution inspects existing files after approval and before source staging or
issue. It neither installs dependencies nor grants provider transfers.

Unknown start replies retain only the new attempt's own staging and lease.
Reconciliation must not discover or adopt an unknown task. Retirement requires
the existing owning runtime's successful stop proof. Native/offload and process
restart recovery remain separate qualification. See the
[Context architecture](../../../../docs/architecture/context-management.md).

Approved Context start also requires the explicit installed-only runtime task
capability before source reads. A proven pre-dispatch refusal releases only its
new staging; the approved attempt ID stays consumed. Exceptions, malformed
proofs and uncertain starts keep their owned staging. The host must compose the
noninstalling registry and supervisor path; ordinary start is not a substitute.

`ContextInstalledEmbeddingModelFilesPort` has only cooperative file inspection.
`ResolveApprovedContextEmbeddingModelUseCase` owns exact metadata and authority
checks around that port. A private runtime reference does not prove valid
weights, native custody, immutable bytes, resource capacity or model quality.
Public RAG plan wiring and actual model qualification remain separate work.

`ContextResultByteStoragePort` is an internal byte-only publisher for a future
reviewed-result save. Its caller must bind the accepted task, review fingerprint
and one-use save approval separately. It accepts an opaque publication identity,
finite Context media type, exact nonempty size and SHA-256, and derives its key
inside the captured workspace. It has no path, overwrite, catalog/binding or
delete operation. A successful byte acknowledgement is not a saved Context.
The result-save owner and atomic metadata receipt remain separate work.

`ApprovedContextResultSaveAdmission` is the separate internal save capability.
The host must bind it to a current save-specific approval, exact accepted task,
actor/workspace and review fingerprint. Only an acknowledged one-use issue
permits publication. Its metadata-only commit must register catalog, primary
binding and causal receipt in the same root-owned transaction. A general task
start approval is not a save approval. No client command can supply this port.

`ContextResultOutputSourcePort` reads only the task owner's already selected
private output. Its runtime directory/handle never come from a transport. The
filesystem implementation checks a private regular file, captured identity and
size, reads at most 64 KiB per chunk plus one excess-byte check, and closes its
handle on completion or failure. These cooperative checks are not native custody
or crash recovery. Public save approval and routes remain separate work.

`ContextArtifactRuntimePort.queryAdmitted` is optional and private. Its trusted
caller must resolve the original safe model and bind current actor/client/plan,
saved artifact, source freshness, citation allowlist and egress policy. The port
accepts copied exact query/artifact hashes, bounds, explicit device and existing
model reference. It uses only installed dispatch and one acknowledged issue.
The `accept` callback records the exact acknowledged task for an owning async job;
it is not public task discovery. Ordinary `query` remains unchanged.

A private non-start result requires no possible dispatch/unknown issue and no
retained staging. Unknown replies retain the existing lease; `cleanupPending`
describes that result snapshot. Confirmed terminal processing or result-delivery
failure is not non-start. A capability cannot be reused for another call. Raw
matches stay application-private, and this seam grants no transport query,
content-sharing, model/runtime installation, physical readiness or parent pass.
