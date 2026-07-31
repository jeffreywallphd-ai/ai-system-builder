# ADR-0025: Deployment-Shaped Structured Persistence

- Status: accepted
- Date: 2026-07-16
- Deciders: ai-system-builder maintainers
- Related: docs/adr/ADR-0003-host-model-and-transport-separation.md, docs/adr/ADR-0004-persistence-and-storage-separation.md, docs/architecture/persistence-and-storage.md

## Context

The repository must support a zero-administration local desktop application,
campus and corporate servers, and cloud deployments. ADR-0004 established
Postgres as one repository-wide structured persistence default, but that choice
adds an unnecessary service dependency to a local application. The active
desktop and server compositions still use JSON-file record adapters, so changing
the target also requires a safe migration and cutover policy.

SQLite is designed for application-local durable data and provides transactional
relational behavior without a separate service. It permits only one writer at a
time, and its WAL mode requires database users to remain on one host. Campus,
corporate, and cloud deployments need a client/server database for shared access,
concurrent writers, centralized operations, and later high-availability options.

## Research Basis

- [SQLite's appropriate-use guidance](https://www.sqlite.org/whentouse.html)
  recommends embedded storage for device-local applications and a client/server
  engine when data is across a network or needs many concurrent writers.
- [SQLite WAL guidance](https://www.sqlite.org/wal.html) documents concurrent
  readers, a single writer, checkpointing, and the same-host requirement.
- [SQLite foreign-key guidance](https://www.sqlite.org/foreignkeys.html) requires
  applications to enable constraint enforcement on connections.
- [SQLite backup guidance](https://www.sqlite.org/backup.html) provides an online
  snapshot mechanism that avoids treating a live database as an ordinary file.
- PostgreSQL documents distinct [backup and recovery](https://www.postgresql.org/docs/current/backup.html)
  and [high-availability](https://www.postgresql.org/docs/current/high-availability.html)
  operating choices for managed server deployments.

## Decision

Structured persistence defaults are selected by deployment shape:

| Deployment shape | Default database | Access model |
| --- | --- | --- |
| `local` | SQLite | Embedded, single host |
| `campus-server` | PostgreSQL | Client/server |
| `corporate-server` | PostgreSQL | Client/server |
| `cloud` | PostgreSQL | Client/server |

The following constraints apply:

- Local SQLite databases reside under a dedicated persistence directory in the
  host's application-data root, not under artifact storage or runtime roots.
- Local SQLite connections use WAL journaling, full synchronous durability,
  foreign-key enforcement, and a finite busy timeout. Backup uses a
  database-aware online backup operation rather than copying an open database
  file directly.
- SQLite database files and WAL sidecars must not be placed on network filesystems
  or used as a shared database by campus, corporate, or cloud hosts.
- PostgreSQL connection and credential details remain environment/secret inputs at
  composition boundaries; they do not enter application or domain contracts.
- Artifact bytes, model files, datasets, generated media, runtime installations,
  provider repository objects, and secrets remain outside structured persistence.
- Application repository ports and record contracts stay database-neutral.
  SQLite- and PostgreSQL-specific SQL, connection behavior, and migration mechanics
  remain in their adapter families.
- Existing JSON-file record adapters are a transitional implementation. A database
  target must not become the active adapter until an explicit import can inventory,
  validate, copy, reconcile counts, preserve a rollback source, and report a safe
  failure without partially selecting the new database.
- Hybrid synchronization, organization tenancy, database-per-tenant choices,
  failover objectives, and deployment-specific retention objectives remain
  separate decisions.

This ADR supersedes only the repository-wide PostgreSQL default in ADR-0001 and
ADR-0004. The repository structure and the persistence/storage separation remain
accepted.

## Consequences

### Positive

- Local users receive a self-contained database target with transactional schema
  evolution and no separately administered service.
- Shared deployments retain PostgreSQL's concurrency and operational model.
- Deployment intent is explicit and testable without leaking database details into
  application ports.
- JSON data is protected from an implicit or destructive cutover.

### Negative

- Two database adapters and migration dialects must be maintained and qualified.
- SQLite and PostgreSQL differences require adapter-level integration tests rather
  than assuming SQL is portable.
- The current JSON repositories remain active while schemas, import tooling, and
  repository implementations are completed.

### Follow-up

- Implement the local SQLite driver lifecycle, schema ledger, and backup/restore
  service.
- Define canonical logical records and engine-specific migrations for each
  repository family.
- Implement a resumable JSON inventory/import/verification workflow before local
  host cutover.
- Complete PostgreSQL repository coverage and managed deployment configuration.
- Qualify backup, restore, concurrency, upgrade, rollback, observability, and
  security behavior for every supported deployment shape.
