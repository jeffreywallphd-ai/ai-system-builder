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

## Prompt 4/7 Application Layer Notes

- Application image generation use cases must depend on `RuntimeTaskRegistryPort` for task lifecycle orchestration.
- ComfyUI integration remains adapter-only and must not leak into contracts or application use-case imports.
- Image asset registration for generated outputs is intentionally deferred to the next prompt.


## Runtime Installer Alignment

- ComfyUI may be auto-installed through the Runtime Installer abstraction.
- ComfyUI supervisor should call installer-before-start in a later prompt, not in this contract/architecture step.
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
