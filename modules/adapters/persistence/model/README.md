# Private Model storage-budget persistence

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`createStructuredTrainingStorageBudget` implements the typed application Model
budget port with the existing host-selected platform transaction store. It is
unused by default. Require a genuine root `runInOwnedTransaction`, explicit pool
and profile identity, and byte/count limits for the aggregate, organization and
principal. The same pool must use one authoritative store across every producer.
There is no JSON, request-context or organization-wrapper fallback.

The adapter does not provision a pool. Missing or malformed accounting, a changed
policy, inconsistent totals or a counter-only reset refuse admission. An already
provisioned `model/training/storage-budget/pools-v1` row starts at revision one,
with schema `training-storage-budget-pool-v1`, a SHA-256 policy digest, zero
`reservedBytes`/`reservationCount` and an empty `organizations` array. The policy
digest uses UTF-8 JSON with the explicit fields in the exported policy interface
order. Only one acknowledged reservation advances both count and revision.
Fixture provisioning is synthetic; this record shape grants no physical authority.

One root-owned transaction reads current authorization, then accesses only the
exact captured organization partition for the original reservation. It reserves
the declared ceiling for all five roles, updates bounded aggregate/organization/
principal counters and inserts the private reservation atomically. Policy and
request values are detached before waits. Serializable retries use fresh local
data and no external effects. The synchronous currentness check must pass before
commit and before returning a new grant. Private records contain digests and
limits, not model/dataset bytes, paths, credentials or raw principal names.

An existing original reservation, lost commit response, unavailable rollback or
withdrawn caller never supplies a replacement grant. There is no expiry,
initialization, release-by-ID, adoption or cleanup callback. Debits stay retained.
Actual finite SQLite close/reopen is feature evidence; live managed PostgreSQL
and physical host qualification remain separate.

A valid database snapshot does not prove that it is current or that physical
content has no other owner. The adapter cannot detect a whole valid database
rollback. Trusted host provisioning must establish the authoritative pool,
protected provenance and anti-rollback/recovery boundary before activation.
Native file fences, readiness, original pending-operation custody, actual cleanup
and credit, parent/crash result protection and permanent retirement remain pending.
Do not configure the producer from this component's local tests.

The fixed catalog route runs this full feature suite and its existing Model
registry, transaction and organization-wrapper neighbors, plus types. Only the complete known source
set qualifies for that route; unsupported/mixed/missing roots keep generic
discovery. An explicit general controller request still runs the general suite.
The fixed feature test runs as a Node program so executor-added `--affected`
metadata remains program arguments. Related suites retain their own `node --test`
command. Executor-level positive and intentional-failure checks verify that tests
really execute and a failed direct `node:test` cannot produce a passing receipt.
