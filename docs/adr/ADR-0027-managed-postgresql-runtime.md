# ADR-0027: Managed PostgreSQL Runtime

- Status: accepted
- Date: 2026-07-16
- Deciders: ai-system-builder maintainers
- Related: ADR-0025, ADR-0026, `docs/architecture/persistence-and-storage.md`

## Context

Campus, corporate, and cloud server deployments need shared structured
persistence with bounded connection use, transaction isolation, schema locking,
TLS configuration, startup validation, and graceful shutdown. The existing typed
repository adapters can share an adapter-internal document seam with SQLite while
database-specific lifecycle and SQL stay behind the PostgreSQL adapter boundary.

## Research basis

- [node-postgres pooling guidance](https://node-postgres.com/features/pooling)
  recommends one bounded application pool, checked-out client release, and
  `pool.end()` for shutdown.
- [node-postgres transaction guidance](https://node-postgres.com/features/transactions)
  requires every transaction statement to use the same checked-out client.
- [PostgreSQL advisory-lock guidance](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
  describes transaction-level advisory locks and automatic release.
- [PostgreSQL SSL guidance](https://www.postgresql.org/docs/current/libpq-ssl.html)
  distinguishes encrypted connections from certificate-verified connections.

## Decision

- The server uses `pg` with one bounded pool for explicitly selected
  `campus-server`, `corporate-server`, and `cloud` shapes.
- `DEPLOYMENT_SHAPE` is mandatory in production. A managed shape requires a valid
  `DATABASE_URL`; startup never falls back to JSON after that selection. The
  server rejects the desktop-only `local` shape.
- TLS defaults to `verify-full`. `require` and `disable` are explicit operator
  choices for controlled environments and must not be inferred.
- Migration runs on one client in one transaction and takes a stable
  transaction-scoped advisory lock. Startup rejects schemas newer than the
  binary.
- The PostgreSQL structured-document schema implements the same typed repository
  semantics and optimistic revisions as SQLite, using JSONB only inside the
  adapter. Application/domain contracts remain database-neutral.
- Legacy server JSON/NDJSON import uses the same allowlist, rollback copy,
  transaction, reconciliation, activation marker, and divergence failure as the
  local cutover.
- Organization tenancy, database-per-tenant layout, row-level security policy,
  and failover objectives remain undecided. This runtime does not invent them.
- Production server shapes require the existing HTTPS/token security mode.
  Liveness remains process-only; readiness combines sanitized database
  schema/latency/pool state with artifact-storage access and capacity.
- Application transactions use Serializable isolation and retry the complete
  callback for bounded serialization/deadlock failures. Whole-document writes
  use revision compare-and-swap as specified by ADR-0028.
- Portable export enumerates adapter-internal documents under transactionally
  consistent isolation. Disaster-recovery backup/restore remains owned by the PostgreSQL
  platform and its approved operator runbook.

## Consequences

- Managed shapes have an explicit, fail-closed database path with pool health and
  graceful drain.
- SQLite and PostgreSQL share repository semantics without pretending their
  lifecycle or SQL is portable.
- A real PostgreSQL service is required to run the live integration suite and to
  qualify a deployment environment; mocked migration tests are not release
  evidence by themselves.
- The compatibility document schema is intentionally an incremental cutover
  layer. Future normalized tables require migrations and repository conformance,
  not application-contract changes.

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.
