# ADR-0017: User Library and Cross-Workspace Asset Reuse

- Status: accepted
- Date: 2026-05-15
- Deciders: ai-system-builder maintainers
- Related: docs/adr/ADR-0005-builder-core-platform-capabilities-and-user-composable-assets.md, docs/adr/ADR-0016-asset-kernel-terminology-and-architecture-baseline.md, docs/architecture/asset-kernel.md, docs/architecture/workspace-model.md, docs/architecture/user-library-and-cross-workspace-reuse.md, docs/context/packs/user-library.pack.md

## Context

workspace foundations established Workspace Foundations: workspace records, explicit active workspace selection, workspace-gated resource surfaces, workspace-owned operation context propagation, and reference-only activation of `system.foundation@1.0.0`.

User Library reuse needs a conservative baseline for reuse across ownership scopes. Users need to promote assets from a workspace into a reusable library and later make those assets available to workspaces without hidden sharing, accidental propagation, system foundation mutation, live Workspace A to Workspace B coupling, or automatic migration of legacy/global resources.

The Asset Kernel remains the shared vocabulary for definitions, instances, references, compositions, provenance, and resource-backed views. User Library reuse extends ownership and reuse relationships around that kernel; it does not replace the kernel.

## Decision

Accept the User Library reuse **User Library and Cross-Workspace Asset Reuse** baseline in `docs/architecture/user-library-and-cross-workspace-reuse.md`.

The canonical terms are:

- **User Library**: a user-owned reusable asset scope that is not a workspace and not the system foundation.
- **User-library asset**: an asset owned by the User Library scope.
- **Workspace-local asset**: an asset owned by exactly one workspace.
- **System-owned asset**: an asset owned by the system foundation or another system scope; `system.foundation@1.0.0` remains system-owned.
- **Promotion**: an explicit operation that creates a user-library asset from a workspace-local source asset.
- **Link**: an explicit workspace reference relationship to a user-library asset.
- **Copy**: an explicit operation that creates an independent workspace-owned asset or record from a user-library asset.
- **Import from another workspace**: an explicit operation that creates an independent target-workspace copy from another workspace's source asset.
- **Detached copy**: a copied or imported asset that does not receive future updates automatically.
- **Linked reference**: a workspace-owned reference record to a user-library asset with explicit propagation policy.
- **Source asset**: the asset used as the origin for promotion, copy, link, or import.
- **Source workspace**: the workspace that owns the source asset for promotion or workspace-to-workspace import.
- **Target workspace**: the workspace receiving a linked reference, detached copy, or imported copy.
- **Provenance**: safe origin metadata for reusable assets and relationships.
- **Propagation policy**: the explicit rule for whether and how a linked reference may observe source changes.
- **Effective asset source**: the source classification reported by later effective-view behavior.
- **Effective resolution summary**: a sanitized planned read-model summary explaining why an asset is visible in a workspace.
- **Explicit reuse relationship**: a user-visible relationship created by promotion, link, copy, or import.
- **Accidental propagation**: source changes appearing in another workspace without an explicit relationship and approved propagation policy.
- **Legacy/global resource**: a pre-workspace or globally scoped record/resource that lacks explicit workspace or User Library ownership.

User Library reuse decisions:

1. Workspace isolation remains the default. Workspace-owned assets and resources must not become visible in another workspace unless an explicit reuse workflow creates a relationship. No active workspace means workspace-scoped operations must fail safely or remain gated. UI gating is not enough; workspace context must flow through contracts, clients, transports, use cases, ports, providers, and persistence seams where workspace-owned data is involved.
2. The User Library is a separate ownership scope. It is not a workspace and not the system foundation.
3. Promotion is explicit. Promotion should preserve source workspace, source asset reference, source asset version when applicable, promotion timestamp, actor/request context when available, and source relationship type. Promotion must not automatically share the asset with other workspaces.
4. Linking is not copying. Workspace links to user-library assets are reference relationships with explicit propagation semantics. Hidden latest-following behavior is not allowed by default; pinned or explicit-update behavior is the conservative baseline.
5. Copying is detached by default. A copied user-library asset becomes independent workspace-owned data and does not receive future user-library updates automatically.
6. Workspace-to-workspace reuse begins as import/copy, not live linking. User Library reuse must not default to live Workspace A to Workspace B links.
7. System-owned assets remain system-owned. User Library reuse must not mutate system definitions, copy system definitions into workspace storage, call the system foundation pack baseline installer, seed on startup, or create hidden/default workspaces.
8. Legacy/global assets and resources are not auto-migrated into a workspace or User Library. Any migration/import behavior must be explicit and separately scoped.
9. Resolver/effective-view behavior is partially implemented: base registry cards can be annotated with effective-source summaries; synthesized effective-view entries remain deferred. Later work should distinguish system-owned activation, workspace-local assets, linked user-library assets, copied user-library assets, and imported workspace assets.
10. Collaboration and permissions remain deferred. Actor/member/role fields may remain passive placeholders; invites, sharing permissions, sync, remote auth, organization libraries, and multi-user workspace behavior belong to execution plan preparation or later.

## Consequences

### Positive

- Reuse can grow without weakening workspace isolation.
- User-library ownership is distinct from workspace ownership and system foundation ownership.
- Provenance and propagation semantics become reviewable before contracts and persistence are added.
- Later resolver/effective-view work has clear source categories and no hidden latest-following default.

### Negative

- Early User Library reuse workflows must carry more relationship metadata than a simple shared/global asset list.
- Pinned or explicit-update link behavior is less automatic for users than global latest-following reuse.
- Workspace-to-workspace reuse requires copy/import flow before any future live sharing model can be considered.

### Follow-up

- Add user-library contract vocabulary in the next User Library reuse prompt.
- Add application ports and persistence adapters only after contract vocabulary is reviewed.
- Implement promotion, linking, copying, workspace import, effective-view integration, transports, and UI in later work following User Library reuse architecture.
- Keep pack import/export, broad authoring, override editing, visual composition, execution expansion, collaboration permissions, organization libraries, legacy auto-migration, system foundation mutation, and raw resource byte/content reads out of this baseline.


## Finalization note (2026-05-19)

This ADR was initially accepted as a User Library reuse baseline before all implementation work completed. Current implementation status: implemented User Library reuse surfaces now include contracts, application ports/use cases, local persistence adapters, effective-source read integration, API/IPC/preload exposure, and minimal desktop/thin-client UI for explicit promote/link/copy/import transport workflows (UI currently surfaces only link).

The accepted constraints remain unchanged: no live workspace-to-workspace linking, no hidden propagation execution, no hidden/default workspace creation, no legacy/global auto-migration, no system foundation mutation, and no asset authoring/customization authoring/customization/override behavior in User Library reuse.


## User Library reuse implementation status
- Implemented in minimal desktop/thin-client UI: list saved reusable assets, list workspace links, list effective asset sources, and explicit link actions with conservative pinned-version defaults.
- Deferred/unavailable in minimal UI: promote and import action flows, advanced editing, propagation execution, live workspace-to-workspace links, collaboration, pack import/export, marketplace, hidden/default workspaces, startup seeding, and legacy/global auto-migration.
- Transport and preload exposure may include promote/import operations, but minimal UI intentionally does not present them as available actions as available actions.
- Documentation and tests must stay aligned with implemented behavior; do not claim unsupported actions as complete.
