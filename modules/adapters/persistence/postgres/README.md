> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# PostgreSQL Persistence

PostgreSQL is the structured persistence target for campus, corporate, and cloud
server deployment shapes. This family owns the bounded `pg` pool, TLS and timeout
configuration, startup validation, advisory-locked migrations, transactional
JSONB document implementation, schema-v2 organization keys, forced row-level
security with transaction-local tenant binding, optimistic revisions, Serializable transaction
retry, transactionally consistent portable export, sanitized health/readiness data, and graceful drain behind existing
application ports.

The pool installs an idle-client error listener so an EventEmitter `error` does
not become an unhandled process failure. Only a counter and timestamp enter
health; raw driver error content remains private.

Explicit managed deployment shapes select this adapter before API registration
and run the rollback-preserving legacy import. A selected PostgreSQL target never
falls back to JSON. The live integration test requires `TEST_POSTGRES_URL`. CI
runs it continuously against a health-checked disposable PostgreSQL 18 service,
including concurrent migration startup, transactional rollback, revision,
multi-pool atomic mutation, isolation, and health behavior. Operator qualification must still repeat it
against the owning environment's PostgreSQL service and TLS boundary.
Connection strings, credentials, SQL, pools, transactions, and driver errors must
remain within composition and adapter boundaries.

The default managed placement is pooled. Premium dedicated placement rejects
every organization except its configured id before persistence. The runtime
database role must not own the organization table, be a superuser, or have
`BYPASSRLS`; deployment qualification must use separately controlled migration,
runtime, and backup roles. Existing platform/legacy records are never assigned
by startup.

Published-system data uses the sibling `system-runtime` provisioner. It derives
non-semantic database and role names from an opaque instance id, creates one
physical database and login role per instance, revokes public connect, and gives
the runtime role only the schema/data privileges needed by runtime repositories.
Runtime roles never migrate schema and have no superuser, database, role,
replication, bypass-RLS, ownership, or foreign-database authority. The live
PostgreSQL 18 command qualifies physical separation, migration persistence, and
the denial of foreign connect plus database/role/schema DDL.
