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
It supports source-derived packs without summarization and explicit CPU/CUDA
RAG embedding settings. It does not validate physical model availability, install
dependencies, grant provider transfers or expose a new public execution tool.
The future host composition must prove readiness and compose durable issuance.

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
