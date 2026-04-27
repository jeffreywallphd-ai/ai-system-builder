# ADR-0006: Desktop Implementation Boundaries and Renderer Structure

- Status: accepted
- Date: 2026-04-15
- Deciders: ai-system-builder maintainers
- Related: docs/adr/ADR-0003-host-model-and-transport-separation.md, docs/architecture/host-model.md, docs/architecture/system-overview.md, docs/architecture/module-dependency-rules.md, docs/context/packs/desktop-host.pack.md, apps/desktop/forge.config.js, modules/hosts/desktop/composition/composeDesktopHost.ts

## Context

Desktop-first delivery is now actively implemented and needs tighter, explicit execution boundaries.

Without a recorded desktop direction, desktop work can drift into common failure modes:

- Electron `main` accumulating business orchestration,
- preload becoming an unbounded API surface,
- renderer components coupling directly to raw preload globals,
- desktop-specific wiring leaking into application/domain modules,
- ad hoc desktop build pipelines diverging from the canonical one.

The rebuild direction already separates host, transport, and application concerns. The desktop surface now needs a concrete implementation model that preserves those boundaries while supporting near-term delivery.

## Decision

Desktop implementation uses Electron as the canonical host technology and Electron Forge (webpack plugin) as the canonical desktop dev/build/package path.

Desktop code is intentionally split into four roles:

1. Electron `main`
2. preload
3. renderer
4. desktop host composition

### Role boundaries

- Electron `main` owns lifecycle, host bootstrap initiation, and window creation only.
- Preload is a narrow, secure bridge from renderer to desktop host capabilities.
- Renderer is a React app for UI composition; it does not own filesystem access, IPC internals, or backend business logic.
- Renderer should access preload through small frontend-facing API clients/hooks, not scattered direct `window.desktopApi` usage.
- Reusable application logic remains in `modules/**` (application/domain/contracts/adapters/hosts), not in renderer feature components.
- Desktop-specific wiring belongs in `apps/desktop` and `modules/hosts/desktop` composition paths, not in clean-architecture core layers.
- Desktop is a host implementation, not a return to shell-like orchestration.

## Alternatives Considered

### 1) Keep desktop structure informal and implementation-driven

Rejected.

This increases boundary drift risk and review ambiguity as desktop scope grows.

### 2) Put most desktop behavior in Electron `main` and preload for convenience

Rejected.

This mixes transport/lifecycle concerns with business orchestration and weakens reuse across hosts.

### 3) Treat renderer as a thin shell over direct preload globals

Rejected.

This leaks transport details into UI components and makes boundary-safe UI reuse/refactor harder.

### 4) Record explicit main/preload/renderer/composition boundaries with Forge as canonical pipeline

Accepted.

This keeps desktop implementation aligned with host/transport separation and preserves clean-architecture ownership in reusable modules.

## Consequences

### Positive

- Desktop responsibilities are explicit and reviewable.
- Renderer code stays compositional and less coupled to IPC mechanics.
- Desktop host wiring remains outside core application/domain boundaries.
- Build and packaging path consistency improves through one canonical Forge+webpack flow.

### Negative

- Small additional indirection exists in renderer API client layers.
- Some implementation velocity is traded for boundary discipline.
- Desktop-specific experiments outside Forge+webpack require explicit architectural justification.

### Follow-up

- Keep desktop context packs and architecture docs aligned with these boundaries.
- Expand renderer feature/page/component structure incrementally as new desktop capabilities are added.
- Add/maintain desktop regression tests when renderer/preload/IPC boundaries change.
