# System Runtime Data-Plane Threat Model

- Status: current
- Decision: [ADR-0039](../adr/ADR-0039-dedicated-system-runtime-data-plane.md)
- Architecture: [Persistence and Storage](../architecture/persistence-and-storage.md)

## Protected assets and trust boundaries

Protected assets are the runtime-instance/release association, conversation and
system-owned records, database credentials, migrations, backups, retention
state, and bounded host resources. Trust boundaries are renderer to host,
application lifecycle to database adapter, platform control plane to runtime
data plane, provisioner to runtime role, and backup platform to restore target.

## Abuse and failure cases

- A renderer or caller supplies a path, connection string, display name, or
  foreign runtime id to select another system's database.
- A runtime credential connects to another runtime database or performs role,
  database, schema, migration, backup, restore, or deletion operations.
- Missing storage is silently replaced with a blank database; a failed migration
  or restore corrupts the live instance; uninstall erases data implicitly.
- Stale deployment/release associations or an optimistic-write race bind the
  wrong data plane.
- Unbounded windows, SQLite handles, pools, databases, or binding history exhaust
  host resources. Raw driver errors disclose paths, credentials, SQL, or data.
- A compromised builder/runtime renderer spoofs a runtime association, invokes
  from a subframe, navigates to attacker content, opens a popup, requests a host
  permission, or retains conversation authority after Stop.

## Controls and verification

- Normalize opaque ids, derive contained locations/names inside adapters, keep
  credentials host-only, and verify exact deployment/release bindings before
  opening repositories.
- Use one SQLite file or PostgreSQL database per runtime instance. PostgreSQL
  provisioner and runtime roles are separate; public connect is revoked and
  runtime roles are non-superuser with no create-role/create-database authority.
- Require stopped-state migration/restore, health and schema validation, online
  SQLite backup, platform-managed PostgreSQL recovery, retained uninstall, and
  exact destructive confirmation.
- Bound open databases and pools; use optimistic control-plane revisions and a
  finite binding history; sanitize public failures and omit physical details.
- Bind each desktop runtime session to the exact main frame of one host-owned
  sandboxed window in a bounded registry. Use a nonpersistent partition, strict
  content security policy, context isolation, no Node integration, a minimal
  read/submit preload, and deny navigation, popups, permissions, subframes,
  foreign/destroyed senders, and stale sessions. Stop closes the window/session;
  a user window close invokes host-owned Stop for the exact started revision,
  while an explicit Stop close cannot trigger a duplicate mutation. Failed
  preparation or launch compensates by stopping the deployment.
- Focused tests cover traversal, binding substitution, cross-instance records,
  missing databases, quotas, user-close/stop/reopen, migration, backup/restore, retention,
  confirmation, and sanitized failures. Live PostgreSQL 18 qualification proves
  foreign-database, `CREATE DATABASE`, `CREATE ROLE`, and schema-DDL denial.
  Packaged desktop qualification additionally proves a separate runtime window,
  empty initial transcript, button/keyboard turns, restart persistence, bounded
  window count, and physical separation from the platform control plane.

## Residual risk and operator duties

A compromised main process, operating-system account, PostgreSQL administrator,
backup service, or underlying host can cross this boundary. Operators must
protect the application data root and provisioner/backup credentials, restrict
network access, monitor database/role growth, set retention and RPO/RTO, verify
backups, and repeat live denial/recovery qualification against the target
managed environment. Managed recovery remains unavailable until its adapter and
platform evidence are configured; the application fails closed meanwhile.

## Conversation renderer recovery support

The existing dedicated renderer can explicitly retry its connection read after a safe error. This does not retry a user turn, approve/start a system or supply an alternate release/workspace/runtime identity. Committed API sessions retire read/turn results at layout; synchronous owners serialize reads and user submissions and refuse queued draft edits before disabled rendering. API/UUID failures use fixed text, preserve the draft and release only owned controls. The existing preload continues to validate commands and response envelopes and sanitize actual IPC failures. Transcript, title and status remain inert React text.

Finite native-event, real-preload, failure/denial, input-bound, StrictMode/Suspense and layout timing tests support only that local renderer recovery. Already-dispatched calls are not cancelled by retirement. Host main-frame/session authorization, physical runtime windows/processes, durable transcript restart and native/model qualification remain separately required.

### Meaningful-system qualification observations

The local UI test driver compares only bounded synthetic DOM observations from
its isolated workspace: exact system/instance/definition/version, hierarchy and
configured test fields. Strict inert records, count/byte bounds, one rooted
acyclic tree and unique positions prevent malformed observations from supplying
a false match. All three captured scenarios must have distinct system IDs in
one workspace. The browser creates them within one self-contained journey.
Existing protocol redaction and action/output bounds remain intact. These
comparisons add no application authority and prove no physical host, model,
process restart, native-resource or security qualification by themselves.

### Owned desktop authoring restart checks

The two synthetic authoring tests reuse the existing owned quit/native-exit and
worker-exit proof before starting a replacement app. Each session retains its own
worker records beneath the same isolated application data root; no old record is
deleted or accepted for a new process. A failed journey or shutdown prevents the
replacement. Distinct process/page checks supplement the unchanged native proof.
The asset verifier admits one replacement-page observation attempt, reuses the
original base/publication/workspace expectations and reads public metadata on
the current page. Failed or pending verification cannot be replayed. Three saved
systems reuse their captured exact synthetic observations after restart. These
checks add no production authority and change no security, model or resource
guard. Finite tests, types and collection are local implementation evidence;
actual native/host/server restart and parent qualification remain separate.
