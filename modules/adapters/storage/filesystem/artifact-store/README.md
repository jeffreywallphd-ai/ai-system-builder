# Filesystem Artifact Store Adapters

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
