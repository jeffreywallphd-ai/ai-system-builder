# Desktop Memory Diagnostics

Set `DESKTOP_MEMORY_DIAGNOSTICS=1` to emit local, developer-facing one-line JSON snapshots during Electron desktop startup and renderer activation:

```bash
DESKTOP_MEMORY_DIAGNOSTICS=1 npm run dev:desktop
```

Each line uses the `desktop.memory.snapshot` or `desktop.renderer.memory.snapshot` event and includes a stable `milestone`, `component`, timestamp, process label, uptime, and best-effort memory fields. Main-process snapshots include `process.memoryUsage()` values (`rss`, `heapTotal`, `heapUsed`, `external`, and `arrayBuffers` when available) plus safe system context such as platform, architecture, Node, Electron, and Chrome versions. Renderer snapshots use `performance.memory` only when Chromium exposes it; otherwise the milestone still logs without heap numbers.

## Milestone groups

- `desktop.main.*` and `desktop.app.*`: Electron main module load and app readiness.
- `desktop.host.compose.*`: desktop host composition boundaries before IPC registration.
- `desktop.host.*.before` / `desktop.host.*.after`: coarse composition stages for runtime foundations, storage, workspace, artifact, settings, model, asset, image-generation, and Electron IPC wiring.
- `desktop.window.*`: BrowserWindow construction, load, and show timing.
- `renderer.workspace-provider.*`: active workspace provider load success or failure.
- `renderer.page.active.changed`: active desktop page changes with `activePage`, `visibleActivePage`, and workspace status.

## Comparing development and packaged memory

Electron Forge and Webpack development processes can inflate apparent memory usage. Capture a dev baseline with `DESKTOP_MEMORY_DIAGNOSTICS=1 npm run dev:desktop`, then compare with a packaged app run with the same environment flag. Focus on deltas between adjacent milestones in the same run first, then compare the same milestone pairs across dev and packaged runs.

## Using the logs for lazy-loading work

Before changing host composition, save the ordered snapshot logs as a baseline. After future lazy-loading or host-splitting changes, collect the same startup path and compare memory deltas around host composition, IPC registration, BrowserWindow load/show, workspace loading, and page changes. The diagnostics are intentionally gated, local-only, and do not poll or retain snapshot history.

## Prompt 2 startup composition contract

Prompt 2 changes desktop startup so host composition and IPC registration build only the Tier 0/Tier 1 shell: Electron bootstrap, logging, memory diagnostics, Hugging Face token status/config, local settings/secrets, minimal workspace list/create/active-selection persistence, lazy IPC handlers, and cheap runtime readiness/status shells. Startup diagnostics should include:

- `desktop.host.compose.before` / `desktop.host.compose.after`
- `desktop.host.startup-workspace-shell.compose.before` / `desktop.host.startup-workspace-shell.compose.after`
- `desktop.host.ipc-registration.lazy-handlers.before` / `desktop.host.ipc-registration.lazy-handlers.after`
- `desktop.ipc.register.before` / `desktop.ipc.register.after`

The following feature milestones should **not** appear during initial startup or IPC registration. They should appear only after the first matching IPC request:

- `desktop.host.artifact-features.compose.*` for artifact upload/browser/local artifact content requests.
- `desktop.host.asset-features.compose.*` for Asset Library or asset mutation requests.
- `desktop.host.model-features.compose.*` for model management requests.
- `desktop.host.image-generation-features.compose.*` for image generation requests.
- `desktop.host.ingestion-features.compose.*` for website ingestion requests.
- `desktop.host.dataset-preparation-features.compose.*` for dataset preparation requests.
- `desktop.host.artifact-remote-features.compose.*` for Hugging Face remote browse/publish/import/localize operations.
- `desktop.host.comfyui-install-features.compose.*` for ComfyUI install/status/repair requests, and `desktop.host.comfyui-image-runtime-features.compose.*` for ComfyUI-backed image runtime requests.
- `desktop.host.runtime-task-features.compose.*` for runtime-backed task execution paths.

To compare Prompt 1 and Prompt 2 memory deltas, collect the same startup path with `DESKTOP_MEMORY_DIAGNOSTICS=1 npm run dev:desktop` before and after the change. Compare adjacent deltas for `desktop.host.compose.before` → `desktop.host.compose.after`, `desktop.ipc.register.before` → `desktop.ipc.register.after`, and `desktop.host.ipc-registration.lazy-handlers.before` → `desktop.host.ipc-registration.lazy-handlers.after`. Prompt 2 should move most Tier 2/Tier 3 memory growth out of those startup pairs and into the first-request feature milestones.

A regression is likely if startup logs show any deferred feature milestone before the renderer makes the corresponding feature IPC request, or if `desktop.host.ipc-registration.lazy-handlers.*` is followed by Tier 2/Tier 3 composition milestones during registration. GPU probing, Python runtime startup/probing, ComfyUI startup, and power suspension blockers should remain absent from startup diagnostics and should occur only for explicit runtime actions that require them.

## Prompt 3 feature-module import laziness

Prompt 2 made many desktop feature constructors lazy, but constructor laziness alone did not guarantee that Electron main avoided loading those feature modules. Prompt 3 extends the startup contract so `composeDesktopHost.ts` keeps only the Tier 0/Tier 1 shell statically imported and dynamically imports explicit feature composers on first matching IPC use.

Dynamic import milestones use `desktop.host.<feature>.import.before` and `desktop.host.<feature>.import.after`. Feature object construction milestones use `desktop.host.<feature>.compose.before` and `desktop.host.<feature>.compose.after`. During initial startup, workspace shell registration, settings/token calls, runtime readiness reads, and IPC handler registration, these deferred import/compose milestones should be absent for artifact, artifact-remote/Hugging Face, asset, model, image-generation, ComfyUI, ingestion, dataset-preparation, runtime-task, and Python runtime foundation features.

The following should appear only after the first feature request:

- `desktop.host.artifact-features.import.*` / `desktop.host.artifact-features.compose.*` for artifact browser/upload/content operations.
- `desktop.host.artifact-remote-features.import.*` / `desktop.host.artifact-remote-features.compose.*` for Hugging Face artifact remote operations.
- `desktop.host.asset-features.import.*` / `desktop.host.asset-features.compose.*` for asset registry and mutation operations.
- `desktop.host.model-features.import.*` / `desktop.host.model-features.compose.*` for model management operations.
- `desktop.host.image-generation-features.import.*` / `desktop.host.image-generation-features.compose.*` for image generation operations.
- `desktop.host.comfyui-install-features.import.*` / `desktop.host.comfyui-install-features.compose.*` for ComfyUI install/status/repair operations.
- `desktop.host.comfyui-image-runtime-features.import.*` / `desktop.host.comfyui-image-runtime-features.compose.*` for ComfyUI-backed generation operations.
- `desktop.host.ingestion-features.import.*` / `desktop.host.ingestion-features.compose.*` for website ingestion operations.
- `desktop.host.dataset-preparation-features.import.*` / `desktop.host.dataset-preparation-features.compose.*` for dataset preparation operations.
- `desktop.host.runtime-task-features.import.*` / `desktop.host.runtime-task-features.compose.*` for runtime-backed task execution.
- `desktop.host.python-runtime-foundation.import.*` / `desktop.host.python-runtime-foundation.compose.*` for explicit Python runtime control or runtime-task paths.

A startup regression is likely if any deferred feature import or compose milestone appears before the renderer invokes that feature's IPC channel. A source-boundary regression is likely if `modules/hosts/desktop/composition/composeDesktopHost.ts` regains static imports of deferred implementation modules such as filesystem artifact storage, Hugging Face artifact/model adapters, model use cases, image-generation use cases, ComfyUI runtime/installer adapters, asset resource-backed view composition, website ingestion, dataset preparation, Python task registry, or power lifecycle implementations. ComfyUI install-root resolution, GPU detection (`nvidia-smi`), Python start/probe/task activity, and ComfyUI start/probe activity should remain absent from startup and registration diagnostics.

## Prompt 4 feature-group IPC registration

Prompt 4 splits Electron IPC channel registration into explicit feature-group boundaries while keeping renderer-facing preload methods, IPC channel names, and request/response envelopes stable. Startup may now show registration-only milestones for each group:

- `desktop.host.ipc.startup-group.register.*`
- `desktop.host.ipc.artifact-group.register.*`
- `desktop.host.ipc.asset-group.register.*`
- `desktop.host.ipc.model-group.register.*`
- `desktop.host.ipc.image-generation-group.register.*`
- `desktop.host.ipc.runtime-group.register.*`
- `desktop.host.ipc.ingestion-group.register.*`
- `desktop.host.ipc.dataset-preparation-group.register.*`

Those milestones mean only that IPC handlers were attached to Electron. They should appear between `desktop.host.ipc-registration.lazy-handlers.before` and `desktop.host.ipc-registration.lazy-handlers.after` during startup. They must not be accompanied by deferred feature import or composition milestones during registration.

Use Prompt 3 import/compose milestones to distinguish handler registration from provider resolution. During startup, the logs should still omit deferred milestones such as `desktop.host.model-features.import.*`, `desktop.host.model-features.compose.*`, `desktop.host.artifact-features.import.*`, `desktop.host.artifact-remote-features.import.*`, `desktop.host.asset-features.import.*`, `desktop.host.image-generation-features.import.*`, `desktop.host.comfyui-install-features.import.*`, `desktop.host.comfyui-image-runtime-features.import.*`, `desktop.host.ingestion-features.import.*`, `desktop.host.dataset-preparation-features.import.*`, `desktop.host.runtime-task-features.import.*`, and `desktop.host.python-runtime-foundation.import.*`.

To diagnose accidental provider resolution during registration, collect a startup baseline and inspect the log segment from `desktop.host.ipc-registration.lazy-handlers.before` through `desktop.host.ipc-registration.lazy-handlers.after`. That segment should contain the feature-group `register.before`/`register.after` pairs only. If a deferred `<feature>.import.*` or `<feature>.compose.*` milestone appears in the same segment, a registration function probably called a lazy provider while attaching handlers.

To compare Prompt 3 and Prompt 4 diagnostics, use the same command before and after the split:

```bash
DESKTOP_MEMORY_DIAGNOSTICS=1 npm run dev:desktop
```

Prompt 4 should add finer-grained IPC registration pairs without moving feature import/compose milestones earlier. Model, artifact, asset, image-generation, ComfyUI, ingestion, dataset-preparation, artifact-remote/Hugging Face, runtime-task, and Python runtime foundation milestones should appear only after the first corresponding feature request, not during startup or channel registration.

## Cleanup checkpoint: refined lazy feature boundaries

The desktop main-process lazy boundary now separates ComfyUI install/status work from the ComfyUI image runtime. A first install/status or repair request should import and compose only `desktop.host.comfyui-install-features.*`; it should not import or compose `desktop.host.comfyui-image-runtime-features.*`, create the ComfyUI HTTP client, create the image-generation runtime adapter, start ComfyUI, or run GPU detection. The install root is resolved inside the install feature when the install/status/repair request is handled, not during startup or IPC registration.

ComfyUI image generation and runtime-backed task paths use the separate image runtime feature. Those paths may show `desktop.host.comfyui-image-runtime-features.import.before/after` and `desktop.host.comfyui-image-runtime-features.compose.before/after` on first use. GPU/device resolution is still deferred until an explicit ComfyUI runtime start/action path needs it, so install-status reads should not run `nvidia-smi` or equivalent detection.

Python runtime helper functions used by startup status reads live in a lightweight helper module, separate from Python runtime feature composition. Startup status reads may produce unavailable Python status without importing the Python runtime foundation. `desktop.host.python-runtime-foundation.import.*` and `desktop.host.python-runtime-foundation.compose.*` should appear only after explicit Python runtime control or runtime-task requests.

Feature-group IPC registration uses narrow typed lazy providers. Registration should attach handlers only; it should not resolve model, artifact, asset, image-generation, ComfyUI install, ComfyUI image runtime, ingestion, dataset-preparation, runtime-task, or Python runtime providers. In diagnostics, the IPC group `register.before`/`register.after` pairs should still appear during startup without adjacent deferred feature import/compose milestones.

Runtime task power lifecycle is task-action lazy. Composing `desktop.host.runtime-task-features.*` should not create the real Electron power suspension blocker. The first task lifecycle action that starts, stops, or lists a blocker may show `desktop.host.power-blocker.compose.before` and `desktop.host.power-blocker.compose.after`.

For a baseline comparison, run:

```bash
DESKTOP_MEMORY_DIAGNOSTICS=1 npm run dev:desktop
```

Expected milestone split:

- Startup: base host, logging, token/settings, startup workspace shell, and IPC group registration milestones only.
- First ComfyUI install/status request: `desktop.host.comfyui-install-features.import.*` and `desktop.host.comfyui-install-features.compose.*` only.
- First ComfyUI-backed image generation/runtime action: `desktop.host.comfyui-image-runtime-features.import.*` and `desktop.host.comfyui-image-runtime-features.compose.*` along with the relevant image/runtime-task feature milestones.
- First Python runtime control or Python-backed runtime task: `desktop.host.python-runtime-foundation.import.*` and `desktop.host.python-runtime-foundation.compose.*`.
- First task power lifecycle action: `desktop.host.power-blocker.compose.*`.

## Prompt 5 renderer route-level page code splitting

Prompt 5 moves desktop renderer page implementation modules behind route-level React lazy imports. The app shell, navigation metadata, active workspace provider, workspace gate, route boundary helper, and lightweight diagnostics helper remain part of the startup-loaded renderer path. Page implementation modules for Home, Data/Artifacts, Asset Library, Models, Image Generation, Settings, and Systems are requested only when their route is rendered.

Renderer page lazy-load diagnostics are gated by `DESKTOP_MEMORY_DIAGNOSTICS=1` and emit these milestones:

- `renderer.page.lazy-load.start`: a lazy page module request has started.
- `renderer.page.lazy-load.resolved`: the lazy page module resolved and can render.
- `renderer.page.lazy-load.failed`: the lazy page module request rejected.
- `renderer.page.lazy-render.fallback`: the content-area page loading fallback rendered while a lazy page is pending.

The lazy-load details intentionally stay small: active page key, visible active page when known, workspace status, and whether the route requires a workspace; the same route context is attached to start, resolved, failed, and fallback milestones when available. Workspace-required routes still pass through the existing route boundary and workspace gate before rendering the lazy page component, so a blocked route can show the workspace-required surface without importing the feature page implementation.

Lazy page import is not a backend feature composition signal. Backend feature composition should still occur only when the page's mounted components make their existing preload/IPC requests, not when the renderer registers a lazy page loader or resolves a page module.

To compare Prompt 5 behavior, collect a before/after renderer startup baseline with:

```bash
DESKTOP_MEMORY_DIAGNOSTICS=1 npm run dev:desktop
```

On initial startup, expect `renderer.app.mounted`, `renderer.page.active.changed`, and lazy-load milestones only for the active page. Navigating to Models should add lazy-load milestones for Models but not Image Generation; navigating to Data/Artifacts should not load Models unless the user opens Models. Main-process deferred feature compose/import milestones should remain tied to the first feature IPC request rather than to renderer lazy page import.

## Prompt 6 page-section loading diagnostics

Route-level lazy loading and page-section loading are separate checks. A route import should make only the page shell available; expensive panels inside that page should emit their own section milestones when they actually load data. With `DESKTOP_MEMORY_DIAGNOSTICS=1`, section boundaries log `renderer.section.load.start`, `renderer.section.load.resolved`, `renderer.section.load.failed`, `renderer.section.load.skipped`, and `renderer.section.load.retry` with small details such as `pageKey`, `sectionKey`, `trigger`, `activePage`, and workspace status when available. Cleanup of local-only async work records `renderer.section.request.ignored-after-unmount`; this means the renderer ignored a stale result after unmount and does not claim transport-level request cancellation.

Section ownership uses four classifications:

- **Initial:** primary local data intentionally loads on page open, such as local model inventory, artifact browser lists when the browser tab is selected, asset definitions, image-generation model choices, and image artifact choices.
- **Deferred:** data loads only after expansion, tab selection, selection, search, or refresh, such as Hugging Face browse/search, model details, artifact detail/content/media, website scraping controls, Hugging Face artifact import/publish/localize panels, resource-backed asset views, runtime readiness, Python footer status, and ComfyUI install status.
- **User-action:** mutating or runtime work runs only from explicit submit/start/download/publish/validate/repair controls.
- **Intentionally eager and cheap:** settings definitions for Hugging Face and Models are local settings reads and may render immediately; runtime, dataset, publishing, and advanced settings remain collapsed/deferred.

Use these milestones to confirm that the page title, description, and local layout render before expensive sections resolve. Backend feature composition should still happen only after the section makes the relevant preload/IPC request; route import or page shell render alone should not compose Python, ComfyUI, GPU detection, Hugging Face browse, training, validation, publish, or remote artifact features.

A regression usually appears as a burst of section start milestones for every remote/runtime panel immediately after opening a page, followed by matching backend compose milestones before the user expands, searches, selects an item, refreshes runtime status, or starts an explicit action. Expected behavior is narrower: initial sections may load on page open only when they are the primary local content listed above, while remote browse, runtime readiness, artifact detail/media, resource-backed views, training, validation, publish, install, repair, and generation milestones appear only for the visible or user-triggered section.

Collect a Prompt 6 comparison baseline with:

```bash
DESKTOP_MEMORY_DIAGNOSTICS=1 npm run dev:desktop
```

In that baseline, initial renderer startup should show app/page route milestones, opening a page should reveal the shell promptly, and section milestones should appear only for sections that load because they are initial, expanded, selected, searched, refreshed, or explicitly actioned. Remote/runtime section milestones should not appear merely because the route module imported; backend compose milestones should line up with section-triggered IPC requests.

## Prompt 7 safe feature lifecycle and disposal policy

Prompt 7 adds conservative lifecycle handling for host-owned lazy features and renderer-owned preview resources. Disposal is intentionally scoped: it releases memoized feature objects, subscriptions, temporary caches, and renderer object URLs when safe, but it does **not** delete persisted artifacts, model records, settings, workspace data, or local files.

Lifecycle policy groups:

- **Always resident:** logging, memory diagnostics helpers, Hugging Face token status/config storage, local application settings and secrets adapters, workspace list/create/selection shell, minimal IPC registration shell, and cheap runtime-readiness shell.
- **Lazy retained/warm:** local workspace shell, basic settings use cases, local artifact storage foundations that do not hold large content buffers, local model registry records, asset definitions registry, and lightweight ComfyUI install status helpers.
- **Lazy disposable:** Hugging Face artifact-remote browse/publish/import/localize objects, website-ingestion objects, dataset-preparation objects when no dataset-preparation task is active, and image-generation host objects when no image-generation task is active. Renderer pages also clean up generated image preview object URLs, artifact preview object URLs, large preview blobs, section timers, and local-only async updates on unmount.
- **Explicit user-action unload only:** the Python process, loaded Python model weights, ComfyUI process/runtime state, runtime task registries with active work, model training/validation/publishing task state, and generated model training state. Ordinary page navigation and idle disposal do not stop Python or ComfyUI and do not unload Python model weights.

Host disposal is best-effort and idempotent. A disposable feature's memoized instance is cleared after disposal, so the next IPC request recreates the feature through the same lazy provider. Disposal failures are logged and also clear the memoized failed instance so later requests can recover. Active runtime tasks block unsafe dataset-preparation and image-generation disposal. Disposable IPC-backed features are marked idle after their feature method returns, which schedules one scoped timeout for that feature; later reuse cancels and resets that timeout rather than relying on polling.

Lifecycle diagnostics remain gated by `DESKTOP_MEMORY_DIAGNOSTICS=1`. Relevant milestones include:

- `desktop.host.feature.dispose.requested`
- `desktop.host.feature.dispose.started`
- `desktop.host.feature.dispose.completed`
- `desktop.host.feature.dispose.failed`
- `desktop.host.feature.dispose.blocked`
- `desktop.host.feature.idle.marked`
- `desktop.host.feature.idle.cancelled`
- `desktop.host.feature.memoized.cleared`
- `renderer.section.cleanup.started`
- `renderer.section.cleanup.completed`
- `renderer.preview.object-url.revoked`
- `renderer.section.request.ignored-after-unmount`

To detect early-work regressions, start the app with diagnostics enabled and open each page shell without expanding optional sections or pressing action buttons. Opening Models must not emit Hugging Face browse, training, validation, or publish IPC milestones. Opening Image Generation must not start Python, start ComfyUI, run GPU detection, or read runtime readiness. Opening Systems must not read builder-application, Python, ComfyUI, or host lifecycle status. Opening Settings must not read runtime status or browse remote Hugging Face data; expanding Software status still defers individual runtime reads until their nested section is opened.

To verify release behavior, start the desktop app with diagnostics enabled, open a feature page that loads a disposable feature, navigate away or trigger developer lifecycle disposal, confirm the lifecycle milestones above, then return to the feature page and confirm the feature composes again and remains functional. Blocked disposal should include `blockedReason` and `activeTaskCount` when a runtime task guard can report it. Python and ComfyUI should remain running unless the user uses the existing explicit stop/unload controls; generic feature disposal must not stop them because process/runtime features are explicit-unload-only.

```bash
DESKTOP_MEMORY_DIAGNOSTICS=1 npm run dev:desktop
```

## How to verify load-size invariants

Baseline command:

```bash
DESKTOP_MEMORY_DIAGNOSTICS=1 npm run dev:desktop
```

Expected startup milestones include the Electron bootstrap, desktop host composition, startup workspace shell composition, IPC group `register.before`/`register.after` pairs, lazy handler registration, BrowserWindow load/show, renderer shell activation, workspace provider reads, and the active route lazy-load milestones.

Deferred feature import/compose milestones must **not** appear at startup. In particular, startup and IPC registration should not log model, artifact-remote, asset resource-backed, image-generation, ComfyUI image-runtime, runtime-task, Python runtime foundation, Hugging Face remote, website-ingestion, dataset-preparation, training, validation, publishing, or power-blocker composition milestones. Feature-group IPC registration attaches channel handlers only; it must not resolve lazy feature providers, resolve the ComfyUI install root, start Python/ComfyUI, or run GPU detection.

Renderer route lazy-load milestones should appear only for the active page. `renderer.page.lazy-load.start` and `renderer.page.lazy-load.resolved` identify the page module being requested. Workspace-blocked routes should show the workspace gate/fallback and should not show the blocked page module's lazy-load milestone.

Section load milestones use `renderer.section.load.*` and include `pageKey`, `sectionKey`, and `trigger`. Treat `initial` as intentional page-open work, `expanded`/`deferred` as work delayed behind UI disclosure, `selected-item` as selection-driven work, `search-triggered` as remote search work, `refresh` as explicit refresh work, `user-action` as command work, and `task-driven` as work following a user-created task. Cleanup diagnostics use `renderer.section.request.ignored-after-unmount` because current section loaders ignore late results after unmount rather than aborting with an `AbortController`.

Lifecycle milestones include `desktop.host.feature.idle.marked`, `desktop.host.feature.idle.cancelled`, `desktop.host.feature.dispose.requested`, `desktop.host.feature.dispose.started`, `desktop.host.feature.dispose.blocked`, `desktop.host.feature.memoized.cleared`, and `desktop.host.feature.dispose.completed`. Generic lifecycle disposal may only dispose idle `disposable` features. It must not stop Python, stop ComfyUI, cancel active runtime tasks, or delete persisted artifacts, models, settings, workspace records, or files.

Electron Forge and Webpack development processes can inflate total memory. Compare adjacent milestones inside one dev run first. To compare development mode against a packaged app, run both with `DESKTOP_MEMORY_DIAGNOSTICS=1`, follow the same manual route/section sequence, and compare the same milestone pairs rather than total operating-system process trees.

If opening a page triggers runtime or remote operations too early, check for the first unexpected milestone or IPC call. A Models page regression usually appears as Hugging Face browse/train/validate/publish calls before search or action. An Artifacts regression appears as website ingestion or remote artifact import/publish/localize before expansion/search/action. An Image Generation or Settings / Software status regression appears as Python start/status, ComfyUI start/deep runtime status, or GPU detection before explicit expansion, refresh, or start/generate actions. A Systems regression appears if opening the builder shell performs any operational software-status read.
