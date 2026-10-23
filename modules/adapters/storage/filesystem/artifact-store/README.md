# Filesystem Artifact Store Adapters

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`createFilesystemArtifactObjectStorageAdapter` is the canonical filesystem-backed
`ArtifactObjectStoragePort` implementation for host-local artifact bytes.

`createFilesystemArtifactStorageAdapter` remains as a backward-compatible alias.

`createLocalArtifactCatalogPersistenceAdapter` is the local artifact-catalog
persistence adapter that owns append/browse/read catalog-record behavior.

`createFilesystemArtifactBrowserReadAdapter` is an artifact-browser read adapter
that depends on the catalog seam for metadata reads and optional storage presence
checks for content descriptor availability.

`createFilesystemArtifactContentRetrievalAdapter` is a separate media-view
retrieval adapter for actual image bytes used by viewer rendering paths.

Current behavior:

- stores artifact bytes to disk under a configured root directory,
- appends image metadata via injected artifact catalog append port,
- serves artifact browser browse/detail/content-read from artifact catalog records,
- keeps browser contracts storage-key based and path-agnostic,
- keeps `artifact.content.read` descriptor-oriented,
- serves actual image bytes through the separate `/artifact/media/view` retrieval path.

Desktop and server inject the local binding writer for fresh generated upload
keys. A verified new buffered or streamed upload records its workspace-owned
primary local binding before catalog success. Missing workspace/catalog or failed
binding persistence denies the operation. Persisted catalog/binding identity is
checked before publication and again before binding; metadata-only collisions
deny too. Final create-if-absent operations use each owning metadata CAS and
refuse an older or unsupported conditional writer. Request key/workspace/overwrite are captured before awaits, and a fresh
binding always uses no-overwrite publication. Explicit-key writes do not adopt a
binding, and preparation still rejects missing/foreign bindings before source I/O.
Publication is not a metadata transaction: a failed or uncertain metadata write can
leave unregistered owned bytes for normal recovery; it never reports success or
deletes unrelated files. Native publication/parent-substitution qualification
remains separate from these cooperative ownership checks.
