# Application Use Cases

Use cases in this folder own application orchestration and remain adapter-agnostic.

- `StoreArtifactUploadUseCase`
  - validates upload input at a basic, honest level,
  - delegates artifact persistence to `ArtifactStoragePort`,
  - emits structured start/success/failure events through `LoggingPort`,
  - returns a narrow descriptor-based result aligned to upload contracts.
