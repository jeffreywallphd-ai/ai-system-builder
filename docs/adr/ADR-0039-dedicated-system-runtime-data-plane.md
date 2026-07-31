# ADR-0039: Dedicated System Runtime Data Plane

- Status: accepted
- Date: 2026-07-29
- Deciders: ai-system-builder maintainers
- Related: ADR-0023, ADR-0027, ADR-0029, ADR-0033, `docs/architecture/persistence-and-storage.md`

## Context

Published systems previously kept operational conversation and system-owned data
on the platform structured-document database. Organization and workspace scoping
were necessary but did not provide the requested physical boundary between two
installed systems. Desktop system execution also needs an exact durable identity
that can outlive a window, process restart, compatible release migration, and
retained uninstall without exposing a file path or connection string.

## Decision

- Every installed system receives a host-generated opaque runtime-instance id.
  Platform lifecycle, release, placement, and audit records retain only that id
  and its opaque data-binding id.
- Platform control-plane records remain in the deployment-shaped platform
  database. Conversation and system-owned runtime repositories are composed only
  from the exact active runtime-instance database session.
- Desktop derives one contained SQLite database beneath the application data
  root for each runtime instance. Managed hosts use a provisioner-controlled
  PostgreSQL database and a distinct least-privilege login role per instance.
- Runtime roles cannot create databases or roles, own or migrate schema, connect
  to another runtime database, or receive provisioner credentials. Runtime
  renderers never receive physical database locations or credentials.
- Provision, open, migrate, close, retain, backup/restore, and deletion are
  application-port operations. Compatible upgrades bind a stopped instance to
  the exact next deployment/release only after host-owned migration and health
  validation. Clones and separate installations allocate new instances.
- Stop closes active handles without deleting data. Uninstall retains data.
  Destruction is a separate operation allowed only for retained data with an
  exact runtime-instance confirmation. Restore is denied while active.
- A desktop runtime window is bound to one exact runtime instance and one
  application-owned conversation session. Renderer IPC cannot select storage or
  runtime identity. Stop and application shutdown close runtime windows and
  sessions before runtime database handles, then close the platform database.
- Open-database and pool counts are bounded. Missing, mismatched, unhealthy, or
  exhausted bindings fail closed with sanitized diagnostics; an ordinary open
  never creates a blank substitute database.

## Consequences

### Positive

- A persistence-scoping defect in one runtime cannot select another system's
  physical database through normal application or renderer inputs.
- Stop/restart, explicit compatible migration, and retained uninstall preserve
  system-owned data while clones remain independent.
- Desktop and managed hosts share application contracts while retaining
  engine-specific containment, migration, credential, and recovery adapters.

### Negative

- Operators must manage more database files or PostgreSQL databases and roles.
- Managed backup/restore requires a qualified platform recovery adapter and
  retention policy; repository code cannot claim managed recovery by itself.
- Host or database-administrator compromise remains outside this isolation
  boundary and requires platform hardening, monitoring, and recovery controls.

## Non-goals

- No automatic data deletion on uninstall, cross-system transcript sharing,
  multi-region replication, renderer-selected storage, or arbitrary asset code.
