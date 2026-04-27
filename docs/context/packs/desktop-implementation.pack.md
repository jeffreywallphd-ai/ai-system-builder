# Context Pack: Desktop Implementation

- Pack name: `desktop-implementation`

## Purpose

- Keep desktop implementation tasks aligned to the accepted Electron boundary model and renderer structure.

## Use When

- Adding or refactoring desktop renderer pages/features/components.
- Changing `apps/desktop/src/main`, preload, or renderer boundaries.
- Wiring desktop host composition to IPC transport adapters.

## Do Not Use When

- Server-only work with no desktop surface impact.
- Domain/application-only changes with no desktop host or renderer touch points.

## Core Guidance

- Use Electron + Electron Forge webpack plugin as the canonical desktop path; avoid parallel desktop build pipelines.
- Keep responsibilities split across `main`, preload, renderer, and `modules/hosts/desktop` composition.
- `apps/desktop/src/main/` handles lifecycle/bootstrap/window creation only.
- `apps/desktop/src/preload/` exposes a narrow secure bridge; keep it transport-oriented.
- `apps/desktop/src/renderer/` is React composition only: pages compose features, features contain reusable capability UI, `components/` holds generic shared UI.
- Renderer components/hooks should call small API clients/wrappers (in `lib/` or feature `api/`) rather than direct raw preload global usage.
- Desktop transport adapters (`modules/adapters/transport/ipc-electron/`) stay thin and contract-driven; business/use-case logic stays in `modules/application/**`.

## Key Constraints

- Do not place business logic in Electron `main`.
- Do not access filesystem directly from renderer components.
- Do not leak raw IPC contract details through page/component trees.
- Do not duplicate reusable feature logic into page-specific copies.
- Keep desktop-specific composition/wiring in desktop app and host composition layers, not clean-architecture core modules.
- Desktop layer must not become an ad hoc shell/orchestration system.

## Canonical Source Docs

- `docs/adr/ADR-0006-desktop-implementation-boundaries-and-renderer-structure.md` — accepted desktop boundary and renderer-structure decision.
- `docs/architecture/host-model.md` — host responsibility model and desktop-first staging posture.
- `docs/architecture/module-dependency-rules.md` — allowed dependency direction and anti-coupling constraints.
- `docs/context/packs/desktop-host.pack.md` — desktop host and IPC boundary summary.
- `docs/standards/testing-standards.md` — required layered testing and regression discipline.

## Common Over-Inclusions to Avoid

- Pulling server-host/API details into desktop renderer-only tasks.
- Treating preload globals as a replacement for renderer API client boundaries.
- Building speculative renderer utility/state systems before concrete need.

## Prompt Assembly Notes

- Typical desktop implementation set: `index` → `desktop-host` → `desktop-implementation`.
- Add `architecture` when dependency or ownership boundaries change.
- Add `testing` for behavior-sensitive desktop refactors.
- Add `desktop-styling` when renderer CSS layering/tokens/shared style ownership are part of scope.
- Use minimum-sufficient context: include only desktop packs relevant to touched layers (`main`, preload, renderer, host composition, IPC adapter).
