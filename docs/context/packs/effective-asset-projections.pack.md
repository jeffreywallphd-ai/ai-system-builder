# Context Pack: Effective Asset Projections

- Pack name: `effective-asset-projections`

## Purpose

Provide compact, truthful context for effective asset projections, readiness semantics, and asset composition planning output boundaries.

## Use When

- Effective asset projection contracts/ports/persistence/use cases/read models.
- Projection readiness/consumability, blockers, diagnostics, provenance, refresh/invalidation behavior.
- Authored/customized/user-library source projection behavior.
- API/IPC/preload/UI projection readiness exposure.

## Canonical docs/files to inspect

- `docs/architecture/effective-asset-projections.md`
- `docs/adr/ADR-0019-effective-asset-projections.md`
- `modules/contracts/effective-asset-projections/`
- `modules/application/ports/effective-asset-projections/`
- `modules/adapters/persistence/effective-asset-projections/`
- `modules/application/use-cases/effective-asset-projections/`
- `docs/architecture/asset-authoring-customization-and-overrides.md`
- `docs/architecture/user-library-and-cross-workspace-reuse.md`

## Implemented Surfaces

- Workspace-scoped projection contract vocabulary + normalizers.
- Projection repository port + local JSON persistence adapter.
- Authored/override create+refresh and draft-preview use cases.
- Validation, diagnostics/blockers, readiness/consumability helpers.
- Projection read facade/list/detail/by-reference summaries.
- Thin API/IPC/preload wrappers and minimal desktop/thin-client readiness UI.

## Required constraints

- Explicit workspace ID on all projection operations.
- No hidden/default/global workspace fallback.
- No source mutation (`system.foundation` immutable).
- No silent application of blocked/conflicted/disabled/stale projections.
- Public projection output is safe metadata only (no raw paths/bytes/payload/tokens/secrets).
- `ready` means ready for downstream planning, not execution.

## Anti-drift rules

- Keep status/policy/diagnostic vocabulary aligned with contracts + ADR-0019.
- Do not claim runtime/workflow execution in projection docs/UI/transport.
- Do not expand safe projected field classes without explicit contract + tests.

## Deferred items

Runtime/workflow execution, visual composition-first UX, payload/materialized-workflow generation, prompt/provider/binary payload projection, automatic conflict resolution/rebase, background propagation, collaboration/permissions, pack import/export, marketplace, and advanced source/target authoring UX remain deferred.

## Asset Composition Planning Output Boundary

Asset composition planning works on top of safe projections: select compatible projections, order dependencies, build non-runtime plans, and surface missing/blocked/conflicted readiness gaps before plan build.

## Related packs

- `docs/context/packs/asset-authoring.pack.md`
- `docs/context/packs/user-library.pack.md`
- `docs/context/packs/asset-kernel.pack.md`
- `docs/architecture/system-overview.md`

## UX correction guardrail

Treat effective asset projections as internal architecture/read-model context. Normal user navigation should center on **Assets**, with projection status/readiness integrated into asset cards/details using planning-oriented wording. Do not route users to a separate primary 'Effective Assets' page.
