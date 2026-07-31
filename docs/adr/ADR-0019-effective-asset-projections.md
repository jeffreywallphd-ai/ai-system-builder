# ADR-0019: Effective Asset Projections Baseline

- Status: accepted
- Date: 2026-05-20

## Context

effective asset projections needs a conservative architecture baseline for deriving safe, workspace-scoped effective outputs from system/workspace/user-library/authored/customized asset sources.

asset authoring/customization established authoring/customization/override vocabulary, but intentionally deferred portions of override targeting, existing-authored revision publishing, and guaranteed workspace-wide effective summaries. effective asset projections must build on available behavior without assuming deferred capabilities are complete.

## Decision

effective asset projections introduces workspace-scoped effective asset projections as safe, metadata-oriented outputs derived from system, workspace, user-library, authored, and customized sources. Projections do not execute workflows, mutate sources, resolve conflicts automatically, or materialize unsafe payloads.

## Accepted effective asset projections boundaries

effective asset projections current implementation is architecture/docs/context baseline only. It adds no contracts, ports, persistence adapters, use cases, API/IPC/preload handlers, or UI runtime behavior.

## Projection ownership and workspace scope

- Workspace isolation remains default.
- Projection creation/read requires explicit workspace ID.
- Projections are workspace-scoped derived outputs.
- `system.foundation@1.0.0` remains immutable/system-owned and is never mutated/copied as source definitions.
- Linked user-library sources are never silently mutated.
- Detached copies/imported copies remain detached.
- No hidden propagation and no live workspace-to-workspace links.

## Materialization policy decision

Adopt constrained policy vocabulary for safe projection outputs only:

- `summary-only`
- `safe-fields-only`
- `draft-preview-only`
- `execution-ready-metadata-only`
- `blocked`

No policy implies workflow payload synthesis, runtime execution, or arbitrary JSON merge behavior.

## Safe projected fields decision

effective asset projections projections are metadata-oriented and conservative.

Allowed baseline fields include display/summary/description labels, classification/tags, asset authoring/customization-sanitized metadata keys, source/revision labels, readiness, and safe diagnostics.

Explicitly excluded by default: raw paths/storage roots, bytes/blobs/base64, provider payloads, raw prompt/workflow payloads, credentials/tokens, environment values, stack traces, command lines, signed URLs, and arbitrary JSON blobs.

## Conflict/blocking decision

Projection conflicts/blockers are explicit and never silently resolved.

Minimum baseline outcomes:

- missing source => `source-missing`/blocked,
- conflicted override or base revision mismatch => `conflicted`,
- disabled override => not applied,
- unsafe/unsupported fields => blocked or partial with sanitized diagnostics,
- draft without published revision => `draft-only` or blocked by policy/context,
- missing target reader => unavailable/unsupported diagnostic.

No automatic rebase, auto-update, or hidden conflict resolution workflows.

## Consequences

Positive:

- Enables a clear non-executing projection layer for future composition planning.
- Preserves ownership/workspace safety across mixed source kinds.
- Provides explicit diagnostic/readiness semantics for downstream layers.

Costs:

- Requires explicit conflict and invalidation handling surfaces.
- Keeps high-risk payload fields deferred until explicit schemas/tests are accepted.
- Depends on truthful handling of asset authoring/customization deferred capabilities.

## Explicit non-goals

This decision does not introduce:

- workflow/runtime execution,
- collaboration permissions/multi-user auth,
- pack import/export or marketplace behavior,
- hidden/default workspaces/startup seeding/legacy-global migration,
- live workspace synchronization,
- arbitrary prompt/workflow/json editing.

## Relationship to asset authoring/customization

effective asset projections consumes asset authoring/customization authored assets, drafts, published revisions, override records, customization targets, provenance, conflict status, safe editable fields, and explicit workspace context.

effective asset projections must preserve asset authoring/customization truthfulness limits:

- override creation safe-target flow may remain deferred,
- existing-authored-asset revision publishing may remain deferred,
- workspace-wide effective summaries may be partial/unavailable.

## Relationship To Asset Composition Planning

asset composition planning (**Asset Composition Planning**) should build on effective asset projections projections for selection, ordering, dependency planning, compatibility checks, and non-runtime preparation.

asset composition planning must not reinterpret effective asset projections as execution authorization, and must not assume runtime execution, collaboration, marketplace behavior, or arbitrary payload editing.


## Current implementation alignment

Current effective asset projections implementation confirms these accepted decisions:

1. Projection records are workspace-scoped and require explicit workspace context at creation/read/refresh surfaces.
2. Safe projected fields remain metadata-oriented and explicitly exclude raw runtime/provider/payload content classes.
3. Projection persistence remains a separate storage concern from Asset Kernel, User Library, and Asset Authoring record stores.
4. Source mutation is forbidden; projection workflows are read/derive/materialize only.
5. Projection `ready` is planning-consumability only, not runtime execution readiness.
6. `blocked`, `conflicted`, `disabled`, and `stale` remain explicit states and are never silently treated as applied.
7. Transport/UI exposure remains readiness/status oriented, not execution-capability exposure.
8. Downstream planning is constrained to **Asset Composition Planning** over safe projections.

### Deferred consequences retained

The implementation intentionally keeps runtime/workflow execution, visual composition-first flows, arbitrary payload projection/editing, background propagation, collaboration, pack import/export, marketplace behavior, and automatic conflict resolution out of effective asset projections scope.


## UX alignment note

effective asset projections projection records and transports remain internal architecture. The primary user-facing destination is the **Assets** area, which may display projection-derived readiness/status badges. ADR-0019 does not require or endorse a separate top-level 'Effective Assets' page in normal navigation.
