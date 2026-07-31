# Organization Tenancy and Identity

- Status: current
- Related decisions: `docs/adr/ADR-0029-organization-tenancy-identity-and-authorization.md`, `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md`
- Verification: `docs/architecture/architecture-verification.md`, `docs/operations/deployment-qualification.md`

## Supported model

An organization is the tenant. Option A, pooled organization tenancy, is the
default for campus, corporate, and cloud. Option B is a premium dedicated
placement: one configured organization per deployment, using the same release,
contracts, schema, migrations, and tests. Dedicated placement is not a fork and
does not permit customer-specific tables or behavior.

Local desktop uses one generated local organization and principal. On first
launch the user must confirm profile creation. The profile, active organization,
owner membership, and generated identifiers are durable SQLite records; no OIDC
service is required.

## Request and authorization flow

Managed production starts only in `oidc-bearer` mode. The verifier checks the
configured HTTPS issuer, audience, signature algorithm allowlist, and remote JWK
set. The exact issuer/subject pair maps to an opaque internal principal id.
Provider scopes, email, username, domain, and organization claims do not grant
application membership.

Protected requests must carry `x-organization-id` in pooled placement. Dedicated
placement supplies its configured organization when the header is absent and
rejects a different value. The host places the authenticated principal and
selected organization in an asynchronous request scope. A membership policy
then verifies that the organization and membership are active before feature
routes run. Route scopes remain a coarse transport gate; active UI selection is
never authorization.

Organization-owned repositories receive a context-required structured-document
adapter. Missing context fails; it cannot read the platform/legacy partition.
Workspace records created through a managed or local organization scope persist
their organization id. An absent organization id is retained only as an explicit
legacy/unassigned classification pending operator assignment.

## Persistence isolation

Schema version 2 adds `organization_documents` to SQLite and PostgreSQL with the
primary key `(organization_id, namespace, document_key)`. Existing
`structured_documents` remain platform/legacy records and are not reassigned by
startup.

PostgreSQL enables and forces row-level security on the organization table. Both
visibility and mutation require `organization_id` to equal the transaction-local
`app.organization_id` value. Adapters also include explicit organization
predicates. Each scoped operation uses a checked-out transaction and binds the
value with `set_config(..., true)`, preventing pooled-session context leakage.
Production roles must not be superusers or have `BYPASSRLS`; migration ownership
and runtime access must be separated by the deployment platform.

Filesystem artifact bytes preserve logical storage keys while adapters derive a
physical `organizations/<organization-id>/...` containment prefix from the same
request scope. Callers cannot choose the physical prefix. Missing organization
context fails closed for managed object, generated-image, and unregistered-file
operations.

## Provisioning and legacy assignment

OIDC authentication alone does not provision membership. An operator first runs
the PostgreSQL tenancy command with the exact issuer, subject, organization id,
display name, role, and matching confirmation:

```text
npm run tenancy:postgres -- --organization-id <org-id> --display-name <name> --issuer <https-issuer> --subject <provider-subject> --role owner --confirm-organization <org-id>
```

The command derives the same opaque principal id as the verifier and atomically
creates or updates the organization and membership. `DATABASE_URL` and TLS
inputs use the normal PostgreSQL secret boundary.

Legacy SQLite records require two explicit stopped-application operations. The
first inventories selected namespaces and returns a fingerprint. The second must
repeat the namespace list, fingerprint, organization id, rollback-file path, and
matching organization confirmation:

```text
npm run persistence:sqlite -- legacy-inventory --data-root <desktop-user-data> --namespaces <a,b>
npm run persistence:sqlite -- legacy-assign --data-root <desktop-user-data> --organization-id <org-id> --namespaces <a,b> --fingerprint <sha256:...> --rollback <rollback.ndjson> --confirm-assignment <org-id>
```

Assignment writes the rollback source before one atomic move. Platform
namespaces cannot be assigned. A changed inventory, existing target record, or
revision conflict aborts the database transaction.

## Qualification boundary

Repository tests cover local-profile initialization, membership policy,
pooled/dedicated placement denial, SQLite and in-memory isolation, PostgreSQL
transaction binding and RLS migration drift, live PostgreSQL cross-organization
keys, object-prefix isolation, and explicit legacy assignment. Production claims
still require the target identity provider, non-bypass runtime database role,
backup platform, artifact service, and ingress controls to pass the deployment
qualification matrix.

> AI documentation reminder: when behavior in this area changes, update ADR-0029,
> security and persistence context packs, deployment profiles, operations, and
> cross-tenant tests in the same change.
