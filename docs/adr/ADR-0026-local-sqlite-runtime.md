# ADR-0026: Local SQLite Runtime

- Status: accepted
- Date: 2026-07-16
- Deciders: ai-system-builder maintainers
- Related: ADR-0025, `docs/architecture/persistence-and-storage.md`

## Context

The local deployment needs a SQLite driver that works in the packaged Electron
main process, does not require a separately administered service, and can create
consistent online backups. Native addon drivers introduce Electron ABI rebuild
and packaging work. The repository's Electron 41 runtime embeds Node 24, which
provides `node:sqlite` directly.

## Research basis

- [Electron 41's release notes](https://www.electronjs.org/blog/electron-41-0)
  identify its embedded Node 24 runtime.
- [Node 24.14 SQLite documentation](https://nodejs.org/download/release/v24.14.0/docs/api/sqlite.html)
  documents `DatabaseSync`, busy timeout, prepared statements, and the online
  backup API available to that runtime.
- [SQLite transaction documentation](https://www.sqlite.org/lang_transaction.html)
  documents the single-writer model and `BEGIN IMMEDIATE` behavior used by the
  migration and transaction helpers.
- [SQLite `VACUUM INTO` documentation](https://www.sqlite.org/lang_vacuum.html#vacuuminto)
  provides the fallback consistent-snapshot model if the embedded online backup
  API changes in a future runtime.

## Decision

- The local desktop main process uses Node's built-in `node:sqlite` API. No
  third-party native SQLite addon is added.
- Driver loading is isolated in the SQLite adapter and fails explicitly when the
  runtime lacks `node:sqlite`; it never silently selects JSON persistence.
- Schema changes are monotonic, recorded in `schema_migrations` and
  `PRAGMA user_version`, and applied under `BEGIN IMMEDIATE`.
- Version 1 creates an adapter-internal structured-document table with JSON
  validity, positive revision, primary-key, and updated-time constraints. Typed
  application repository ports remain the public persistence boundary.
- Online backup uses the runtime backup API. Restore validates integrity and
  schema version before atomic replacement while the live connection is closed,
  retaining the replaced database as a rollback source.
- Health reports contain schema, integrity, journaling, and foreign-key state but
  do not expose database paths, SQL, record content, or secrets.
- Operator maintenance runs under the pinned Electron runtime. Backup and restore
  are explicit commands, restore requires confirmation, and portable NDJSON
  export uses a transactionally consistent versioned manifest and digest.

## Consequences

- Local packaging avoids addon ABI and rebuild risk.
- The desktop runtime, rather than the repository's older command-line Node
  runtime, is the authoritative SQLite integration-test environment.
- The synchronous driver is appropriate for the local single-process write
  shape, but database work must stay outside renderer and application/domain
  layers.
- A future Electron upgrade must rerun migration, backup/restore, and packaging
  qualification against its embedded Node/SQLite versions.

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.
