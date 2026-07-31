# ADR-0020: Asset Composition Planning

- Status: accepted
- Date: 2026-05-20

## Context

effective asset projections established workspace-scoped effective asset projection records/summaries with planning-oriented readiness, diagnostics, blockers, safe projected fields, and provenance. The next step is to plan safe combinations of those projections without executing workflows or binding runtime providers.

Without a dedicated planning layer, composition concerns drift into authoring, resolver, or runtime surfaces, which blurs boundaries and increases mutation/execution risk.

## Decision

asset composition planning introduces workspace-scoped asset composition plans that organize effective asset projections effective asset projections into planning nodes and relationships. These plans validate compatibility and identify blockers but do not execute workflows, bind runtime providers, mutate source assets, or generate executable payloads.

## Accepted asset composition planning boundaries

asset composition planning is planning-only, reference-oriented, workspace-scoped, and non-runtime. It owns plan modeling, role/relationship semantics, compatibility diagnostics, and readiness-output data.

asset composition planning excludes runtime execution, provider binding, visual-canvas execution semantics, and source mutation.

## Composition plan ownership and workspace scope

- Composition plans are owned by a target workspace.
- Selected projections must resolve within that workspace.
- Cross-workspace links remain represented only through existing provenance/source summaries from User Library reuse/8/9; no live sync links are created.

## Depend on effective asset projections projections

asset composition planning depends on effective asset projections projections as the canonical planning input surface:

- projection identity/scope/source kind;
- projection status/readiness/consumability;
- safe projected fields;
- diagnostics/blockers;
- provenance summaries.

asset composition planning must not bypass these summaries by directly reconstructing projection logic from raw authored/customization internals.

## Keep composition planning non-runtime

A `valid` composition plan means non-runtime planning validity only. It never implies executable state, runtime availability, or provider readiness.

## Defer visual canvas and workflow execution

asset composition planning may later support UI representations, but this ADR explicitly defers:

- visual canvas-first authoring behavior,
- executable workflow graph semantics,
- runtime task execution semantics.

## Consequences

Positive:

- Clear separation between planning and execution.
- Safe dependence on projection summaries rather than raw source mutation.
- Deterministic blocker/diagnostic model before runtime binding.

Tradeoffs:

- Additional phase boundary and compatibility vocabulary to maintain.
- Runtime readiness remains deferred to runtime readiness binding.

## Explicit non-goals

asset composition planning does not implement workflow/runtime/model execution, ComfyUI execution, arbitrary graph editing, prompt editing, workflow JSON editing, materialized executable payload generation, conflict auto-rebase/resolution, background propagation, live workspace-to-workspace sync, collaboration permissions, pack import/export, marketplace behavior, or mutation/copy of `system.foundation`.

## Relationship to effective asset projections

effective asset projections provides projection readiness for planning, not runtime execution. asset composition planning consumes this readiness as an input and adds composition-level compatibility semantics.

If required projection summaries are missing or stale, asset composition planning reports diagnostics/blockers instead of bypassing effective asset projections.

## Relationship To Runtime Readiness Binding

asset composition planning outputs validated composition-plan structures suitable for runtime readiness binding.

runtime readiness binding can evaluate runtime/provider/model/storage/API/dependency/environment capability availability against required capabilities from validated plans, still without requiring immediate workflow execution.


## Asset composition planning UI status

- Composition planning is exposed inside the **Assets** area as a `Plans` tab, not as a separate top-level page.
- The asset composition planning UI is structured form/list planning (plans, assets in plan, connections, check plan), not visual canvas authoring.
- `valid` means **Ready for planning** only; it does not mean runtime-ready or execution-ready.
- Runtime-readiness binding and workflow/runtime/model execution remain separate responsibilities.
- API/IPC/preload/client exposure is the boundary used by UI operations; unsupported operations must render as unavailable in UI.

## UI status note

asset composition planning owns Assets-embedded Plans tab behavior only. The UI reads plan summaries/details via asset composition planning read-model endpoints and refreshes those read models after supported mutations. Runtime readiness and execution concerns remain separate runtime-readiness and execution responsibilities.
