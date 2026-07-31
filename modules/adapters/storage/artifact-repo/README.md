# Artifact-repo storage adapter seam

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This module provides the provider-neutral adapter seam for the artifact-repo storage family.

- `createArtifactRepoStorageAdapter` composes provider-specific adapters behind `ArtifactRepoStoragePort`.
- Provider selection is explicit by `target.provider` (`StorageProviderId`).
- Provider-specific semantics stay in provider adapters (for example Hugging Face), not in this composition layer.
- The seam remains family-oriented and does not flatten artifact-repo behavior into artifact-object key/blob semantics.

