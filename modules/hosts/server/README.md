> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

The existing Context Browser now also owns private admitted queries through the
original safe-model resolver, strict saved bytes and installed-only query port.
Both current policy and existing shutdown admission fence are required. Runtime
ACK/durable acceptance, public disclosure and cleanup retirement stay separate.
This internal component supplies no public query plan or physical qualification.

Managed `context.preview-rebuild` is plan-review-only indexed metadata. Current
organization/workspace/artifact/model authorization surrounds its result. The
platform owner validates the original saved/build/source/model lineage without
runtime access, historic permission reuse or private-field disclosure. It supplies
no approved rebuild execution or physical readiness.

Managed `context.preview-query` prepares a transient question hash with exact
saved RAG and original source/model metadata. Current plan-client and workspace/
artifact/model read policy surround it. The app stores/returns no question text,
and initializes no model/runtime or source-byte read. Existing request limits
and not-checked readiness remain; actual query execution is separate work.

A separate version-9 generation approval binds `rebuildOf` to that saved parent.
The shared partition-owned compiler verifies original inputs/model and current
permissions before lazy owner resolution, at reservation and at issue after
staging. The installed-only owner creates a new task/result; exact replay does
not dispatch again, and saving needs its own review/approval. No parent overwrite,
historic task adoption, query, display or physical qualification is implied.

Context artifact inspection/query uses the same organization-bound owned-task
reconciler as generation. Uncertain replies keep fresh inputs until exact terminal
status or successful owned Python stop; cleanup failure retries without adopting
another task. This ordinary Browser wiring grants no installed-only headless query
or physical retrieval/resource qualification.

The optional typed `pythonRuntimeEnvironmentPreparer` is an explicit
nonproduction composition seam for controlled host tests. Direct composition
and the server application reject it in production before initialization.
Default managed Python/context preparation and its failures remain unchanged.
The callback is captured once; defined production overrides and malformed
nonproduction values fail before initialization, including false, zero and null.
No API or environment option skips preparation; the host continues to own
worker launch, rotating credentials, capability negotiation and termination.

Image resource views use the private organization/workspace identity port backed by
structured persistence. Public image/output/artifact/cursor aliases are random and
persisted; exact source reauthorization is required on every detail read. Reserved
CAS publication is private until both indexes agree and the source revision commits.
Unassigned/legacy JSON storage and old source-derived references never trigger a
compatibility identity fallback. See ADR-0043 and the asset/package threat model.

Foundation readiness uses the same bounded registration and invocation-private
trusted definition snapshot as desktop. Repeated calls revalidate persisted trust;
only overlapping owner/store initialization is joined. Internal Foundation failure
attribution is allowlisted and bounded while public error messages remain generic.

## Managed headless client identity

The managed headless identity policy uses two distinct registrations from
the existing OIDC issuer. It reads `AI_SYSTEM_BUILDER_MANAGED_HEADLESS_AGENT_CLIENT_ID`
and `AI_SYSTEM_BUILDER_MANAGED_HEADLESS_BROWSER_CLIENT_ID` only from host
configuration. With both unset, the policy is disabled. It rejects partial
or duplicate bindings. A matched client requires a signed typed access
token and an explicit organization selection. The identity policy grants no
workspace access or browser control. Feature route registration, workspace
authorization and interactive consent are separate.

## Organization context for file imports

Ingestion requires both organization-scoped document storage and an authoritative
organization context provider. Without either, the host returns unavailable before
acquisition. The server application supplies its authenticated request scope to an
explicitly injected organization-scoped store as well as to PostgreSQL storage.
The store's organization name does not authorize a request. Middleware and the
owning application still enforce organization, workspace, task and file access.
Raw or global document stores do not provide an ingestion fallback.

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
