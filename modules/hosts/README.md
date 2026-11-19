> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

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
