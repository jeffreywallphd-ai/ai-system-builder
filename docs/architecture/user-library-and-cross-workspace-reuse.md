# User Library and Cross-Workspace Asset Reuse

- Status: current
- Related decisions: `docs/adr/ADR-0017-user-library-and-cross-workspace-reuse.md`
- Verification: `docs/architecture/architecture-verification.md`

- Effective asset projections: `docs/architecture/effective-asset-projections.md` defines how linked/copied/imported/user-library sources contribute to workspace-scoped effective projections without live cross-workspace links.

## Purpose

User Library reuse is **User Library and Cross-Workspace Asset Reuse**. It defines the ownership vocabulary and architecture boundaries for moving reusable assets out of a single workspace into a user-owned library, then making those reusable assets available to workspaces through explicit link, copy, or import workflows.

This document is the User Library reuse architecture reference. It summarizes the implemented contracts, application seams, persistence adapters, transport/preload exposure, and minimal UI status while preserving accepted constraints and deferrals for asset authoring/customization and later topics.

## Canonical vocabulary

- **User Library**: A user-owned reusable asset scope. It is not a workspace, not a hidden default workspace, and not the system foundation. It stores or references assets that a user has explicitly promoted or later creates/imports through controlled workflows.
- **User-library asset**: An asset owned by the User Library scope. It may have provenance back to a workspace asset, imported source, or later authoring workflow, but it is not workspace-local and not system-owned.
- **Workspace-local asset**: An asset owned by exactly one workspace. It is visible to other workspaces only after an explicit reuse workflow creates a relationship or independent copy.
- **System-owned asset**: A trusted platform asset owned by the system foundation or another system scope. `system.foundation@1.0.0` remains system-owned and may be activated by workspace reference only.
- **Promotion**: An explicit operation that creates a user-library asset from a workspace-local source asset. Promotion preserves provenance but does not automatically share the promoted asset with other workspaces.
- **Link**: An explicit relationship from a workspace to a user-library asset. A link is not a copy; it remains a reference relationship with explicit propagation semantics.
- **Copy**: An explicit operation that creates an independent workspace-owned asset or record from a user-library asset. Copying is detached by default.
- **Import from another workspace**: An explicit operation that creates an independent copy in a target workspace from a source asset in another workspace. User Library reuse begins with import/copy semantics, not live Workspace A to Workspace B linking.
- **Detached copy**: A copied or imported asset that may remember provenance but does not receive future updates from its source automatically.
- **Linked reference**: A workspace-owned reference record that points to a user-library asset and carries an explicit propagation policy.
- **Source asset**: The asset used as the origin for promotion, copy, link, or import.
- **Source workspace**: The workspace that owns the source asset for promotion or workspace-to-workspace import. User-library links and copies may not have a source workspace unless provenance records one.
- **Target workspace**: The workspace receiving a linked reference, detached copy, or imported copy.
- **Provenance**: Safe origin metadata that records where a reusable asset or relationship came from, such as source workspace, source asset reference, source asset version, promotion timestamp, actor/request context when available, and relationship type.
- **Propagation policy**: The explicit rule that governs whether and how a linked reference may observe source changes. The conservative baseline is pinned or explicit-update behavior; hidden latest-following behavior is not allowed by default.
- **Effective asset source**: The ownership source that a later resolver/effective-view flow reports for an asset visible in a workspace: system-owned activation, workspace-local asset, linked user-library asset, copied user-library asset, or imported workspace asset.
- **Effective resolution summary**: A sanitized read-model summary planned for later canonical decisions that explains why an asset is visible in a workspace and whether it is system-owned, local, linked, copied, or imported. It is not fully implemented by current minimal surfaces.
- **Explicit reuse relationship**: A durable, user-visible relationship created by a controlled workflow: promotion, link, copy, or import. It is the only way workspace-owned assets become reusable outside their owning workspace.
- **Accidental propagation**: Any source change appearing in another workspace without an explicit relationship and approved propagation policy. User Library reuse architecture must prevent this.
- **Legacy/global resource**: A pre-workspace or globally scoped record/resource that lacks explicit workspace or user-library ownership. Legacy/global resources are not automatically assigned to a workspace or User Library.

## Ownership scopes and boundaries

### Workspace isolation remains the default

Workspace-owned assets and resources must not become visible in another workspace unless an explicit reuse workflow creates a relationship. Missing workspace context must fail safely or remain gated for workspace-scoped operations.

UI gating is not enough. Workspace context must flow through contracts, clients, transports, use cases, ports, providers, and persistence seams wherever workspace-owned data is involved. Later User Library reuse implementation work must not rely on renderer state or route gating as the only enforcement boundary.

### User Library is a separate ownership scope

The User Library is a first-class user-owned reuse scope. It is not a workspace, does not make a hidden/default workspace valid, and does not replace system foundation ownership. User-library assets can originate from explicit promotion, and later canonical decisions may add controlled create/import workflows.

### System-owned assets remain system-owned

`system.foundation@1.0.0` remains system-owned. Workspaces may activate it by reference. User Library reuse must not mutate system-owned definitions, copy system definitions into workspace storage, call the system foundation pack baseline installer, seed on startup, or create hidden/default workspaces.

User-library assets, workspace-linked assets, copied assets, and imported assets build on the Asset Kernel. They do not replace `AssetDefinition`, `AssetInstance`, `AssetReference`, `AssetComposition`, resource-backed views, or system foundation packs.

### No legacy/global auto-migration

Legacy/global resources must not be automatically assigned to a workspace or the User Library. Any migration/import behavior must be explicit, user-visible, and deferred unless a later canonical decision scopes it.

## Reuse workflows

### Promotion to the User Library

Promotion must be explicit. It creates a user-library asset from a workspace-local source asset only when the request identifies the source workspace and source asset through safe contract vocabulary.

Promotion should preserve provenance, including:

- source workspace,
- source asset reference,
- source asset version if applicable,
- promotion timestamp,
- actor/request context when available,
- source relationship type.

Promotion must not automatically share the promoted user-library asset with other workspaces.

### Linking a user-library asset into a workspace

Linking is not copying. A workspace link to a user-library asset is a reference relationship. The link must carry explicit propagation semantics.

Do not allow hidden “latest follows everywhere” behavior by default. The conservative default should be pinned or explicit-update behavior unless a later canonical decision intentionally defines another policy and updates the ADR/architecture guidance.

### Copying a user-library asset into a workspace

Copying is detached by default. Copying creates an independent workspace-owned asset or record. It may preserve provenance back to the user-library asset, but it must not receive future user-library updates automatically.

### Importing from another workspace

Workspace-to-workspace reuse begins as import/copy, not live linking. Direct reuse from another workspace should initially create an independent copy in the target workspace. Do not establish live Workspace A to Workspace B links as default behavior.

## Effective-view behavior (current, limited)

Current resolver/read-facade integration annotates these source kinds on base registry cards only:

- system-owned asset activated by workspace reference,
- workspace-local asset,
- linked user-library asset,
- copied user-library asset,
- imported workspace asset.

Synthesizing linked/copied/imported entries that do not already exist in the base registry list is intentionally deferred.

## Non-goals

This User Library reuse baseline does not implement:

- broad asset authoring,
- arbitrary asset editing,
- override editing,
- visual composition,
- canvas authoring,
- wizard authoring,
- workflow execution,
- runtime task execution expansion,
- provider/network expansion,
- pack import/export,
- marketplace/package registry behavior,
- collaboration permissions,
- invites,
- sync,
- remote auth,
- organization libraries,
- automatic legacy migration,
- hidden default workspaces,
- system foundation mutation,
- startup seeding,
- raw resource byte/content reads.

Actor/member/role fields may remain passive placeholders. Collaboration permissions, invites, sharing permissions, sync, remote auth, organization libraries, and multi-user workspace behavior belong to execution plan preparation or later.

## Later work checklist

- Does every workspace-owned operation carry explicit workspace context through all relevant seams?
- Is every cross-scope relationship explicit, durable, and user-visible?
- Are link propagation semantics explicit and conservative by default?
- Are copies and imports detached unless a later accepted decision says otherwise?
- Does provenance avoid raw paths, resource bytes, process-history notes, provider payloads, secrets, commands, environment values, and stack traces?
- Does the implementation avoid mutating or copying `system.foundation@1.0.0` definitions?
- Does the change avoid hidden/default workspaces, startup seeding, and legacy/global auto-migration?

### User Library reuse transport exposure

User Library reuse operations are now exposed at narrow API, Electron IPC, and desktop preload boundaries for future UI work. Transport requests keep workspace context explicit (`sourceWorkspaceId`, `targetWorkspaceId`, or `workspaceId` depending on operation) and missing workspace context fails at the boundary with sanitized validation responses. The exposed operations are promote, link, detached copy, workspace-to-workspace import, user-library asset reads, workspace user-library link reads, and effective asset source summary reads where the workspace asset read facade provides them.

This transport exposure does not add desktop or thin-client UI, propagation execution, live workspace-to-workspace linking, broad authoring, override editing, pack import/export, marketplace behavior, or asset authoring/customization/9 behavior.


## User Library reuse current status

### Implemented and composed

- User-library contract vocabulary is implemented for identity normalization, command normalization (promote/link/copy/import), propagation policy validation, provenance, diagnostics, result/failure envelopes, and effective-source summaries.
- Application ports and use cases are implemented for promote, link, detached copy, and workspace-to-workspace detached import flows with safe validation and duplicate/idempotency handling.
- Local persistence adapters are implemented for user-library records and workspace-scoped link/copy/import relationship records.
- Effective-source read summaries are integrated through workspace asset resolver/read-facade seams with workspace isolation preserved.
- Transport exposure exists for API + Electron IPC + desktop preload with explicit workspace identifiers and sanitized error mapping.
- Minimal desktop and thin-client User Library UI/client surfaces exist for list/read and explicit link actions that require workspace context.

### Implemented but transport/UI unavailable

- Promote, detached copy, and workspace import operations are transport-exposed with typed unavailable behavior when host composition does not wire those use cases.
- Detached copy actions are unavailable in User Library reuse minimal UI (UI does not offer copy execution).
- No live workspace-to-workspace links. Workspace import remains detached copy semantics.
- No automatic propagation execution or hidden latest-follow behavior.
- No broad asset authoring, customization editing, override editing, or composition authoring in User Library reuse.
- No collaboration/permissions/invites/sync/remote auth/organization libraries.
- No pack import/export or marketplace behavior.

### Intentionally deferred

- Workspace isolation remains default and mandatory.
- User Library remains a separate user-owned scope (not a workspace and not system foundation).
- Promotion is explicit; linking is references; copying/importing are detached by default.
- System-owned assets remain system-owned; `system.foundation@1.0.0` is activated by reference only.
- No hidden/default workspace creation, startup seeding, or legacy/global auto-migration is introduced by this area.

### Relationship To Asset Authoring, Customization, And Override Management

asset authoring/customization should build on these explicit User Library reuse relationships by adding controlled authoring/customization surfaces and explicit override records without weakening User Library reuse safety boundaries. See `docs/architecture/asset-authoring-customization-and-overrides.md` and ADR-0018 for the canonical asset authoring/customization baseline.

asset authoring/customization may add:

- user-facing asset editing surfaces,
- workspace-local customization records,
- explicit override records for controlled divergence,
- version/conflict rules for customized linked/copied/imported assets,
- safe promotion of authored/customized assets,
- clear UX distinctions between editing a detached copy and updating a link relationship.

asset authoring/customization must not assume hidden propagation, live workspace-to-workspace links, system foundation mutation, automatic default workspaces, collaboration permissions, pack import/export, or marketplace behavior.

### Maintenance Checklist

- Verify every public promote/copy/import claim remains transport-composed in both server and desktop host composition.
- Verify effective-source summaries do not leak cross-workspace records.
- Verify desktop/thin-client UI keeps linked vs copied semantics distinct and never treats localStorage as workspace source of truth.
- Verify boundary/import-discipline tests continue preventing cross-layer dependency drift.


## User Library reuse implementation status
- Implemented in minimal desktop/thin-client UI: list saved reusable assets, list workspace links, list effective asset sources, and explicit link actions with conservative pinned-version defaults.
- Deferred/unavailable in minimal UI: promote and import action flows, advanced editing, propagation execution, live workspace-to-workspace links, collaboration, pack import/export, marketplace, hidden/default workspaces, startup seeding, and legacy/global auto-migration.
- Transport and preload exposure may include promote/import operations, but minimal UI intentionally does not present them as available actions .
- Documentation and tests must stay aligned with implemented behavior; do not claim unsupported actions as complete.


## Relationship to asset composition planning

asset composition planning may compose projections derived from linked/copied/imported user-library sources, but must not create live workspace-to-workspace links, silently propagate changes, or mutate user-library records.
