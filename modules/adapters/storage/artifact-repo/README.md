# Artifact-repo storage adapter seam

This module provides the provider-neutral adapter seam for the artifact-repo storage family.

- `createArtifactRepoStorageAdapter` composes provider-specific adapters behind `ArtifactRepoStoragePort`.
- Provider selection is explicit by `target.provider` (`StorageProviderId`).
- Provider-specific semantics stay in provider adapters (for example Hugging Face), not in this composition layer.
- The seam remains family-oriented and does not flatten artifact-repo behavior into artifact-object key/blob semantics.

