# Persistence Operations

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

- Status: active operator runbook
- Decision authority: [ADR-0025](../adr/ADR-0025-deployment-shaped-structured-persistence.md), [ADR-0026](../adr/ADR-0026-local-sqlite-runtime.md), [ADR-0027](../adr/ADR-0027-managed-postgresql-runtime.md), [ADR-0029](../adr/ADR-0029-organization-tenancy-identity-and-authorization.md), and [ADR-0039](../adr/ADR-0039-dedicated-system-runtime-data-plane.md)
- Architecture authority: [Persistence and Storage](../architecture/persistence-and-storage.md)

This runbook covers the implemented database boundary. Artifact bytes have a
separate lifecycle and must be backed up from `SERVER_STORAGE_ROOT` or the
equivalent desktop artifact directory. Runtime installations and caches are
replaceable and are not database backup content.

## Operational safety rules

1. Stop the desktop application before a local restore. Quiesce server writes or
   put the managed deployment into maintenance before a coordinated database and
   artifact restore.
2. Take and verify a backup before application or schema upgrades. Never delete
   the JSON import rollback copy or pre-restore SQLite file until acceptance is
   complete.
3. Supply connection strings, token hash secrets, CA material, and backup
   credentials through the deployment secret boundary. Do not paste them into
   committed environment files or logs.
4. Treat portable NDJSON exports as sensitive. They contain application records,
   not secrets by design, but may contain user-authored or imported content.
5. Do not use runtime caches as a recovery source and do not restore structured
   records without the corresponding durable artifact set when referential
   consistency matters.

## Local SQLite

The data root is Electron's platform-specific application `userData` directory;
the database is `<data-root>/persistence/ai-system-builder.sqlite3`. The
maintenance command uses the pinned Electron runtime so it exercises the same
`node:sqlite` implementation as the desktop package. Health, backup, and export
require an existing database and do not silently select JSON.

Repository CI keeps dependency installation script-free, then explicitly
installs only the pinned Electron runtime before executing the production
SQLite integration tests.

```text
npm run persistence:sqlite -- health --data-root <desktop-user-data>
npm run persistence:sqlite -- backup --data-root <desktop-user-data> --destination <backup.sqlite3>
npm run persistence:sqlite -- export --data-root <desktop-user-data> --destination <portable.ndjson>
```

The health command checks SQLite integrity, schema version, WAL mode, and foreign
key enforcement. Backup uses SQLite's online backup API. The portable export is a
transactionally consistent, deterministic NDJSON document containing a versioned
manifest, document count, and SHA-256 digest.

First launch explicitly asks the user to create a generated local organization
and owner profile. New feature records use that organization partition. Existing
unassigned records are not adopted. With the desktop stopped, inventory and then
assign only reviewed namespaces using the returned fingerprint and a new
rollback file:

```text
npm run persistence:sqlite -- legacy-inventory --data-root <desktop-user-data> --namespaces <namespace-a,namespace-b>
npm run persistence:sqlite -- legacy-assign --data-root <desktop-user-data> --organization-id <org-id> --namespaces <namespace-a,namespace-b> --fingerprint <sha256:...> --rollback <rollback.ndjson> --confirm-assignment <org-id>
```

Platform namespaces are rejected. The assignment writes the rollback source
first, then moves all selected records in one database transaction. Stale
fingerprints, revision changes, or target conflicts abort the move.

Restore validates database integrity and the exact supported schema before
replacement. It requires the explicit confirmation flag and retains the old live
database as `<database>.pre-restore`:

```text
npm run persistence:sqlite -- restore --data-root <desktop-user-data> --backup <backup.sqlite3> --confirm-replace
```

After restore, run health, start the desktop app, verify representative workspace,
System Builder, Settings / Software status, library, plan, and artifact reads,
then retain or remove the pre-restore copy according to approved retention policy.
SQLite documents the online backup API and `VACUUM INTO` as live-database backup
options in its [backup guidance](https://www.sqlite.org/backup.html).

## Managed PostgreSQL

The same runtime configuration used by the server is used by the maintenance
command. `DATABASE_URL` is mandatory; TLS verification is the default.

```text
npm run persistence:postgres -- health
npm run persistence:postgres -- export --destination <portable.ndjson>
```

Health reports only schema compatibility, query latency, pool counts, and
sanitized idle-client error counters/timestamps. Export
runs under a transactionally consistent transaction and writes the same versioned NDJSON
format as SQLite. Neither command prints the connection string.

Before OIDC users can access a managed organization, provision the organization
and application-managed membership. The issuer and subject must exactly match
the IdP token values; the command derives the verifier's opaque principal id:

```text
npm run tenancy:postgres -- --organization-id <org-id> --display-name <name> --issuer <https-issuer> --subject <subject> --role owner --confirm-organization <org-id>
```

Pooled placement is the default. Premium dedicated placement sets
`AI_SYSTEM_BUILDER_TENANT_PLACEMENT_MODE=dedicated` and
`AI_SYSTEM_BUILDER_DEDICATED_ORGANIZATION_ID=<org-id>`; all other organization
ids are rejected before application persistence or storage.

The production runtime database role must be non-superuser, non-owner for
organization tables, and lack `BYPASSRLS`. Use a separately controlled migration
role for schema ownership and separately controlled backup roles. Confirm those
properties and a missing-context default denial against the target database;
forced RLS is not a substitute for role qualification.

Use the database platform's physical or managed backup service for disaster
recovery. For a logical backup, use the matching PostgreSQL client toolchain and
the platform credential mechanism; custom format supports selective inspection
and `pg_restore`:

```text
pg_dump --format=custom --no-owner --file <backup.dump> <database-connection>
pg_restore --list <backup.dump>
pg_restore --clean --if-exists --no-owner --dbname <empty-restore-target> <backup.dump>
```

PostgreSQL documents `pg_dump` as a consistent export that does not block normal
readers or writers, while warning that the client version must not be older than
the source server major version; see the official
[pg_dump documentation](https://www.postgresql.org/docs/current/app-pgdump.html).
Restore first to an isolated target, run the application's health and live
conformance test, compare representative counts/identities, and only then change
traffic or connection configuration.

Repository CI also runs a destructive logical-recovery drill against its
disposable PostgreSQL 18 service:

```text
RECOVERY_POSTGRES_CONTAINER=<disposable-container-id> \
RECOVERY_POSTGRES_DATABASE=<disposable-database> \
RECOVERY_POSTGRES_USER=<qualification-user> \
TEST_POSTGRES_URL=<qualification-url> \
npm run test:postgres-recovery
```

The command seeds deterministic application records, writes and inspects a
custom-format dump, copies the dump outside the database container, force-drops
and recreates the disposable source database, restores it with `pg_restore`,
runs application health and marker checks, and compares the canonical portable
export count and SHA-256 digest. It writes sanitized timing/checksum evidence
under `artifacts/qualification/postgres-recovery`. Never point this command at a
shared, staging, or production database: destruction is intentional.
CI verifies the required evidence files independently; artifact retention is
best-effort and cannot replace that verification gate.

## Published-system runtime databases

Inventory runtime-instance placement from the platform control plane; do not
enumerate filesystem names or PostgreSQL databases and infer ownership. Desktop
instances live beneath the application data root and managed instances use
provisioner-derived non-semantic database/role names. Never expose either through
user interfaces, ordinary diagnostics, or roadmap evidence.

- Stop before migration or restore. Verify a backup and schema health first.
- Compatible upgrade keeps the same opaque instance only through the explicit
  migration/binding operation. Separate installs and clones use new instances.
- Uninstall is retention, not deletion. Apply the approved retention policy,
  verify a recoverable backup, and require the exact instance confirmation for a
  later destructive delete.
- A missing database, credential, recovery adapter, or mismatched binding is an
  incident. Do not create a replacement or point the instance at shared storage.
- Bound and monitor open SQLite handles, PostgreSQL pools, database/role count,
  backup age, migration failures, and retained-instance growth.

Managed backup/restore must be supplied by the owning database platform through
the runtime recovery port and separately qualified. Repository code intentionally
reports recovery unavailable when that adapter is absent.

## Release-bound system-data recovery checks

Approved-release records and safe audit evidence use the structured-document
namespaces `system-data/records` and `system-data/audit`. They are covered by
the same SQLite/PostgreSQL backup, export, organization partition, restore, and
retention controls as other structured records; no separate file tree or
database schema is introduced.

After restore, select a non-production test release and verify: the release
manifest passes integrity verification; an authorized create/read/update
round-trip succeeds; a stale expected revision is rejected; a lower-privilege
reader receives masked protected fields; an unauthorized write is denied; and
the audit view contains the action/outcome and changed field names without field
values. A database restore without the matching content-addressed build
artifacts must leave the release runtime unavailable rather than infer a schema
from mutable design state.

## Upgrade and rollback

The application owns monotonic migrations and serializes startup migration work.
Current schema version is 2 for both engines.

- An older schema is migrated during startup inside a database transaction.
- The exact current schema is accepted without mutation beyond startup validation.
- A schema newer than the application supports fails startup; there is no silent
  downgrade, fallback, or dual write.
- Checked-in and runtime migration SQL must remain byte-semantically equivalent.
- Schema changes should follow expand, migrate, verify, then contract. Destructive
  contract work requires a separate accepted decision and a restore drill.
- An application rollback is safe only while the previous release supports the
  deployed schema. Otherwise restore the pre-upgrade database and matching
  artifact snapshot before starting the previous release.

For a rollout: record the app/image digest, verify a recent recoverable backup,
drain traffic, deploy one instance to run the serialized migration, wait for
`/health/ready`, run smoke reads/writes, then expand. On failure, stop the new
release, preserve diagnostics, and follow the compatibility rule above.

## Readiness and observability

The server exposes unauthenticated orchestration probes before API authentication:

- `GET /health/live` checks only that the process can serve a request.
- `GET /health/ready` requires compatible structured persistence and readable,
  writable artifact storage. It reports sanitized schema versions, query latency,
  pool total/idle/waiting and idle-client error state, and artifact capacity
  without paths, SQL,
  connection strings, record content, or exception messages.

Readiness failure should remove an instance from traffic; it should not immediately
restart an otherwise live process. This follows the distinction in the official
[Kubernetes probe guidance](https://kubernetes.io/docs/concepts/workloads/pods/probes/).
Aggregate latency, waiting connections, failed readiness checks, free capacity,
migration failures, and pool errors in the deployment monitoring platform.
Backup age and recovery success are external backup-system signals and are not
invented by the application.

## Recovery objectives and drills

Campus, corporate, and cloud operators must approve retention, backup frequency,
RPO, RTO, regional/host failure scope, encryption, and ownership before declaring
a deployment production-qualified. At least quarterly or at the approved cadence:

1. restore a database backup to isolation;
2. restore or attach the matching artifact snapshot;
3. run health, migrations, live PostgreSQL conformance, and representative reads;
4. verify portable export digest/count and selected relationships;
5. measure elapsed restore and data-loss windows against the approved objectives;
6. record evidence, app/database versions, and corrective actions.

No value for those objectives is assumed by this repository because the decision
register intentionally leaves them to the owning deployment organization.

The CI drill measures logical recovery time but does not declare an RTO or RPO.
Logical dumps are portable recovery evidence; high-reliability managed shapes
still need the owning platform's tested physical backup/PITR path and matching
artifact-store recovery.
