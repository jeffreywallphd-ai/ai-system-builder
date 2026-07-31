# Context Pack: Asset Composition Planning

- Pack name: `asset-composition-planning`

## Purpose

Define and constrain asset composition planning as a workspace-scoped, projection-referenced, non-runtime planning layer.

## Use When

Include this pack when work materially involves:

- composition plans;
- composition nodes/relationships;
- planning roles and relationship kinds;
- compatibility checks/statuses;
- composition blockers/diagnostics;
- projection selection for planning;
- planning readiness;
- runtime-readiness output preparation.

## Canonical docs/files to inspect

- `docs/architecture/asset-composition-planning.md`
- `docs/adr/ADR-0020-asset-composition-planning.md`
- `docs/architecture/effective-asset-projections.md`
- `docs/adr/ADR-0019-effective-asset-projections.md`

## Core constraints

- Composition planning is non-runtime and non-executing.
- Plans are workspace-scoped and projection-reference-oriented.
- Planning records must not contain executable payloads or unsafe raw data.
- `valid` means plan-valid, not runtime-ready and not executable.

## Anti-drift rules

- Do not bypass effective projection summaries when available.
- Do not mutate Asset Authoring/User Library/system foundation from planning surfaces.
- Do not describe asset composition planning as workflow execution or runtime binding.
- If projection data is missing/stale/unsupported, emit planning diagnostics/blockers.

## Relationship to Source Layers

- User Library reuse: composition may include projections originating from linked/copied/imported user-library sources; no live sync or source mutation.
- Asset authoring: composition may include projections derived from authored/customized assets; editing remains in authoring flows.
- Effective asset projections: composition planning consumes effective projection summaries/status/readiness/diagnostics as canonical planning inputs.

## Non-goals

No workflow/runtime/model execution, runtime/provider binding, visual-canvas-first authoring, arbitrary graph editing, prompt/workflow JSON editing, materialized workflow payload generation, collaboration permissions, pack import/export, marketplace behavior, live cross-workspace sync, or source mutation.

## Runtime Readiness Output

Asset composition planning prepares validated composition plan outputs for **Runtime Readiness Binding**, where required capabilities are matched against available runtime/provider/environment capabilities without implying immediate execution.

## UI Placement

- General composition planning remains inside **Assets / Plans**.
- **Systems** owns future system-specific assembly and System Builder records, reusing or referencing these plans rather than creating a parallel planner.
- The UI is structured form/list planning (plans, assets in plan, connections, check plan), not visual canvas authoring.
- `valid` means **Ready for planning** only; it does not mean runtime-ready or execution-ready.
- Runtime-readiness binding and workflow/runtime/model execution remain downstream.
- API/IPC/preload/client exposure is the boundary used by UI operations; unsupported operations must render as unavailable in UI.
- Keep planning inside the Assets area and avoid exposing projection internals as primary end-user jargon.
