# IPC Contracts

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

IPC contracts specialize the shared transport contract core for desktop host
message boundaries.

This family keeps the contract surface thin:

- channel naming/value shapes (`ipc-channel`)
- operation and metadata aliases from transport core (`ipc-operation`)
- channel-bound IPC request/error/response factories that preserve transport-core semantics
- narrow operation-scoped IPC contract slices (for example, desktop artifact upload flow contracts)

These contracts are intentionally serialization-friendly and avoid preload,
registration, or `ipcMain`/`ipcRenderer` mechanics. Those details belong in
adapter implementations, not in shared contracts.

IPC channel semantics are intentionally narrow:

- channel values are derived from operation identity using `ipc.<operation>.<kind>`
- channel kind is constrained to `request`, `response`, or `event`
- channel bindings pair `operation` with derived channel value and explicit kind
- request/error/response factories take that binding so operation identity is not passed independently
- success/failure result semantics are composed from `modules/contracts/transport`

Operation contracts also own boundary validation that must be repeated by the
receiving process. Desktop artifact uploads require an explicit workspace id,
an actual non-empty `Uint8Array`, and the shared 64 MiB upload maximum. Artifact
publication requires an explicit workspace id and preserves explicit repository
creation approval/visibility. These constraints prevent preload or renderer
callers from bypassing application context through structurally similar objects.
