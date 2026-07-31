# ADR-0018: Asset Authoring, Customization, and Override Management Baseline

- Status: accepted
- Date: 2026-05-19

## Context

asset authoring/customization needs a conservative architecture baseline for user-facing asset authoring and safe customization that preserves:

- workspace foundations workspace isolation and explicit workspace context,
- User Library reuse user-library reuse semantics (promote/link/copy/import),
- immutable system-owned foundation behavior,
- explicit provenance and no hidden propagation.

User Library reuse current status leaves parts of promote/import UI behavior unavailable and keeps effective-source behavior conservative/minimal. asset authoring/customization must not assume unavailable User Library reuse surfaces are complete.

## Decision

asset authoring/customization introduces explicit workspace-scoped asset authoring and customization/override records. It does not mutate system-owned assets, does not silently mutate linked user-library sources, and does not introduce hidden propagation or live workspace-to-workspace synchronization.

## Accepted asset authoring/customization boundaries

This ADR records the baseline boundaries for asset authoring/customization. Current implementation status must be checked against `docs/architecture/asset-authoring-customization-and-overrides.md`, current code, and downstream context packs.

## Ownership and scope rules

- Workspace isolation remains default.
- Workspace authoring/editing requires explicit workspace ID.
- User Library scope remains separate from workspace scope and system foundation scope.
- `system.foundation@1.0.0` remains immutable/system-owned.
- Linked user-library customization cannot silently mutate source user-library assets.
- Detached copies/imported workspace copies are customized in target workspace only.
- No hidden propagation, no live workspace-to-workspace links.

## Override model decision

Adopt explicit durable workspace-scoped override records as the architecture baseline for non-destructive customization.

Override records conceptually include:

- override identity,
- target workspace,
- base asset reference/version/source kind,
- override scope/status,
- safe changed fields and safe patch summary,
- provenance, timestamps, actor/request context, and safe diagnostics.

Override records must exclude unsafe/sensitive internals (raw paths, blobs/base64, provider payloads, prompt/workflow internals by default, secrets/tokens, stack traces, command lines, environment values, signed URLs).

## Versioning/conflict baseline

- Draft vs published authored/customization states are explicit.
- Revisions are explicit; published revisions are immutable by default.
- Conflicts are detected and surfaced, never silently resolved.
- Pinned links do not auto-remap overrides.
- Explicit-update links require explicit update actions.
- Detached copies/imported copies do not auto-follow source changes.

## Consequences

Positive:

- Preserves workspace and ownership safety while enabling controlled customization.
- Provides clear vocabulary for contracts/use cases/transports/UI.
- Reduces accidental mutation/propagation risk.

Costs:

- Requires explicit conflict/resolution flows.
- Adds lifecycle/revision complexity for authored and override records.
- Defers high-risk editable fields until safe schema and test coverage exist.

## Explicit non-goals

This decision does not introduce:

- broad arbitrary field editing,
- prompt/workflow raw editing,
- runtime execution-linked editing behavior,
- collaboration permissions/multi-user authorization,
- pack import/export or marketplace behavior,
- hidden/default workspaces, startup seeding, or legacy/global auto-migration.

## Relationship to User Library reuse

asset authoring/customization depends on accepted User Library reuse constraints and implemented relationships (link vs copy, detached import semantics, provenance, explicit workspace context, effective-source summaries where available).

If User Library reuse truthfulness/composition checks regress, impacted asset authoring/customization work must mark those capabilities as prerequisites/deferrals and avoid building assumptions on unavailable behavior.

## Relationship To Effective Asset Projections

effective asset projections composition planning should consume asset authoring/customization authored/customized/override vocabulary as explicit inputs and should not bypass override safety, ownership isolation, or conflict visibility rules.

## Asset authoring/customization current status addendum

Current asset authoring/customization status confirms UI/client/docs truthfulness constraints:
- implemented: workspace draft lifecycle (create/update/publish-new), override listing, override disabling, and application/API/IPC create/update/disable override operations;
- conditional: user-facing create-override availability requires safe target selection and a real customization-target reader;
- deferred: existing-authored revision publishing and guaranteed workspace-wide effective-summary listing;
- out of scope: workflow execution, materialization, propagation, conflict rebase/resolution workflows, source mutation, `system.foundation` mutation.
