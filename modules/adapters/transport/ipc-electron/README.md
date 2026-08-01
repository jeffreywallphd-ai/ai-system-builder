# IPC Electron Transport Adapter

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This adapter registers thin Electron IPC handlers that translate IPC transport
requests into application use-case calls and return structured IPC contract
responses.

Current implemented flow:

- `artifact.upload` request channel registration
- request payload/context delegation into `StoreArtifactUploadUseCase`
- structured IPC success/failure response mapping on the response channel

System published-lifecycle IPC exposes a read and invoke pair. The preload and
main process accept only workspace ID, exact release ID, projected lifecycle
action, and opaque expected revision. Main injects the local trusted principal
and host-owned lifecycle configuration. Renderer-provided deployment IDs, run
IDs, capabilities, secrets, egress, or policy cannot cross this boundary.

## Published runtime conversation boundary

The dedicated published-system preload exposes only bounded transcript reads and
message submission. It accepts no workspace, release, runtime-instance, model,
storage, approval, principal, or provider identity. Main resolves those values
from the exact live main frame of a host-owned runtime window, revalidates the
immutable release and lifecycle session, and then delegates to application use
cases composed over that instance's runtime database.

Preload and main independently validate and normalize every request. Subframes,
foreign or destroyed windows, malformed messages, stale lifecycle sessions, and
release/model/runtime mismatches fail closed with sanitized responses. Runtime
window registration is bounded, and Stop or application shutdown closes its
conversation session before the instance database and platform database.

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
- Governed Add data commands use the `ingestion.task-execute.request` channel.
  Preload and main independently normalize the bounded command, main rejects an
  untrusted sender before resolving the lazy ingestion feature, and the host
  supplies workspace/organization authority. Renderers receive opaque task,
  progress, snapshot-result, and sanitized error data, never checkpoint paths,
  credentials, or raw provider responses.
- Context Management uses one allowlisted typed execute channel. Preload and
  main independently normalize identifier-only source/browser commands and
  bounded generation/query settings. Main denies untrusted senders before lazy
  feature resolution, injects the authoritative local actor, and delegates to
  the same application facade used by the server host.

Current test coverage for this slice:

- unit mapping tests for request/context delegation and response translation
- integration test for real handler execution through use case + filesystem storage adapter
- negative sender-trust, oversized-upload, and workspace-publication tests
- negative runtime-window sender, subframe, stale-session, and malformed-message
  tests
