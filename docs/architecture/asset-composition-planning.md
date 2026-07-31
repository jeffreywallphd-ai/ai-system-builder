# Asset Composition Planning

- Status: current
- Related decisions: `docs/adr/ADR-0020-asset-composition-planning.md`
- Verification: `docs/architecture/architecture-verification.md`

## Purpose

Asset composition planning is a workspace-scoped, non-runtime planning layer.

Architecture thesis: workspace-scoped composition plans reference safe effective asset projections, organize selected projections into roles and relationships, validate compatibility, and identify blockers before any runtime binding or workflow execution occurs.

This layer answers: _Which effective assets can be combined, in what planning roles and relationships, to form a valid system/workflow plan?_ It does **not** execute workflows.

## Scope and boundaries

Asset composition planning is:

- a planning layer;
- workspace-scoped;
- reference-oriented (projection references, not raw authored payloads);
- non-runtime;
- non-executing;
- dependent on effective asset projection summaries, statuses, blockers, and diagnostics;
- preparatory for runtime readiness binding.

Asset composition planning is not visual-canvas-first authoring, runtime execution, or workflow materialization.

## Vocabulary

- **Asset composition plan / Composition plan**: workspace-owned planning record that organizes selected effective asset projections into nodes and relationships, plus compatibility/readiness outcomes.
- **Composition node**: a plan-local role assignment for one selected projection.
- **Composition relationship**: a plan-local planning connection between nodes.
- **Selected projection**: an effective asset projection chosen for planning.
- **Projection reference**: stable reference to an effective asset projection record.
- **Composition role**: plan-level role assigned to a node.
- **Relationship kind**: plan-level relationship category used for compatibility checks.
- **Compatibility check**: deterministic plan-time validation against workspace scope, projection status, role compatibility, and relationship rules.
- **Compatibility status**: outcome of compatibility checks for a plan, node, or relationship.
- **Composition blocker**: issue that prevents a plan from being valid for runtime-readiness analysis.
- **Composition diagnostic**: safe explanation/warning/error used by operators and UI.
- **Composition readiness**: planning-only readiness state; not runtime readiness.
- **Planning-ready**: plan/projection state sufficient for planning checks.
- **Planning-blocked**: plan/projection state that blocks planning progress.
- **Missing dependency**: required node/relationship/capability reference is absent.
- **Required capability**: capability needed by node/relationship during planning analysis.
- **Provided capability**: capability advertised by selected projections/nodes.
- **Composition provenance**: source and update lineage for plan creation/refresh actions.
- **Plan validation**: compatibility check execution and status/diagnostic updates.
- **Plan refresh**: re-check against latest projection summaries/statuses.
- **Plan snapshot**: optional immutable read view of a plan at a point in time.
- **Runtime-readiness output**: constrained output passed to runtime readiness binding for capability analysis.
- **Execution deferred**: explicit marker that workflow/runtime/model execution is out of scope.

User-facing labels should stay simpler, such as "Plan", "Assets in this plan", "Role", "Connection", "Ready for planning", "Needs attention", and "Missing requirement".

## Conceptual model

Composition planning records are planning metadata only. They must not carry executable payloads, runtime/provider command payloads, prompt text, workflow JSON, bytes/base64, paths, or secrets.

### Composition Plan

- composition plan ID;
- target workspace ID;
- name;
- description;
- status;
- selected projection references;
- composition nodes;
- composition relationships;
- compatibility diagnostics;
- blockers;
- readiness summary;
- provenance;
- created/updated timestamps.

### Composition Node

- node ID;
- projection ID;
- effective asset reference;
- role;
- status;
- required inputs/capabilities;
- provided outputs/capabilities;
- diagnostics.

### Composition Relationship

- relationship ID;
- source node ID;
- target node ID;
- relationship kind;
- compatibility status;
- diagnostics.

## Plan status baseline

Conservative plan statuses:

- `draft`
- `valid`
- `blocked`
- `conflicted`
- `stale`
- `unsupported`
- `invalid`
- `archived`

Status semantics:

- `valid` means valid as a non-runtime composition plan only.
- `valid` does **not** imply executable.
- `valid` does **not** imply runtime-ready.
- `blocked` means the plan cannot safely proceed to runtime-readiness analysis.
- `stale` means projection summaries/statuses changed and plan refresh is required.
- `archived` means inactive historical plan.

## Initial composition role vocabulary

- `input`
- `data-source`
- `processor`
- `model`
- `prompt-template`
- `configuration`
- `output`
- `ui-surface`
- `runtime-capability-placeholder`
- `supporting-asset`

These are intentionally modest planning roles, not a full workflow language. Later canonical execution slices may refine role taxonomies based on concrete vertical slices.

## Initial relationship kinds

- `depends-on`
- `feeds-into`
- `configures`
- `uses-model`
- `uses-data`
- `produces-output`
- `requires-capability`
- `supports`

These are planning relationships only and are not executable graph edges.

## Compatibility model baseline

Plan validation should check, at minimum:

1. selected projections belong to the target workspace;
2. selected projections exist;
3. selected projections are planning-consumable/ready for planning;
4. blocked projections block the plan;
5. conflicted projections block the plan;
6. stale projections require refresh before `valid`;
7. draft-only projections are excluded from normal planning unless draft planning is explicitly allowed;
8. disabled projections cannot be active nodes;
9. missing source projections block the plan;
10. unsupported projections block the plan;
11. node role is compatible with projection source kind/shape;
12. required inputs/capabilities are satisfied where known;
13. provided outputs/capabilities are not contradictory where known;
14. relationship kinds are allowed for selected roles;
15. plan structure does not imply source mutation;
16. plan structure does not imply workflow/runtime execution.

Checks must output safe diagnostics and explicit blockers.

## Dependency on effective asset projections

Asset composition planning depends on workspace-scoped effective projection summaries and statuses.

Composition planning may read:

- projection IDs;
- workspace IDs;
- effective asset references;
- source kinds;
- statuses;
- policies;
- safe projected fields;
- diagnostics;
- blockers;
- provenance summaries;
- readiness/consumability flags.

Composition planning must not:

- bypass projection summaries to inspect raw authored/customization internals when summaries exist;
- reconstruct projection logic;
- mutate user-library or system foundation records;
- treat projection `ready` as runtime-ready;
- hide missing projections by direct source fallbacks.

If a required summary is missing, composition planning emits planning diagnostics/blockers rather than bypass logic.

## Relationships to source layers

Asset authoring/customization:

- Composition planning may compose projections derived from authored/customized assets.
- Composition planning does not author or edit those assets.
- If edits are needed, user flow returns to Assets authoring/customization surfaces.

User Library reuse:

- Composition planning may compose projections derived from linked assets, detached copies, or workspace imports.
- Composition planning must not mutate user-library sources, create live workspace-to-workspace links, or silently propagate source changes.
- Composition planning does not perform marketplace or import/export behavior.

Asset Kernel:

- Composition planning consumes effective asset references and safe projected fields.
- Composition planning does not write kernel definitions, mutate system foundation assets, copy `system.foundation@1.0.0`, or generate executable payloads.
- Composition nodes are planning wrappers, not new kernel definitions.

## Implemented and deferred scope

Implemented scope:

- planning vocabulary and contracts for composition plans/nodes/relationships;
- workspace-scoped plan creation/read/list/archive;
- node selection from effective projections;
- planning relationship modeling;
- compatibility/readiness diagnostics;
- read-model/transport/UI baseline for planning workflows.

Deferred scope:

- workflow/runtime/model execution;
- runtime/provider binding and capability activation;
- visual canvas-first authoring;
- arbitrary graph editors;
- prompt/workflow JSON editing;
- materialized executable workflow payload generation;
- conflict rebase/resolution automation;
- live cross-workspace synchronization;
- collaboration permissions;
- pack import/export and marketplace behavior;
- source mutation (authoring/library/system foundation).

## Runtime Readiness Output

Asset composition planning outputs validated planning structure. Runtime readiness binding determines whether runtime capabilities/providers are actually available, including installed runtimes, model/provider/storage/API/dependency/environment readiness, and capability mapping.

Conceptual output shape:

```ts
ValidatedCompositionPlan {
  planId
  workspaceId
  selectedProjectionRefs[]
  nodes[]
  relationships[]
  compatibilityStatus
  blockers[]
  requiredRuntimeCapabilities[]
  unsupportedRuntimeCapabilities[]
}
```

Runtime readiness binding remains non-executing unless a later canonical execution boundary introduces execution semantics.

## Non-goals

Asset composition planning does not implement workflow execution, runtime execution, ComfyUI execution, model execution, visual canvas authoring, arbitrary graph editing, prompt/workflow JSON editing, materialized workflow payload generation, conflict rebase/resolution, background propagation, live workspace linking/sync, collaboration permissions, pack import/export, marketplace behavior, or mutation/copy of `system.foundation`.

## UI placement

- General composition planning remains exposed inside the **Assets** area as a `Plans` tab.
- The top-level **Systems** area owns future system-specific assembly and System Builder record management. It may consume or reference validated composition plans, but it must not fork the plan or Asset Kernel models.
- The UI is structured form/list planning (plans, assets in plan, connections, check plan), not visual canvas authoring.
- `valid` means **ready for planning** only; it does not mean runtime-ready or execution-ready.
- Runtime-readiness binding and workflow/runtime/model execution remain deferred.
- API/IPC/preload/client exposure is the boundary used by UI operations; unsupported operations must render as unavailable in UI.
- Plans list/detail UI consumes safe read-model responses (`summaries`, `summary`, `nodes`, `relationships`, `diagnostics`, `blockers`).
- User-facing UI does not present Effective Asset Projection terminology as a primary concept.
