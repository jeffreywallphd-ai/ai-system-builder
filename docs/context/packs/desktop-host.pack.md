# Context Pack: Desktop Host

- Pack name: `desktop-host`

## Purpose

- Guide desktop host composition and Electron boundary discipline.
- Keep `apps/desktop`, main/preload/IPC, and desktop bootstrap wiring aligned to shared contracts and use cases.

## Use When

- Working in `apps/desktop`, `modules/hosts/desktop`, Electron main/preload/IPC, window lifecycle, desktop runtime composition, or desktop workspace shell behavior.
- Diagnosing desktop IPC/preload/runtime-readiness failures.

## Do Not Use When

- Server-only API/host tasks.
- Pure application/domain/runtime work with no desktop host or IPC impact.

## Core Guidance

- Desktop is a host model, not the whole architecture.
- Electron and Electron Forge are desktop host/build tooling.
- Preload and IPC are transport/boundary mechanics, not business logic layers.
- Keep business policy and use-case orchestration in application/domain, not main/preload/IPC glue.
- IPC contracts specialize shared transport envelopes and use operation-derived channels.
- Desktop host composes adapters, runtime/readiness providers, credential stores, storage roots, and lifecycle behavior, then delegates inward.
- Host context passed inward should be small, JSON-serializable, and free of Electron/request/session/window objects.
- Desktop renderer should keep using preload/IPC even when a feature later delegates to a remote server.

## Host-Owned Runtime Guidance

- Desktop local runtime roots are desktop-owned and separate from server runtime roots by default.
- Published systems use one host-derived contained SQLite database per opaque
  runtime instance. IPC/renderers never receive paths or database handles, and
  desktop shutdown drains all open runtime sessions.
- Published visual systems use a bounded dedicated-window registry and a
  separate minimal preload. Main derives release/session authority from the
  exact live main frame, denies navigation/popups/permissions/foreign IPC, and
  closes windows and conversation sessions before runtime and platform stores.
- Runtime readiness IPC depends on application `RuntimeReadinessPort` and shared runtime readiness contracts.
- Readiness providers must read non-starting supervisor/installer signals only.
- Runtime-backed start use cases may receive readiness guards; read/cancel/finalize paths should not be guarded unless the contract requires it.
- Typecheck the desktop composition closure when touching host wiring; `ts-loader` failures can surface as vague no-output errors.
- When wrapping ports for logging/lifecycle, spread the full existing port first and override adapted methods only.

## Asset And Workspace Notes

- Include `asset-kernel` when desktop work exposes Asset Registry/Library, resource-backed views, generated outputs, or asset mutations.
- Desktop Asset Library reads and approved mutations must flow through preload-backed clients, not direct imports of application services, host composition, repositories, providers, or persistence adapters.
- Public Asset Registry reads are workspace-aware and must carry `workspaceId` without global fallback.
- Approved Asset Library mutations are narrow: register resource-backed view, finalize generated output, import external repository object, and localize external repository object.
- Desktop workspace UI uses real preload/IPC workspace operations for list/create/read/save/clear active selection.
- Renderer code must not synthesize authoritative workspace ids, derive ids from display names, create hidden/default workspaces, auto-seed startup workspaces, expose pack installer UI, or treat active selection as authorization.

## Key Constraints

- Do not turn IPC handlers into a miscellaneous service layer.
- Keep desktop transport translation thin, contract-driven, and sanitized.
- Do not leak Electron objects, raw paths, storage roots, env values, tokens, stack traces, process internals, or raw adapter payloads through IPC/preload.
- Do not put configured-server runtime calls directly in renderer components.
- Do not add pack import/export/install/activation UI, resolver execution, provider browsing, scans, byte reads, workflow execution, collaboration, or marketplace behavior unless canonical scope changes.

## Canonical Source Docs

- `docs/architecture/host-model.md` - desktop host responsibilities.
- `docs/adr/ADR-0003-host-model-and-transport-separation.md` - host/transport separation.
- `docs/adr/ADR-0013-host-owned-runtime-execution-and-feature-placement.md` - local/remote runtime ownership.
- `docs/architecture/module-dependency-rules.md` - host/adapter dependency boundaries.
- `docs/standards/coding-standards.md` - host/transport anti-patterns.
- `docs/standards/logging-standards.md` - startup and boundary diagnostics.

## Companion Packs

- `ipc-electron` for channels, handlers, and preload contracts.
- `desktop-implementation` for renderer/page/client work.
- `desktop-styling` for renderer CSS/style changes.
- `runtime`, `runtime-task-registry`, or `runtime-installer` for runtime ownership.
- `asset-kernel`, `persistence-storage`, `security`, and `testing` when those boundaries are touched.

## Common Over-Inclusions To Avoid

- Loading server/API guidance for desktop-only work.
- Treating Electron API details as shared architecture rules.
- Pulling persistence/storage details unless desktop work changes those boundaries.
- Keeping prompt-history notes in desktop host context.

## Prompt Assembly Notes

- Typical set: `index` + `desktop-host`.
- Add `ipc-electron` for IPC/preload work.
- Add `desktop-implementation` for renderer work.
- Add `logging` and `testing` for diagnostics and regression-sensitive changes.
