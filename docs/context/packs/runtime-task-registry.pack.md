# Runtime Task Registry Pack

Use this pack when prompt scope includes long-running runtime-backed tasks (dataset preparation, model training, validation, publishing, or future runtime handlers).

## Required Lifecycle

- Long-running work must use Runtime Task Registry async lifecycle: **start / read(status) / cancel**.
- UI and callers must poll status by `requestId` until terminal state.
- Do not use long-held HTTP/IPC requests to wait for completion.
- Do not solve timeout/disconnect issues by stretching fetch/IPC timeouts.

## Shared vs Feature-Specific Responsibilities

- Registry lifecycle/state/progress/retention concerns are shared across runtime tasks.
- Task handlers remain feature-specific.
- Do not introduce feature-specific task queues for dataset/model/etc.

## Progress + Status Source of Truth

- Use structured task status/progress from registry contracts.
- Logs remain useful diagnostics but should not be primary UI state source.

## Power Lifecycle

- Power suspension blockers should attach to runtime task lifecycle activity.
- Power blockers complement but do not replace async task lifecycle polling.

## Contract Boundaries

- Generic runtime registry contracts must not depend on Python-specific contract types.
- Python-prefixed async task contracts (for example `StartPythonRuntimeTaskRequest`, `PythonRuntimeTaskStatusResult`, and `CancelPythonRuntimeTaskResult`) are adapter-boundary types only, limited to Python HTTP/protocol implementation details.
- Python runtime adapters must map Python status/error payloads to generic runtime task registry contracts at the application boundary.
- Do not create domain aliases that merely re-export runtime contracts.


## Dataset Preparation Migration Status

- Dataset preparation now uses only `RuntimeTaskRegistryPort` with Python `/tasks/start` + `/tasks/{requestId}` lifecycle polling.
- Legacy `PythonDatasetPreparationPort` and its adapter path are retired.
- Legacy dataset-preparation synchronous `/tasks/execute` path is removed from dataset-preparation production flows.
- Model training/validation/publishing use Runtime Task Registry start/read/cancel lifecycle APIs.
- No new long-running runtime-backed feature should use legacy `/tasks/execute`; use Runtime Task Registry lifecycle APIs.
