# Context Pack: Runtime Task Registry

- Pack name: `runtime-task-registry`

## Purpose

- Route work involving accepted long-running runtime tasks through the shared async task lifecycle.
- Keep task lifecycle/progress separate from runtime readiness and feature-specific runtime protocols.

## Use When

- Dataset preparation, model download, model training, model validation, model publishing, image/runtime handlers, or future runtime-backed long-running tasks are in scope.
- Start/read/cancel/list task behavior, polling, progress, retention, cancellation, or task aggregation changes.

## Do Not Use When

- Readiness-only work that does not create or inspect accepted tasks.
- Synchronous domain/application work with no long-running runtime lifecycle.

## Required Lifecycle

- Long-running work must use Runtime Task Registry async lifecycle: start, read status, cancel, and list.
- UI/callers poll by `requestId` only after start accepts work and returns a task request id.
- Readiness-guard-rejected starts must not create pollable task ids.
- Do not use long-held HTTP/IPC requests to wait for completion.
- Do not solve timeout/disconnect issues by stretching fetch/IPC timeouts.
- Model downloads use `TaskType.MODEL_DOWNLOAD`; completion cache handles and
  resolved local paths stay behind the host-internal completion port while the
  application finalizes the model registry exactly once.
- Model training status, cancellation, save, and discard are all checked
  against the workspace recorded at start. Successful runtime completion is a
  review state: it must not finalize model registration or publication until
  explicit save, and discard must clean staged output.

## Shared Vs Feature-Specific Responsibilities

- Registry lifecycle, state, progress, correlation, cancellation, list aggregation, and retention are shared.
- Runtime readiness describes capability availability and does not replace task records or task lifecycle operations.
- Task handlers remain feature-specific but must map into generic registry contracts.
- Do not introduce feature-specific task queues for dataset/model/image/runtime features.

## Status And Progress Rules

- Use structured registry status/progress as the UI state source; logs are diagnostics only.
- Unknown `requestId` reads/cancels must return explicit not-found/unknown results with safe metadata.
- Use `recordType: "not-found"` when no valid task family is known; do not cast unknown values into a task type.
- Registry routers may recover missing in-process correlation through safe delegates.
- Status/cancel/list reads must not start, install, repair, or heavy-probe runtimes.
- List aggregation should return unsupported/failed delegate families as safe warnings instead of failing the whole read generically.

## Contract Boundaries

- Generic registry contracts must not depend on Python-specific protocol types.
- Python-prefixed task contracts are adapter-boundary protocol details only.
- Python runtime adapters map protocol payloads to generic registry contracts at the application boundary.
- Do not create domain aliases that merely re-export runtime contracts.

## Readiness Boundary

- Readiness guards may prevent starting work but do not own task progress, records, cancellation, or retention.
- If a guard rejects before task creation, later status reads for that caller correlation id remain explicit unknown/not-found.
- Do not encode task progress, Python protocol status, ComfyUI internals, or provider payloads as readiness fields.

## Asset And Workspace Notes

- Asset Registry resource-backed reads must not use task status/list/cancel/start paths to discover generated outputs, datasets, models, external objects, or publication state.
- Existing persisted model validation/publishing status may be displayed as sanitized metadata only; reads must not invoke tasks.
- Runtime task outputs created from workspace actions require explicit workspace context where implemented.
- Missing workspace context for workspace-owned task outputs must fail safely and must not fall back to global records.

## Canonical Source Docs

- `docs/architecture/runtime-model.md` - runtime execution and adapter boundaries.
- `docs/architecture/runtime-readiness-binding.md` - readiness/capability boundary.
- `docs/architecture/module-dependency-rules.md` - dependency constraints.
- `docs/standards/testing-standards.md` - runtime task lifecycle testing.
- `docs/standards/logging-standards.md` - structured task diagnostics.

## Companion Packs

- `runtime` for runtime adapter/contracts work.
- `runtime-readiness-binding` for capability readiness guards.
- `runtime-installer` for install/dependency state.
- `image-generation` for ComfyUI/image task flows.
- `persistence-storage`, `asset-kernel`, `security`, and `testing` when resource/task outputs cross those boundaries.

## Prompt Assembly Notes

- Typical set: `index` + `runtime-task-registry`.
- Add feature/runtime/host packs only for boundaries directly touched.
