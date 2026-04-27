# Desktop App

## Toolchain

- Host runtime: Electron
- Build/dev system: Electron Forge (webpack plugin)
- Entry point orchestration: `apps/desktop/src/main` + `modules/hosts/desktop`

## Commands

From the repository root:

- `npm run dev:desktop`
- `npm run package`
- `npm run make`

## Preload Bridge Surface

The preload layer exposes a narrow desktop API at `window.desktopApi` for UI-to-host transport.

Current methods:

- `uploadArtifact(input, context?)`
  - maps UI-provided upload payload into the `artifact.upload` IPC request envelope
  - invokes only `ipc.artifact.upload.request`
  - returns the structured IPC upload response envelope
- `browseArtifacts(context?)`
- `readArtifactDetail(locator, context?)`
- `readArtifactContentDescriptor(locator, context?)`
- `readArtifactViewerMedia(locator, context?)`
- `publishArtifactToRepo(input, context?)`
  - maps UI publish payload into the `artifact.publish` IPC request envelope
  - invokes only `ipc.artifact.publish.request`
  - returns structured publish result/failure envelope
- `verifyPublishedArtifactBacking(input, context?)`
  - maps UI verification payload into the `artifact.publish.verify` IPC request envelope
  - invokes only `ipc.artifact.publish.verify.request`
  - returns structured verify result/failure envelope
- `verifyImportedArtifactSourceBacking(input, context?)`
  - maps UI imported-source verification payload into the `artifact.source.verify` IPC request envelope
  - invokes only `ipc.artifact.source.verify.request`
  - returns structured source-verify result/failure envelope
- `registerArtifactFromRepo(input, context?)`
  - maps UI register payload into the `artifact.register.from-repo` IPC request envelope
  - invokes only `ipc.artifact.register.from-repo.request`
  - returns structured register result/failure envelope
- `localizeArtifactFromRepo(input, context?)`
  - maps UI localize payload into the `artifact.localize.from-repo` IPC request envelope
  - invokes only `ipc.artifact.localize.from-repo.request`
  - returns structured localize result/failure envelope

Design constraints:

- preload remains transport-oriented (no business/use-case logic)
- UI callers do not access IPC primitives or filesystem details directly

## Renderer Upload Component

`src/renderer/App.tsx` provides an Artifacts workflow with upload + artifact browser + publish:

- selects one file from a native file input (`accept="image/*"`)
- reads file bytes in the renderer (`File.arrayBuffer()` -> `Uint8Array`)
- calls preload bridge methods (`window.desktopApi.*`) through feature-local clients/hooks
- renders browse/detail/content preview and Hugging Face publish success/error feedback
- supports published-backing re-check and last-verified display from durable binding metadata
- supports imported-source re-check and separate source verification status display
- supports imported-source inspection and explicit localize/download action when local bytes are missing
- surfaces artifact-first backing-state cues (`Remote only`, `Localized`, `Published`) plus local object availability/localization state
- reuses shared cross-host publish/re-check hook logic from `modules/ui/shared`

Renderer constraints for this slice:

- no direct filesystem access from UI
- no direct IPC channel usage from UI
- no styling expansion beyond the existing minimal renderer structure

## Hugging Face auth behavior

- Desktop renderer Hugging Face register/localize/publish/verify flows go through desktop preload + desktop host composition.
- Configure `HF_TOKEN` or `HUGGING_FACE_TOKEN` (or desktop host `huggingFaceAccessToken`) in the **desktop host** environment for private/gated Hugging Face repositories.
- Public repositories may work without a token depending on repository visibility/provider policy.
- Missing/invalid token and access-denied responses are surfaced with explicit auth guidance in UI messaging.


## Hugging Face token configuration UI

- Desktop Artifact Browser now includes a **Hugging Face token** section with masked configured-state display.
- Use **Save token** / **Clear token** in renderer; desktop host persists the token and reuses it for register/localize/publish/verify flows.
- Public Hugging Face repos may work without token; private/gated repos may require token configuration.
