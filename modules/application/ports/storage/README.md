# Storage Ports

Application orchestration uses specialized storage-family ports.

## Artifact-object storage port

`ArtifactObjectStoragePort` (with backward-compatible alias `ArtifactStoragePort`) covers key/blob/object behavior:

- store artifacts via `StoreArtifactRequest` / `StoreArtifactResult`
- retrieve artifacts via `RetrieveArtifactRequest` / `RetrieveArtifactResult`
- check existence via `HasArtifactRequest` / `HasArtifactResult`
- delete artifacts via `DeleteArtifactRequest` / `DeleteArtifactResult`

This seam is intentionally key-based and artifact-oriented; adapters map keys to physical storage details.

`ApplicationRequestContext` is the generic application-layer request metadata context for storage-family ports. Keep request payloads (`StoreArtifactRequest`, `RetrieveArtifactRequest`, etc.) focused on storage semantics and pass request metadata separately via the optional context argument.

## Artifact-repo storage port

`ArtifactRepoStoragePort` covers provider/repository/revision/path behavior:

- store artifacts in repo-backed storage via `StoreArtifactInRepoRequest` / `StoreArtifactInRepoResult`
- retrieve artifacts from repo-backed storage via `RetrieveArtifactFromRepoRequest` / `RetrieveArtifactFromRepoResult`
- check artifact existence in repo-backed storage via `HasArtifactInRepoRequest` / `HasArtifactInRepoResult`

`ApplicationRequestContext` is the generic application-layer request metadata context used by artifact-object storage, artifact-repo storage, and artifact browser/catalog/content seams.
