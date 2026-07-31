# ADR-0029: Organization Tenancy, Identity, and Authorization

- Status: accepted
- Date: 2026-07-16
- Deciders: ai-system-builder maintainers
- Related: ADR-0015, ADR-0017, ADR-0025, ADR-0027,
  `docs/architecture/workspace-model.md`,
  `docs/architecture/persistence-and-storage.md`

## Context

Local desktop use is intentionally zero-service and single-user. Campus,
corporate, and cloud deployments need authenticated users, explicit ownership,
shared-server isolation, resource authorization, and durable audit evidence.
The current workspace actor/member fields are passive attribution only, LAN
device scopes enforce coarse route access only, and PostgreSQL structured
documents have no tenant partition key.

Selecting a tenant model changes public request contracts, workspace and User
Library ownership, PostgreSQL keys and policies, security composition, data
migration, audit records, and the object-storage keyspace. Those commitments
must be one coherent decision before shared multi-user behavior or tenant-aware
object storage is implemented.

## Research basis

- [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0-18.html)
  defines authentication on OAuth 2.0 and identifies the issuer and subject
  claim pair as the stable external end-user identifier; mutable claims such as
  email are not identity keys.
- [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
  recommends least privilege, deny by default, permission validation on every
  request, appropriate logging, and authorization-specific tests.
- [AWS SaaS partitioning guidance](https://docs.aws.amazon.com/whitepapers/latest/multi-tenant-saas-storage-strategies/saas-partitioning-models.html)
  distinguishes silo, bridge, and pool storage. A pool uses shared schema and a
  tenant partition key, while silo and bridge trade higher isolation for higher
  provisioning and operating cost.
- [AWS PostgreSQL tenancy guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/matrix.html)
  identifies pooled tables as the fastest-onboarding PostgreSQL model and
  separate databases or schemas as higher-isolation, higher-management-cost
  alternatives.
- [Microsoft multitenant data guidance](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/storage-data)
  recommends an explicit tenant identifier for shared relational tables and
  notes that row-level security requires tenant identity to reach every query.
- [PostgreSQL row-security guidance](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
  documents default denial when row security is enabled without an applicable
  policy, as well as the table-owner and `BYPASSRLS` exceptions that must be
  removed from the application role.
- [PostgreSQL configuration guidance](https://www.postgresql.org/docs/current/config-setting.html)
  provides transaction-local configuration through `set_config`, allowing a
  checked tenant identifier to be bound to one transaction without leaking
  through a pooled session.

## Options

### A. Pooled organization tenancy with row-level security

Managed deployments share one schema. Every organization-owned row carries an
immutable organization identifier in its relational key. Application policy
authorizes the principal, organization membership, operation, and resource;
PostgreSQL row-level security supplies a second isolation boundary.

- Benefits: one contract model across campus, corporate, and cloud; efficient
  onboarding and upgrades; supports multi-organization cloud use; leaves room
  for later tenant placement behind adapters.
- Costs: the tenant context must be propagated without omission; migration and
  policy tests are substantial; pooled capacity needs noisy-neighbor controls.

### B. One organization per deployment

Each managed installation serves one organization, while its users still use
external identity and authorization.

- Benefits: simplest operational isolation and easiest campus rollout.
- Costs: cannot provide a shared multi-organization cloud control plane without
  a later breaking tenancy change; duplicated deployments and upgrades become
  the isolation mechanism.

### C. Separate database per organization

The shared application selects and operates a dedicated database for each
organization.

- Benefits: strongest data-plane isolation and tenant-specific backup/restore.
- Costs: pool routing, migrations, recovery, observability, provisioning, and
  cross-organization administration scale with tenant count; local and small
  campus deployments pay complexity they do not need.

## Decision

Choose option A as the default managed-server model. Option B is a premium
deployment-placement profile over the same contracts, release, and
configuration model; it is not a product fork. Retain an adapter boundary that
can place selected organizations in dedicated databases later without making
option C the default.

- **Tenant definition:** an organization is the tenant. A workspace belongs to
  exactly one organization and cannot be reassigned by ordinary update flows.
  A user may belong to multiple organizations and must select an organization
  explicitly; membership is not inferred from token scopes or email domains.
- **Local profile:** local desktop creates one durable local organization and
  one local principal during explicit first-run setup or migration. It uses the
  same organization-aware application contracts without requiring OIDC or a
  network service. The identifiers are generated and persisted, not hard-coded
  global constants.
- **Managed identity:** campus, corporate, and cloud hosts use a swappable OIDC
  authentication adapter. The trusted issuer plus subject pair maps to one
  internal principal identifier. Email, username, display name, and provider
  organization claims are attributes only.
- **Request context:** authenticated operations carry an immutable principal,
  selected organization, request/correlation identity, and authentication
  assurance from the host boundary into application use cases. Workspace-owned
  operations additionally carry the workspace identifier. Missing or
  mismatched context denies access; it never falls back to a global scope.
- **Authorization:** route scopes remain coarse transport gates. Application
  policy evaluates organization membership, role, operation, and resource on
  every protected use case and denies by default. Organization roles begin as
  `owner`, `admin`, and `member`; resource-specific grants require a successor
  decision instead of ad hoc role strings.
- **Persistence:** organization-owned structured documents add
  `organization_id` to their relational primary key. Platform records and
  deployment-local host configuration use explicit non-tenant classifications,
  not a nullable tenant field interpreted by convention. All organization-owned
  reads and writes execute inside a transaction with a transaction-local tenant
  setting.
- **PostgreSQL defense in depth:** organization-owned tables enable and force
  row-level security. The runtime application role is neither a superuser nor
  the table owner and has no `BYPASSRLS`; a separate migration role owns schema
  changes. Policies apply the checked transaction-local organization identifier
  to both visibility and mutation. Backup and migration tooling use explicit,
  separately controlled roles.
- **Audit:** authorization allows and denials, membership changes, tenant
  selection, privileged administration, and sensitive resource operations emit
  append-only structured audit records with actor, organization, operation,
  resource reference, outcome, timestamp, and correlation identifier. Audit
  events exclude tokens, raw claims, prompts, payload bodies, and local paths.
- **Storage alignment:** object keys are derived by storage adapters from typed
  ownership descriptors. Organization/workspace/principal identifiers form
  containment prefixes; callers never construct raw provider keys. Platform
  assets remain in a separate read-only scope.
- **Premium dedicated placement:** a dedicated deployment accepts exactly one
  configured organization identifier and rejects any other organization before
  application or storage access. Dedicated stacks run the same released
  software and schema as pooled stacks. Customer-specific code, schema drift,
  and one-off deployment behavior are prohibited.

## Implementation plan

1. Add organization, external-subject, membership, selected-organization, and
   request-security contracts with normalization and negative tests.
2. Add authorization and audit application ports/services; make resource-aware
   authorization mandatory at workspace and storage use-case boundaries.
3. Add explicit local-profile bootstrap/migration and OIDC verifier/mapping
   adapters, then compose them by deployment shape without changing use cases.
4. Introduce a versioned PostgreSQL tenancy migration, separate migration and
   runtime roles, transaction-local tenant binding, forced row-level-security
   policies, and live cross-pool isolation tests.
5. Propagate organization context through API, IPC, clients, host composition,
   typed repositories, health diagnostics, and sanitized audit sinks.
6. Migrate existing data only through an explicit organization-assignment
   command with inventory, rollback source, reconciliation, and no implicit
   assignment on ordinary startup.
7. Qualify local single-user behavior and managed multi-user denial paths before
   implementing the tenant-aware object-storage recommendation.

## Consequences

### Positive

- Local and managed shapes share ownership semantics without forcing a local
  identity provider.
- Cloud can serve multiple organizations efficiently, while future dedicated
  placement remains an adapter concern.
- Authorization mistakes must cross both application policy and database row
  security to expose another organization's structured data.
- Object storage receives a stable ownership boundary before provider-specific
  keys or lifecycle rules are committed.

### Negative

- Existing structured data needs explicit ownership assignment before managed
  multi-user activation.
- Every organization-owned operation and test fixture gains mandatory context.
- Row-level security, role separation, and pooled-connection context require live
  PostgreSQL qualification and careful operator tooling.
- Organization-level capacity isolation and dedicated-tenant placement remain
  later operational work.

## Deferred decisions

- Hybrid/offline synchronization and conflict authority.
- Organization-managed identity-provider onboarding and domain discovery.
- Fine-grained custom roles, groups, resource ACLs, and attribute-policy UI.
- Cross-organization sharing and organization libraries.
- Dedicated-database placement criteria, tenant moves, residency, and
  tenant-managed encryption keys.
- Public-internet ingress, session, abuse-prevention, and compliance claims
  beyond the identity and authorization boundaries in this proposal.

> AI documentation reminder: when behavior in this area changes, update the
> related architecture docs, context packs, deployment guidance, and tests in
> the same change.
