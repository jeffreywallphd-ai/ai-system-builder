# Desktop host composition

`composeDesktopHost` wires desktop-host lifecycle dependencies while keeping Electron IPC transport thin.

Current composition includes:

- artifact-object storage via filesystem adapter,
- local artifact catalog and storage-binding persistence,
- artifact-browser read + media retrieval use cases,
- artifact-repo storage composition with Hugging Face provider registration.

## Hugging Face token configuration

- `composeDesktopHost` passes `options.artifactRepo.huggingFaceAccessToken` into the Hugging Face adapter.
- If that option is omitted, the adapter falls back to `HF_TOKEN`, then `HUGGING_FACE_TOKEN` in the desktop host environment.
- Desktop renderer artifact-repo operations (`register`, `localize`, `publish`, `verify`) use this host path via preload/IPC and therefore depend on desktop host token configuration for private/gated repositories.
- Public Hugging Face repos may work without a token; private/gated repos surface explicit auth-required (`unavailable`) errors.
