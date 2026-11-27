# Filesystem Storage Adapters

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This module provides concrete storage adapters that map logical storage keys
to host-local filesystem paths for real artifact persistence.

These adapters implement the artifact/object-storage family.
They do not define all possible storage semantics for the repository (for example repo-backed provider storage families).

For the desktop upload slice, use the adapter exposed by
`artifact-store/createFilesystemArtifactObjectStorageAdapter`
(or the backward-compatible alias `artifact-store/createFilesystemArtifactStorageAdapter`).

Boundary rules:

- callers provide logical, path-agnostic storage keys through storage contracts,
- absolute filesystem path resolution stays inside the adapter,
- operation results and failures are returned through storage contract envelopes.
- artifact catalog reads classify JSON, JSON Lines, NDJSON, YAML, and compatible
  JSON media types as `structured-text`; legacy JSON records stored as `binary`
  are normalized on read without rewriting user data.
- streamed artifact finalization and ingestion checkpoint chunks use contained
  temporary files plus atomic publication, exact byte ceilings, and digest
  verification so failed writes do not expose partial final artifacts.

The contained streaming writer optionally records its genuine original handle
and operations through one module-owned lifetime. The training byte adapter can
capture one matching publication/context retirement capability before writing.
Its permanent fence denies new files; inspection needs no fresh business grant.
Only known original operation returns and acknowledged close establish local IO
closure. A lost open/close acknowledgement stays uncertain, even after fixture
cleanup. Live sets are bounded, with no per-frame history. Default callers retain
their existing behavior and the training adapter's original two-method surface.
Closed IO does not clear uncertain publication or byte accounting, prove Native
custody/capacity, or authorize retry, delete, credit, Save or worker retirement.

The bounded-local wrapper keeps failed publication separate from unknown IO.
After fencing, a late original permission/write operation must actually return
and its handles must close before IO reports closed. Invalid callback or Promise
contracts stay unconfirmed. A corrupt or denied publication remains failed and
retained even when its execution resources can retire through the original
worker and receiver barriers. It cannot produce a finalized file inventory.

The local publication owner also implements the private retained-file verifier.
It requires finalized original inventory and fresh captured read controls. Each
contained regular single-link file is streamed through a fixed 64 KiB buffer;
size, SHA-256 and file identity must match before and after reading. All original
handles must close before detached current facts return. A read deadline retains
the original operation and prevents a concurrent attempt until it actually ends.
A lost close or invalid operation contract stays unconfirmed. This capability
loads no model and grants no worker, cleanup, registration or Save authority.
Synchronous currentness is checked before and after every chunk. Fresh business
permission is checked before and after each file and before facts return. A
permission-only withdrawal cannot disclose facts or start reading another file.
