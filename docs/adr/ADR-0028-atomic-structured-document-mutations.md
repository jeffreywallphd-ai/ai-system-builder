# ADR-0028: Atomic Structured-Document Mutations

- Status: accepted
- Date: 2026-07-16
- Deciders: ai-system-builder maintainers
- Related: ADR-0025, ADR-0026, ADR-0027,
  `docs/architecture/persistence-and-storage.md`

## Context

Typed repositories retain compatibility with schema-versioned whole-document
collections while local and managed hosts move to SQLite and PostgreSQL. A
read-modify-write sequence without a revision precondition can lose an unrelated
writer's update. PostgreSQL may also abort a serializable transaction or a
deadlock victim, requiring the complete transaction to be retried.

## Research basis

- [PostgreSQL transaction retry guidance](https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html)
  requires retrying the complete transaction after serialization failures and
  notes that deadlock failures may also be retryable.
- [PostgreSQL error-code guidance](https://www.postgresql.org/docs/current/errcodes-appendix.html)
  defines stable SQLSTATE values such as `40001` and `40P01` for programmatic
  handling.
- [PostgreSQL transaction-isolation guidance](https://www.postgresql.org/docs/current/transaction-iso.html)
  describes Serializable isolation as the strictest level and requires
  applications to retry serialization failures.
- [SQLite transaction guidance](https://www.sqlite.org/lang_transaction.html)
  documents its single-writer behavior and `BEGIN IMMEDIATE` semantics.

## Decision

- Every database-backed whole-document mutation uses optimistic
  compare-and-swap against the document revision. Expected revision `0` means
  insert only when the document is absent.
- Repository adapters express collection changes through record-store mutation
  methods. They must not perform a separate collection read followed by an
  unconditional collection write.
- A mutation callback is pure, synchronous, JSON-compatible computation. It may
  run again after a conflict and must not perform I/O, generate identities, read
  the clock, or create other externally visible side effects.
- Compare-and-swap retry is bounded at 64 attempts by default. Exhaustion
  surfaces the sanitized structured-document conflict.
- PostgreSQL application transactions use Serializable isolation and retry the
  complete callback up to four attempts for SQLSTATE `40001` or `40P01`.
  Non-retryable failures roll back immediately.
- JSON compatibility mode serializes mutation of the same file within one Node
  process. It is not a multi-process database and remains prohibited for shared
  deployment shapes.
- Concurrent changes to different logical records in one collection are
  preserved. Concurrent replacement of the same logical record remains the
  repository's documented last-accepted-write behavior unless a domain-specific
  version/conflict contract says otherwise.

## Consequences

- Multiple server processes can safely update different records backed by the
  same PostgreSQL document without collection-wide lost updates.
- Retryable transaction callbacks and mutation callbacks have a stricter purity
  requirement that tests and review must enforce.
- The adapter still uses compatibility documents rather than normalized tables;
  this decision fixes atomicity but does not decide tenancy, authorization, row
  security, or domain-level merge semantics.
- Live PostgreSQL contention remains required qualification evidence. Unit tests
  and in-memory revision tests do not replace it.

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.
