# Effective Asset Projections (effective asset projections Baseline)

- Status: current
- Related decisions: `docs/adr/ADR-0019-effective-asset-projections.md`
- Verification: `docs/architecture/architecture-verification.md`

## Purpose and area placement

effective asset projections establishes a conservative architecture baseline for **materialized/effective asset projections**.

This area defines how the system can derive workspace-scoped, safe projection outputs from:

- system foundation assets,
- workspace-local assets,
- user-library linked assets,
- user-library detached copies,
- workspace-imported assets,
- workspace-authored assets and revisions,
- active overrides/customizations,
- and draft records only where explicitly allowed.

effective asset projections is **not** runtime/workflow execution. It is a safety-first projection layer that prepares metadata-oriented records for later composition planning and runtime-readiness areas.

## Canonical vocabulary

- **Effective asset projection**: A workspace-scoped, safe derived record that summarizes how an asset should be seen in that workspace after source selection and allowed customization rules.
- **Materialized projection**: A persisted or computed-on-demand projection snapshot produced by effective asset projections policies.
- **Projection source**: The origin record(s) used to derive a projection (system/workspace/user-library/authored/override inputs).
- **Projection target**: The workspace context where the projection is produced and consumed.
- **Projection input**: Safe source metadata and relationship state used to derive output.
- **Projection output**: The resulting projection record/snapshot.
- **Projection snapshot**: A point-in-time projection view.
- **Projection revision**: A projection version marker tied to source/revision lineage.
- **Projection status**: High-level lifecycle/status label (`ready`, `blocked`, etc.).
- **Projection diagnostic**: Sanitized explanation of non-happy-path states.
- **Projection blocker**: A reason the projection cannot be treated as ready.
- **Projection provenance**: Sanitized lineage of source identities/relationships used to produce projection output.
- **Projection source graph**: Structured summary of source relationships (base source, authored revision, override relationships) relevant to the projection.
- **Projection readiness**: Whether projection output is safe for later composition/runtime-readiness consumers.
- **Materialization policy**: Constrained policy describing which safe fields can be materialized.
- **Projection conflict**: Explicit mismatch/conflict state (for example base revision mismatch).
- **Projection invalidation**: Marker that a prior projection snapshot is outdated due to source/relationship changes.
- **Projection refresh**: Explicit recomputation/update of projection output after invalidation.
- **Projection cache**: Internal storage/read optimization for projection snapshots; never a source-of-truth replacement for source assets.
- **Safe projected fields**: Conservative allow-list of metadata fields permitted in projection output.
- **Non-projectable fields**: Deny-list/deferred field classes excluded from effective asset projections projection outputs.
- **Ready-for-planning projection**: Projection whose status/readiness indicates it is safe for *later* composition/runtime-readiness planning, not execution itself.
- **Planning-blocked projection**: Projection with blockers/diagnostics that prevent downstream readiness use.

## What an effective asset projection is

An effective asset projection is a **workspace-scoped derived view record** that captures the safe, user-visible effective state of an asset in a target workspace after applying allowed source-resolution and customization rules.

It is:

- derived from explicit source relationships,
- constrained by workspace isolation,
- sanitized for safe metadata exposure,
- explicit about conflicts/blockers,
- and suitable for later composition-planning consumption.

## What materialization means (and does not mean)

### Materialization means

In this system, materialization means creating or refreshing a safe projection snapshot that:

- requires explicit target workspace context,
- resolves to explicit source provenance,
- applies only active/valid customization contributions,
- emits conservative safe projected fields,
- records status/diagnostics/blockers,
- and supports invalidation/refresh semantics.

### Materialization does **not** mean

- workflow execution,
- runtime execution,
- automatic propagation execution,
- automatic conflict resolution/rebase,
- broad JSON merge behavior,
- source mutation,
- or unsafe payload materialization.

## Projection boundaries and relationships

### Projection vs source asset

Source assets are ownership-scoped records (system/workspace/user-library) that remain canonical sources of truth. Projections are derived workspace-effective views and must not mutate source records.

### Projection vs authored asset

Authored assets (and authored revisions/drafts) are authoring lifecycle inputs. Projections are derived outputs from those inputs under policy/status constraints.

### Projection vs override

Overrides/customizations are explicit change records. Projection outputs include only safe effects from active/valid overrides and explicitly surface conflicted/disabled/inactive conditions.

### Projection and Asset Registry read models

effective asset projections are complementary to Asset Registry read models:

- Registry read models expose asset-centric listings/details.
- Projection records expose workspace-effective, materialized readiness summaries for downstream planning.

### Projection and effective-source summaries

Effective-source summaries answer **where visibility came from**. Projections answer **what safe effective output is available now**, with status/readiness/diagnostics and policy context.

### Projection and future runtime readiness

runtime readiness binding should consume validated asset composition planning composition plan outputs first, and only consult projection summaries as freshness context where safely exposed. See `docs/architecture/runtime-readiness-binding.md`.

`ready` projections indicate safe metadata availability for later areas; they do not imply execution has run or should run automatically.

## Ownership model and workspace scope

- Workspace isolation remains default.
- Projection create/read requires explicit workspace ID.
- Effective projections are workspace-scoped outputs.
- System-owned assets remain system-owned.
- `system.foundation@1.0.0` must never be mutated/copied as source definitions.
- Linked user-library sources must never be silently mutated.
- Detached copies/imports remain detached from source updates unless a later explicit workflow says otherwise.
- Overrides/customizations remain explicit and user-visible.
- Conflicted/disabled/archived/invalid overrides do not silently apply.
- No hidden propagation and no live workspace-to-workspace links.

### Source-kind ownership implications

- **System sources**: May project into a workspace-effective view, while source remains immutable/system-owned.
- **Workspace-local sources**: Project only into owning workspace scope.
- **User-library linked sources**: Project through link relationships without mutating user-library source.
- **User-library detached copies**: Project from workspace-owned detached copy, preserving provenance and not auto-following future source changes.
- **Workspace imports**: Project in target workspace only; source workspace is not mutated/live-linked.
- **Authored assets**: Published revisions may project as `ready` (if safe). Drafts are draft-only unless explicitly modeled as preview.
- **Overrides/customizations**: Active valid overrides may contribute safe fields only.

## Materialization model (conceptual record shape)

effective asset projections defines the architectural shape (not contracts yet). Conceptual projection records include:

- projection ID,
- target workspace ID,
- source asset reference,
- effective asset reference,
- source kind,
- authored asset ID (if applicable),
- draft ID (if applicable and explicitly draft-only),
- revision ID/version (if applicable),
- override ID (if applicable),
- source relationship ID (if applicable),
- projection status,
- materialization policy,
- safe projected fields,
- projection diagnostics,
- projection blockers,
- projection provenance,
- created/updated/materialized timestamps,
- invalidation marker (if applicable).

### Required exclusions (non-projectable by default)

Projections must not contain:

- raw file bytes/blobs/base64,
- raw local paths/storage roots,
- provider payloads,
- prompt text (until later explicit safe prompt schema),
- workflow JSON (until later explicit safe workflow schema),
- credentials/tokens,
- stack traces,
- command lines,
- environment values,
- signed URLs.

## Safe projected fields baseline

Initial conservative allow-list:

- display name,
- summary,
- description,
- tags/classification (where supported),
- safe metadata keys that pass asset authoring/customization sanitization,
- source labels,
- revision/version labels,
- safe diagnostics,
- readiness state.

Deferred/blocked by default:

- raw prompt text,
- workflow JSON,
- provider payloads,
- runtime execution settings,
- storage locations,
- binary/resource content,
- credentials/tokens,
- environment variables,
- arbitrary JSON blobs.

## Projection status model

Baseline status vocabulary:

- `ready`
- `draft-only`
- `blocked`
- `conflicted`
- `invalid`
- `source-missing`
- `unsupported`
- `stale`
- `disabled`

Rules:

- `ready` means safe for downstream planning/readiness consumers; it does not mean executed.
- `draft-only` is not ready for downstream planning.
- `conflicted` blocks automatic materialization.
- disabled overrides never silently apply.

## Materialization policy baseline

Allowed baseline policies:

- `summary-only`
- `safe-fields-only`
- `draft-preview-only`
- `execution-ready-metadata-only`
- `blocked`

No policy may imply full workflow payload generation, runtime execution, or arbitrary JSON merging.

## Conflict/blocking model

Minimum expected behavior:

1. Missing source => `source-missing`/blocked projection.
2. Conflicted override => `conflicted` projection; override not silently applied.
3. Disabled override => omitted effect or inactive diagnostic; not applied.
4. Unsupported field => blocked or partial projection with diagnostic.
5. Base revision mismatch => `conflicted` projection.
6. Unsafe projected field => blocked with sanitized diagnostic.
7. Missing target reader => unavailable/unsupported diagnostic.
8. Draft without published revision => `draft-only` or blocked by policy/context.

No automatic rebase. No automatic source update. No hidden conflict resolution.

## effective asset projections boundaries vs deferrals

### Implemented in effective asset projections prompt sequence (starting now)

- Architecture vocabulary and policy baseline.
- Projection status/policy/safety rules.
- Ownership, workspace scope, provenance, and conflict semantics.
- Context-routing and ADR alignment.

### Explicitly deferred

- Runtime/workflow execution.
- Collaboration and authorization model.
- Pack import/export and marketplace behavior.
- Live synchronization across workspaces.
- Broad arbitrary prompt/workflow/json editing.

## Relationship to asset authoring/customization prerequisites/limitations

Effective asset projections depends on asset authoring/customization constructs (authored assets, drafts, published revisions, overrides, customization targets, effective-source summaries, safe editable fields, provenance, conflict state, explicit workspace context).

Known asset authoring/customization limitations that effective asset projections must treat as prerequisites/deferrals where needed:

- override creation with safe target validation remains deferred,
- existing-authored-asset revision publishing remains deferred,
- guaranteed workspace-wide effective-summary availability may be unavailable/partial.

Effective asset projections must not assume these deferred capabilities are complete.

## Effective asset projections current status

### Implemented

- Contracts in `modules/contracts/effective-asset-projections` define projection IDs, source/target references, statuses, policies, diagnostics/blockers, provenance, command/result DTOs, normalization helpers, and safe metadata/label validation rules.
- Application ports and local JSON persistence adapters cover workspace-scoped projection repository behavior, list/read/find-by-reference reads, and blocked/conflicted/stale summaries.
- Use cases/services are implemented for authored projection create/refresh, override projection create/refresh, draft preview projection, validation, diagnostics/blocking, readiness/consumability checks, and conflict-blocking decisions.
- Read-model/facade integration exposes workspace-scoped projection list/detail/by-effective-reference reads and safe diagnostic/provenance summaries for consumers.
- Thin API routes, desktop IPC handlers, and preload methods expose read/create/refresh/preview projection operations with explicit workspace context and shared envelope behavior.
- Minimal desktop and thin-client UI surfaces expose projection readiness/status summaries, list/detail views, and refresh actions without runtime execution wording.
- Projection behavior remains metadata-oriented and safe-fields-only by default, with no source mutation and no `system.foundation` mutation/copy behavior.

### Intentionally deferred

- Runtime/workflow execution and any execution orchestration.
- Visual composition/canvas/wizard-first planning UX.
- Materialized workflow payload generation.
- Broad arbitrary JSON projection/editing.
- Prompt payload, provider payload, and binary/resource projection content.
- Conflict rebase/resolution workflows and automatic rebasing.
- Live workspace-to-workspace links or hidden propagation/refresh daemons.
- Collaboration/permissions, pack import/export, marketplace behavior.
- Advanced source/target selection UI beyond minimal readiness surfaces.
- Unsupported source kinds beyond authored-revision/draft-preview/override-safe flows.

### Operational constraints

- Every projection operation must carry an explicit workspace ID.
- No hidden/global fallback and no hidden/default workspace creation.
- Projection pipelines do not mutate sources.
- `system.foundation` remains immutable system-owned reference content.
- `ready` means projection-consumable for downstream planning, not executed.
- `draft-only` is not ready for planning consumption.
- `conflicted`/`blocked`/`disabled`/`stale` projections are never silently applied.
- Unsafe payload classes remain excluded from projected fields.

## UX surface guidance (effective asset projections correction)

Effective asset projections are internal read-model infrastructure. In normal product UX, users navigate to **Assets** and see projection-derived readiness/status as secondary metadata on asset cards/details. A separate top-level 'Effective Assets' page is not part of the primary navigation model.

Readiness language in user-facing surfaces must remain planning-oriented (for example, **Ready for planning**) and must not be presented as runtime or execution readiness.

## Relationship To Asset Composition Planning

Effective asset projections are readiness-for-planning inputs for asset composition planning (`docs/architecture/asset-composition-planning.md`, ADR-0020). Projection `ready` is not runtime-ready and does not imply execution capability.
