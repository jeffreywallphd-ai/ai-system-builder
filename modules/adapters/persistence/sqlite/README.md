> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Local SQLite Persistence

This adapter family owns the local deployment's SQLite-specific implementation
details. The adapter now opens Node's built-in SQLite driver in the Electron main
process, enforces WAL/full-sync/foreign-key/busy-timeout policy, applies monotonic
migrations, supplies transactional structured documents with optimistic
revisions, reports sanitized health, and performs online backup plus validated
restore. See ADR-0026.

Structured operations sharing one SQLite connection use one adapter-owned FIFO
queue, including reads and organization wrappers. An asynchronous transaction
owns that connection until commit or rollback; another request cannot observe its
uncommitted records or have an acknowledged write rolled back with it. Use only
the supplied transaction store inside the callback. Its scoped children expire
with it and deny use from a foreign asynchronous context. Root reentry fails
explicitly instead of deadlocking. If rollback cannot be confirmed, the connection stays unavailable
to queued requests and every store wrapper; the original callback error is kept.
There is no automatic reset or adoption of that unfinished transaction. Confirmed
rollback permits normal queue progress. Values and revision options are copied before
queue waits. Separate database objects have independent adapter queues. Native
SQLite file locks and busy-timeout policy still govern connections to the same
file. The independent-progress test uses separate in-memory databases. Nested
callbacks reuse the active transaction and do not create savepoints. The installed
Electron runtime runs the same concurrency checks as the native Node SQLite
fixture, alongside existing migration/backup/restore checks.

Schema version 2 separates platform/legacy documents from organization-owned
documents with a composite organization key. First launch explicitly creates a
generated local organization/principal profile. New feature repositories use its
scoped store; application settings remain platform data. Existing records require
the fingerprint-confirmed assignment command and are never adopted silently.

Desktop main composition selects this runtime before IPC registration. Existing
JSON data passes through the explicit inventory, rollback copy, transactional
import, reconciliation, activation marker, and divergence guard before typed
repositories become active. Maintenance commands provide health, backup, guarded
restore, and deterministic portable export through the same Electron runtime.

Artifact bytes, model files, datasets, generated images, provider repository
objects, runtime installations, and secrets do not belong in this database.

Published-system data uses the sibling `system-runtime` adapter, not this
platform database. It derives one contained SQLite file per opaque runtime
instance, refuses missing or mismatched bindings, bounds open handles, runs
migration before a compatible deployment binding, performs online backup and
verified restore, retains data on uninstall, and requires exact confirmation
before deleting a retained instance. Physical locations never enter renderer or
application contracts.

The checked-in SQL under `migrations/sqlite` must remain semantically identical
to the runtime migration constant; an automated test enforces that relationship.
