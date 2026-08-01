# Desktop App

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

## Toolchain

- Host runtime: Electron
- Build/dev system: Electron Forge (webpack plugin)
- Entry point orchestration: `apps/desktop/src/main` + `modules/hosts/desktop`

## Commands

From the repository root:

- `npm run dev:desktop`
- `npm run package`
- `npm run make`
- `npm run test:visual-composer -- --project packaged-desktop` after packaging,
  to run the isolated real preload/IPC System Composer workflow on Windows

## Packaged Python worker

Forge copies the managed Python worker into the desktop application's resources
directory. The desktop host prefers that packaged entry point when it exists,
honors an explicit `PYTHON_RUNTIME_WORKER_DIR` override, and otherwise uses the
repository path during development. The resource includes the reviewed worker
source and requirements file; dependency setup still probes exact versions and
fails startup on an unexpected or mismatched dependency state.

## Local structured persistence

Desktop startup opens `<userData>/persistence/ai-system-builder.sqlite3`, applies
the versioned SQLite migration, inventories and imports allowlisted legacy JSON
with a rollback copy, then composes all typed structured repositories on SQLite
before IPC registration. Changed legacy source after activation fails startup;
there is no JSON fallback or dual write. Artifact bytes remain in the separate
artifact-storage root.

Use `npm run persistence:sqlite -- ...` for health, online backup, guarded
restore, and portable export as documented in
`docs/operations/persistence-operations.md`.

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
- `ingestWebsitePage(input, context?)`
  - maps UI website-scrape payload into the `artifact.ingest-website-page` IPC request envelope
  - forwards explicit `context.workspaceId` to the desktop host use case for workspace-scoped artifact catalog writes
- `ingestWebsitePagesBatch(input, context?)`
  - maps UI batch website-scrape payload into the `artifact.ingest-website-pages-batch` IPC request envelope
  - forwards explicit `context.workspaceId` to the desktop host use case for workspace-scoped artifact catalog writes
- `startModelDownload`, `readModelDownload`, `listModelDownloads`, and
  `cancelModelDownload` expose the short model-download task lifecycle. The
  preload validates typed response envelopes and never receives a local cache
  path.

Design constraints:

- preload remains transport-oriented (no business/use-case logic)
- UI callers do not access IPC primitives or filesystem details directly

## Renderer Upload Component

`src/renderer/App.tsx` provides an Artifacts workflow with upload + artifact browser + publish:

- selects one or more files from a native file input using the accepted artifact upload policy
- reads file bytes in the renderer (`File.arrayBuffer()` -> `Uint8Array`)
- calls preload bridge methods (`window.desktopApi.*`) through feature-local clients/hooks
- uploads selected files as independent artifact-upload requests so one rejected file does not stop the rest of the batch
- reports a per-file result list, keeps successful stored keys visible, and lets users cancel queued files before or during a batch
- renders browse/detail/content preview and Hugging Face publish success/error feedback
- supports published-backing re-check and last-verified display from durable binding metadata
- supports imported-source re-check and separate source verification status display
- supports imported-source inspection and explicit localize/download action when local bytes are missing
- supports website scraping through desktop preload/IPC with active workspace context
- opens the Data Management Hugging Face import card directly to namespace browsing and repository/path registration controls
- surfaces artifact-first backing-state cues (`Remote only`, `Localized`, `Published`) plus local object availability/localization state
- exposes Dataset Preparation training-task profiles from shared runtime contracts and submits executable first-tier dataset-preparation profiles to the local runtime, including LLM text rows and diffusion/vision image manifest rows
- lets Dataset Preparation choose provided source text or generated text fields in the Automated Data Formatting card, with editable prompts, task-scoped generation parameters, quality/compact local model presets, and an inline model download action that still records downloads through model management
- filters Dataset Preparation source artifacts by selected task family and lets users save/load changed training settings without preserving stale source-artifact selections
- colocates the optional dataset save name with the final approval actions; one explicit approval saves the complete curated ready set, then opens the exact saved dataset in Artifact Browser without rendering post-save version history in Dataset Preparation
- persists Dataset Review row rejection or approved edits as immutable minor versions and selects the resulting version
- exposes the selected training task in Train Model requests; Step 1 lists only
  active-workspace dataset artifacts and recognizes prepared Parquet outputs by
  canonical media type or file name; datasets use the same readable-name
  checkbox presentation as Dataset Preparation; the task boundary prepares
  exact reviewed text-training dependencies before dispatch, and LLM text tasks
  run through causal-LM training; diffusion image-caption manifests run through LoRA adapter
  training, and vision manifests run through LoRA adapter or full-finetune
  classification, detection, or segmentation training
- reports model-training progress to the global notification center after every
  completed batch, keeps **Stop training** available while a run is active, and
  shows **Unload model** once for each terminal training run even when the
  generation-model inventory is empty; the unload request clears cached models
  and asks the runtime to release device memory
- presents recommended Step 3 model-training parameter ranges in the existing
  help hints using the same integer, decimal, or comma-separated format accepted
  by each input
- qualifies all nine Train Model task types through the explicit
  `npm run test:model-training:e2e` suite, which uses two synthetic rows, one
  epoch, fixed tiny model revisions, and stops at the Save/Discard review state
  without saving the generated model
- holds successful training output for explicit review under the active
  workspace. **Save model** uses the configured Output model name and performs
  registration/local storage or publication; **Discard model** removes the
  staged output without registering it
- requires typed confirmation before deleting a model. Desktop deletion removes
  both the registry record and its approved local cache files, including the
  canonical runtime Hugging Face cache root; Hugging Face snapshot records
  remove the owning repository directory, including blobs, while root, linked,
  traversal, and outside-cache targets fail closed
- refreshes the workspace-scoped model inventory whenever **Manage Models** is
  opened, while retaining the explicit **Refresh Models** action
- reuses shared cross-host publish/re-check hook logic from `modules/ui/shared`

Renderer constraints for this slice:

- no direct filesystem access from UI
- no direct IPC channel usage from UI
- no styling expansion beyond the existing minimal renderer structure

## Renderer Shell And Workspace UI

- A dedicated published-system window is lifecycle-bound to its exact release.
  Explicit **Stop** closes the window without a duplicate lifecycle mutation;
  closing that window directly closes its conversation session and invokes
  **Stop** for the exact started revision so Publish does not retain a phantom
  running build. A lifecycle card refreshes authoritative status while running,
  so the host-side window close is reflected without a manual refresh.
- The sticky top bar places a Notifications bell immediately before Settings.
  Its fixed dropdown is available from every page; page messages display for
  five seconds and then fade, while model-download, dataset-preparation, and
  model-training activities remain in bounded workspace-scoped history and
  update from authoritative runtime task progress.
- Terminal save, create, update, delete/archive, upload/import/localize/publish,
  build/run, settings, image, model, and similar action outcomes publish to this
  center instead of rendering duplicative page-level banners. Field validation,
  loading and empty states, confirmation/build diagnostics, readiness or
  security blockers, retry context, and active task controls remain inline.
- Desktop primary navigation is exposed through a plain hamburger menu in the right side of the header, directly before the themed settings gear.
- The header centers a compact **Current Workspace** selector with an explicit **Change** action between the brand area and the right-side menu/settings actions.
- The Home page keeps the fuller workspace card in a compact responsive equal-width two-column layout, with change-workspace controls on the left and create-workspace controls on the right.
- Workspace-required pages should rely on the header for current workspace display and should not repeat current workspace labels in each feature panel.
- Data Management tab content uses the shared sectioned panel header style for Data Artifact Ingester, Artifact Browser, and Dataset Preparation; panel headers stay title-only, body content uses grouped sections and card/list controls, and actions such as Artifact Browser refresh belong in the body.
- Artifact Browser and Dataset Preparation source lists classify uploaded/generated artifacts by storage path segments and `sourceKind`, so workspace-prefixed keys such as `workspaces/.../artifacts/files/uploads/...` still appear in the uploaded group.

## Hugging Face auth behavior

- Desktop renderer Hugging Face register/localize/publish/verify flows go through desktop preload + desktop host composition.
- Configure `HF_TOKEN` or `HUGGING_FACE_TOKEN` (or desktop host `huggingFaceAccessToken`) in the **desktop host** environment for private/gated Hugging Face repositories.
- Public repositories may work without a token depending on repository visibility/provider policy.
- Missing/invalid token and access-denied responses are surfaced with explicit auth guidance in UI messaging.

## Hugging Face token configuration UI

- Desktop Artifact Browser now includes a **Hugging Face token** section with masked configured-state display.
- Use **Save token** / **Clear token** in renderer; desktop host persists the token and reuses it for register/localize/publish/verify flows.
- Public Hugging Face repos may work without token; private/gated repos may require token configuration.
