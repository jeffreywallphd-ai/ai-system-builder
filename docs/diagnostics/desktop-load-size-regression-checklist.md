# Desktop Load-Size Regression Checklist

Use this checklist when reviewing desktop startup, route loading, page sections, or feature lifecycle changes.

## Startup composition contract

- Compose only Electron shell, logging, memory diagnostics, settings/token basics, workspace list/create/selection shell, minimal runtime readiness shell, preload shape, and IPC registration shell.
- IPC registration may register all channel groups, but must not resolve lazy feature providers.

## Forbidden startup features

Startup must not import or compose model, artifact remote, asset resource-backed, image generation, ComfyUI image runtime, Python task/runtime, Hugging Face remote browse/publish, ingestion, dataset-preparation, training, validation, publishing, or power lifecycle feature graphs.

## Route-lazy requirements

- App shell and navigation render without importing every page module.
- Workspace-blocked routes do not import the blocked page module.
- Only the active page module should emit lazy-load diagnostics.

## Section-loading requirements

- Initial sections are documented as intentional page-open work.
- Remote, runtime, mutation, selected-detail, search, refresh, and task work must be classified as deferred, expanded, selected-item, search-triggered, refresh, user-action, or task-driven.

## Runtime safety requirements

- Opening Models does not browse Hugging Face or run train/validate/publish.
- Opening Artifacts does not scrape websites or run remote artifact operations.
- Opening Image Generation does not start Python, start ComfyUI, run GPU detection, or read deep runtime readiness.
- Opening Systems does not query Python status, ComfyUI install status, host lifecycle state, start runtimes, or run GPU detection.
- Opening Settings with Software status collapsed does not query runtime status or browse remote resources.

## Lifecycle disposal safety requirements

- `disposable` features are safe without active task risk or implement `canDispose`.
- Runtime task registry, ComfyUI image runtime, and Python runtime remain explicit-unload-only / explicit user actions.
- Generic disposal does not delete persisted user data, stop Python/ComfyUI, or cancel active tasks.

## Diagnostic commands

```bash
DESKTOP_MEMORY_DIAGNOSTICS=1 npm run dev:desktop
npx tsx --test modules/hosts/desktop/composition/tests/desktopStartupLazyComposition.unit.test.ts
npx tsx --test apps/desktop/src/renderer/tests/app-lazy-pages.ui.test.tsx
npx tsx --test apps/desktop/src/renderer/tests/page-section-loading.unit.test.tsx
```

## Manual smoke-test sequence

1. Start with `DESKTOP_MEMORY_DIAGNOSTICS=1 npm run dev:desktop`.
2. Confirm startup has no deferred feature import/compose milestones.
3. Confirm shell/navigation render before page modules resolve.
4. Navigate to workspace-required pages while no workspace is selected; confirm workspace gate blocks page import.
5. Open Models, Artifacts, Image Generation, Systems, and Settings; confirm page-open work matches the section policy.
6. Expand Settings / Software status, then lifecycle diagnostics; confirm state reads without loading feature graphs.
7. Expand Settings / Software status, then ComfyUI status; confirm install status reads without ComfyUI start or image-runtime composition.
8. Use explicit runtime/generation actions only when testing runtime startup.
