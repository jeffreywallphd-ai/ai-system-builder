# Context Pack: Electron IPC

- Pack name: `ipc-electron`

## Purpose

- Guide Electron IPC contract, handler, and preload work while preserving shared transport envelope discipline.

## Use When

- Adding/changing `modules/contracts/ipc/**`, IPC handler registration, desktop preload methods, or renderer calls through preload.

## Do Not Use When

- Server API-only work.
- Desktop renderer-only work that uses existing preload methods without changing IPC contracts.

## Core Guidance

- IPC contracts are transport specializations over shared operation identities and envelopes.
- Use shared helpers such as `createIpcChannel`, request/success/failure response builders, and IPC error builders.
- Channels must stay operation-derived as `ipc.<operation>.<kind>` with request/response/event kinds only.
- Handlers depend on application ports/use cases, not renderer code, Electron objects, host composition objects, or persistence adapters.
- Preserve `requestId` and `correlationId` across success and failure responses.
- Unexpected internal failures should return generic sanitized transport failures.
- Runtime readiness IPC wraps shared runtime readiness contracts through `RuntimeReadinessPort` and must not start/stop/install/repair/probe runtimes.
- Runtime-backed start handlers may map readiness guard failures to `unavailable`; do not apply start guards to read/cancel/finalize paths unless the operation contract requires it.

## Asset And Workspace IPC Rules

- Asset Registry IPC reads are workspace-aware list/detail/resource-backed reads through the read facade.
- Missing/invalid workspace context must fail safely and must not call global fallback reads.
- Read handlers must not receive repositories, host composition helpers, mutation use cases, seed services, runtime/storage adapters, provider clients, scan seams, or byte readers.
- Approved Asset Kernel mutation IPC operations are limited to register resource-backed view, finalize generated output, import external repository object, and localize external repository object.
- Workspace IPC/preload operations may cover list, create, active-selection read/save/clear, and passing workspace ids through workspace-owned feature requests.
- Renderer code must not synthesize authoritative workspace ids, use display-name slugs as ids, or bypass preload for workspace selection.

## Input And Error Rules

- Normalize/validate IPC inputs before calling application facades/use cases.
- Malformed asset type/family/status, booleans, expansion flags, limits, cursors, ids, versions, or workspace ids should fail validation at the boundary.
- Do not leak stack traces, local paths, storage/runtime roots, env values, secrets, tokens, raw adapter payloads, provider-native errors, bytes, blobs, base64, prompts, or workflow payloads through IPC/preload.

## Key Constraints

- Do not add arbitrary asset create/update/delete/editor, seed, provider browse/download, runtime execution, scan, byte/content, pack import/export/install/activate, override edit, resolver, collaboration, or marketplace channels unless canonical scope changes.
- Keep server API readiness routes separate from desktop IPC work.
- Keep Python-specific runtime IPC separate from generic runtime readiness IPC.

## Canonical Source Docs

- `docs/architecture/host-model.md`
- `docs/architecture/module-dependency-rules.md`
- `docs/architecture/runtime-model.md`
- `docs/adr/ADR-0013-host-owned-runtime-execution-and-feature-placement.md`

## Companion Packs

- `desktop-host` for desktop host composition.
- `desktop-implementation` for renderer/preload client usage.
- `runtime`, `runtime-task-registry`, or `runtime-readiness-binding` for runtime-related channels.
- `asset-kernel`, `security`, and `testing` for Asset Registry/Library and public payload work.

## Prompt Assembly Notes

- Typical set: `index` + `desktop-host` + `ipc-electron`.
- Add feature packs only when IPC changes expose that feature boundary.
