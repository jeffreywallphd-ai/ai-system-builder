# Image Generation Context Pack

## Scope

Use this pack for tasks involving image generation contracts, runtime lifecycle wiring, engine abstraction, and image asset semantics.

## Feature Overview

- Image generation is a first-class runtime-backed capability.
- It uses async Runtime Task Registry lifecycle (`startTask`, status polling, optional cancel).
- ComfyUI is the initial sidecar engine implementation, but contracts remain engine-agnostic.

## Runtime Registry Relationship

- Image generation tasks use shared `TaskType` + `RuntimeTaskStatus` semantics.
- No long-held synchronous request lifecycle for generation workloads.
- Progress/status should be read from runtime task registry records.

## Assets vs Artifacts

- Artifacts are storage-backed outputs.
- Assets represent user-meaningful identity/metadata for generated images.
- Generated outputs should be registered as assets linked to artifact storage.

## Engine Abstraction Model

- Contract layer defines generic image generation request/result types.
- Application depends on image generation ports and runtime lifecycle contracts.
- Runtime adapters translate generic contracts to engine-specific protocols (ComfyUI now, others later).

## Canonical Reference

- See `docs/adr/ADR-0012-image-generation-runtime.md`.

## Separation of Concerns Clarifications

- Contracts are engine-agnostic and capture intent rather than sidecar-specific payload shapes.
- Runtime task registry is the execution path for image generation workloads.
- Assets are created post-execution in the application layer, not in the runtime layer.

## Application Layer Notes

- Application image generation use cases must depend on `RuntimeTaskRegistryPort` for task lifecycle orchestration.
- ComfyUI integration remains adapter-only and must not leak into contracts or application use-case imports.
- Generated-output finalization and image asset registration belong after runtime completion in application/asset flows, not in runtime adapters.


## Runtime Installer Alignment

- ComfyUI may be auto-installed through the Runtime Installer abstraction.
- ComfyUI supervisor may call installer-before-start through host/runtime composition; keep installation outside image generation contracts and use cases.
- Installation is separate from image generation contracts and application use cases.


- ComfyUI may require Python dependencies at install time.
- The runtime installer installs ComfyUI dependencies into a managed `.venv` by default to keep image generation isolated from ambient Python user-site packages.


- `skipPythonSetup` skips Python dependency installation only (requirements/pip), not entrypoint checks.
- `skipPythonValidation` skips running `python main.py --help` validation.
- Entrypoint existence (`main.py`) remains a lightweight validation check even when Python validation is skipped.
- ComfyUI `repairInstall` runs the same post-install dependency + validation checks as `ensureInstalled` when Git repair reports installed.
- ComfyUI runtime startup launches with `PYTHONNOUSERSITE=1`; managed `.venv` startup is the default desktop composition path.
- On DirectML/Intel GPU paths, ComfyUI startup may fail due to `torch`/`torchaudio` native mismatch signatures (including `WinError 127`).
- During installer finalization in DirectML mode, `torch-directml` is installed first, the final torch version is probed, and `torchaudio`/`torchvision` are reconciled to that final torch.
- This DirectML path targets Intel/AMD devices and does not require NVIDIA/CUDA.
- DirectML override env vars for torch companions are advanced controls and can break compatibility if set incorrectly.
- When detected, the supervisor performs one managed dependency repair attempt and retries startup once before surfacing a clear actionable failure.
- The repair flow is non-destructive: it repairs managed Python dependencies and does not delete models or ComfyUI repo files.
- ComfyUI host composition defaults to CPU when no accelerator is explicitly configured or clearly detected; do not let implicit ComfyUI autodetection assume NVIDIA/CUDA.



## Host-owned execution and output ownership

- Image generation can execute in desktop local mode, server/thin-client mode, or future desktop remote mode.
- The executing host owns ComfyUI/Python runtime process/install/cache state.
- Generated outputs finalize into the executing host artifact storage.
- Thin-client and future desktop-remote UI should consume artifact-backed references/media URLs.
- UI should not depend on ComfyUI temp output folders.
- Model/checkpoint resolution belongs to the executing host.
- Canonical references: ADR-0013 and ADR-0012.

- Image-generation routes should require image-generation scopes through centralized route policy.
- Generated image artifacts should be authorized via artifact storage/media routes.
- ComfyUI temp paths must not be exposed as security-relevant client state.

## Presentation ownership

- Both host hooks use committed workspace/client sessions, synchronous mutation
  admission and exact accepted-task reads. Retired replies cannot replace recovery
  identity. Unknown progress keeps the task observable.
- Finalization needs complete bounded registered assets and preserves same-request
  retry. Late cancellation cannot revoke confirmed output. Form validation follows
  existing request bounds; unexpected errors use safe Notifications copy.
- Focused fixtures do not qualify physical generation or native cleanup. See
  `docs/architecture/runtime-model.md` for the owning boundary and limitations.

## Desktop navigation draft recovery

The Desktop form uses bounded renderer memory keyed by workspace and the exact
image, model and artifact client owners. It retains only known form fields,
with eight workspace entries and a 128 KiB serialized limit per draft. Detached
reads and owner-labelled updates prevent a retired view from writing into the
next scope. No private prompt is added to browser or disk storage. Full reload
recovers only the existing opaque task ID, not unsent form text or cached task
success. Read `docs/architecture/runtime-model.md` before changing these limits
or retention. Focused remount and isolation tests do not qualify actual image
generation or native cleanup.


## Image host qualification definitions

- Dedicated image Desktop/Thin configs collect create/register and task-recovery
  cases in the existing operational host specs. Run one host at a time.
- `image-host-global-setup.mjs` requires explicit opt-in and verifies fixed local
  managed inputs before build/start. No model or dependency acquisition occurs.
- `image-host-inputs.mjs` bounds regular-file/header/hash snapshots; these are not
  supplier, native-file or launch capabilities. Input records contain no results.
- Actual cases decode/hash the PNG and reopen the exact unique saved artifact.
- Server stdin shutdown uses the canonical task/persistence fence; Desktop
  main-only evidence leaves ComfyUI/model workers and native job proof pending.
- Helper tests and collection are source support. Actual hosts/full testing stay
  deferred; accepted model accuracy is not rerun. See `dev-tools/README.md`.
