# ADR-0014: Runtime Installer Architecture

- Status: accepted

## Problem

Runtime sidecars may require local installation before they can be started and used. ComfyUI is the first concrete example in this repository, but it will not be the only runtime target over time.

Future runtime targets may include additional GitHub/Git-installed sidecars, archive/binary-installed sidecars, or package-manager-driven local runtimes.

Installer behavior must not be embedded directly in UI code or feature-specific use cases. Installation must remain behind clean architecture boundaries so runtime targets and installation strategies can evolve without leaking infrastructure concerns into domain/application feature logic.

## Decision

Introduce a generic **Runtime Installer** abstraction.

- Runtime installer responsibilities are separate from runtime supervisor responsibilities.
- Supervisors may call installer operations before startup when configured to do so.
- Installation targets are runtime-specific, but they share common install request/result/status contracts and application ports.
- Shared runtime readiness contracts and the application readiness service may expose host-owned capability availability derived partly from installer status, but installer contracts remain the source of truth for install/discovery/repair/update status.
- The current Git installer adapter implements clone/fetch/checkout/update/status/repair-safe behavior for Git-backed runtime installs.
- The current ComfyUI installer adapter composes the generic Git installer, applies ComfyUI defaults, and manages Python dependency/finalization checks outside UI code and image-generation contracts.

## Layering

- **Contracts** define install target/source/request/result/status semantics.
- **Application port** defines generic install and status operations.
- **Adapters** implement concrete install strategies.
- **Runtime-specific adapters** (for example ComfyUI) compose generic installers with target defaults, without changing shared contracts.
- **Host composition** supplies installer/supervisor/task state readers to the application runtime readiness service, which maps them into transport-neutral readiness snapshots without taking ownership of installation or process lifecycle.

## Runtime Target Model

- Runtime install targets are identified by stable target ids (not UI labels).
- Examples:
  - `comfyui`
  - `python-worker`
  - `future-diffusers`
- Target-specific adapters may provide target defaults (install root conventions, source defaults, safety flags) while preserving generic contracts.

## Source Model

Current implemented source type:

- `git`

Planned future source types:

- `archive`
- `local-path`
- `package-manager`

Source-specific fields are modeled in contract unions so adapters can evolve source handling without cross-layer coupling.

## Install State

Installer status model:

- `not-installed`
- `installing`
- `checking`
- `installed`
- `update-available`
- `failed`
- `unknown`

## Install Metadata

Installer request/result/status flows may include:

- `installRoot`
- `targetId`
- `source`
- `requestedRef`
- `resolvedRef` / `commitSha` (when available)
- `installedAt`
- `lastCheckedAt`
- `error` and `warnings`

## Safety Rules

- Do not overwrite non-empty unmanaged directories.
- Do not delete user files.
- Installer operations must be idempotent.
- Repair/update behavior must be explicit (opt-in), not implicit.
- Force-repair for unmanaged non-empty directories must remain non-destructive and may fail safely until an explicit safe strategy is designed.
- CUDA torch dependency installation may use a user-configured PyTorch wheel index URL, but it must stay inside the managed Python dependency stage and must not require UI code to run installer commands directly.
- DirectML dependency repair is scoped to managed Python dependencies; it should not implicitly mutate repository refs or delete runtime/model files.

## ComfyUI DirectML Startup Repair Behavior

- ComfyUI startup can fail on some DirectML/Intel paths with native mismatch signatures (`torchaudio`, `WinError 127`, missing procedure symbols).
- Supervisor-level startup handling detects those signatures from startup failure output.
- On detection, supervisor triggers one installer `repairInstall` pass with update disabled, then retries startup once.
- The flow is bounded (single retry only) to prevent infinite loops.
- If repair fails, users receive an actionable dependency-repair error; if retry fails, users receive an actionable post-repair startup error.

## Current Implementation Boundaries

- Generic Git install/status/repair behavior is implemented in the adapter layer and remains source-limited to Git.
- ComfyUI install/status/repair behavior is implemented as runtime-specific adapter composition over the generic Git installer.
- Desktop and server host composition may expose ComfyUI install status, explicit repair, and installer-before-start behavior through host-owned runtime wiring.
- UI and feature use cases must not run installer commands directly; they may only call application/transport/host seams that preserve installer boundaries.
- Archive, local-path, package-manager, marketplace/package registry, public runtime distribution, and destructive unmanaged-directory repair remain outside the current implemented source set.

## Metadata Persistence

- Runtime installers should persist install metadata under the install root or in a target-specific metadata file.
- Metadata should record source, requested ref, resolved ref/commit SHA, installedAt, lastCheckedAt, and an ownership/managed marker.
- A managed marker is required before repair/update modifies an existing non-empty directory.
- Managed metadata must be validated (shape + required ownership/source fields) before an install is treated as managed.
- The current Git installer default metadata filename is `.ai-system-builder-runtime-install.json`.
- The current ComfyUI installer also writes finalization metadata, by default `.ai-system-builder-comfyui-finalization.json`, to avoid repeating dependency and validation stages unnecessarily.
- For Git sources: fetch should run before update checks; pinned refs/tags/SHAs should be checked out and recorded without implicit pull, while unpinned sources may use fast-forward pull.
