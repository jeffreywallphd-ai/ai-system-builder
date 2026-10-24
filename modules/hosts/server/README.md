> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

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

## Organization context for file imports

Ingestion requires both organization-scoped document storage and an authoritative
organization context provider. Without either, the host returns unavailable before
acquisition. The server application supplies its authenticated request scope to an
explicitly injected organization-scoped store as well as to PostgreSQL storage.
The store's organization name does not authorize a request. Middleware and the
owning application still enforce organization, workspace, task and file access.
Raw or global document stores do not provide an ingestion fallback.
