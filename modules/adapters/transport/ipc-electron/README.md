# IPC Electron Transport Adapter

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This adapter registers thin Electron IPC handlers that translate IPC transport
requests into application use-case calls and return structured IPC contract
responses.

Current implemented flow:

- `artifact.upload` request channel registration
- request payload/context delegation into `StoreArtifactUploadUseCase`
- structured IPC success/failure response mapping on the response channel

## Artifact IPC security boundary

- Artifact upload and browser handlers require a host-owned sender-trust policy.
  The production desktop host accepts only the exact `webContents` and main
  frame of a live window it owns; subframes, spoofed senders, and destroyed
  windows fail with a sanitized `forbidden` response before a use case runs.
- Preload contracts validate before invocation, and main-process handlers
  independently reconstruct and validate request contracts. Renderer typing is
  not treated as a trust boundary.
- Upload bytes are non-empty `Uint8Array` values capped at 64 MiB. The renderer
  rejects an oversized `File.size` before calling `arrayBuffer()`. The preload
  rejects invalid or oversized values and a second concurrent upload before
  Electron serialization, and main enforces the same shared limit before
  storage or classification.
- Artifact publication carries explicit workspace context. Main preserves safe
  authorization errors, while application authorization occurs before catalog,
  binding, credential, provider, or repository reads.

Current test coverage for this slice:

- unit mapping tests for request/context delegation and response translation
- integration test for real handler execution through use case + filesystem storage adapter
- negative sender-trust, oversized-upload, and workspace-publication tests
