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
