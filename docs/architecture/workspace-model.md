# Workspace Model

- Status: current
- Related decisions: `docs/adr/ADR-0017-user-library-and-cross-workspace-reuse.md`, `docs/adr/ADR-0029-organization-tenancy-identity-and-authorization.md`
- Verification: `docs/architecture/architecture-verification.md`

## Scope

Workspace foundations establish persisted workspace records, explicit active-workspace selection, workspace-gated resource surfaces, workspace-owned operation context propagation, and reference-only activation of system-owned packs. They do not implement User Library reuse, asset authoring, override editing, composition authoring, collaboration permissions, pack import/export, marketplace behavior, or automatic legacy migration.

Related topics are defined by their own architecture docs and ADRs. Do not infer later work ownership from historical phase labels.

## Workspace records and active selection

Workspace records are persisted through workspace repositories/use cases and are selected through host/server workspace transports. Renderer localStorage may not be the source of truth for workspace identity, and clients must not derive workspace ids from display names. Hosts must not create hidden/default workspaces to make workspace-scoped features appear populated.

Every new workspace belongs to the active organization. Managed and initialized
local creation persist that organization id in the workspace record and use an
organization-scoped repository. Records without an organization id are an
explicit legacy/unassigned shape only; they are invisible to organization-scoped
repositories until the operator completes the reviewed assignment workflow.

The active workspace is an explicit user/host selection. Workspace-gated pages should show a workspace-required state when no active workspace exists instead of issuing workspace-owned reads without context or showing legacy/global records.

## Explicit context through every seam

UI gating is not sufficient. Every workspace-owned operation must carry explicit workspace context through contracts, clients, transport envelopes/routes, use cases, application ports, providers, and persistence seams. Missing workspace context must fail safely at normalization/use-case/provider boundaries or return sanitized diagnostics; it must not trigger global fallback.

This applies to implemented workspace-owned resources such as artifacts/uploads, image assets, generated-output descriptors and finalization, dataset/model preparation outputs, model inventory validation/publishing operations, runtime task outputs, and Asset Library resource-backed reads. Workspace A records must not be listed or read as Workspace B records.

## System Foundation activation by reference

`system.foundation@1.0.0` remains system-owned. A workspace may activate it only by storing a workspace system-pack activation reference with pack id/version/provenance/status. Workspace creation and selection must not call the system foundation pack baseline installer, copy pack manifests or definitions into workspace storage, seed packs at startup, create hidden/default workspaces, or auto-migrate legacy global resources.

Asset Library effective views may show System Foundation definitions only when the workspace has the active trusted reference and the definitions retain strict system-default provenance. A bare `sourcePackId` is informational and is not authority to expose system defaults.

Because activation is reference-only, Asset Library reads may project the canonical `system.foundation@1.0.0` manifest into the workspace effective view without copying or installing those definitions into workspace storage. The projection is read-only and must still require an active trusted workspace activation record.

## Workspace resource ownership and legacy records

Workspace-owned resource records should carry workspace ownership in their own domain metadata or storage keyspace and should be queried through workspace-aware ports/providers. Until deeper storage layout work exists for a resource family, adapters may use safe metadata/source ownership filtering, but they must not expose raw paths, storage roots, prompts, workflow JSON, provider payloads, or other unsafe diagnostics.

Legacy global records are not silently assigned to a workspace, copied, migrated, or exposed as workspace-owned data. Any future migration/import must be explicit and user-visible.

## Shared model storage

Desktop and server hosts may configure one host-local shared model storage folder through application Settings. This folder is an additional read/discovery source for already downloaded models; it is not a workspace-owned model store and does not copy or migrate records into a workspace.

When a workspace lists models, the model registry may include ephemeral shared entries discovered from the configured folder alongside persisted workspace model records. Those entries must carry explicit workspace request context for authorization and selection, and must be labeled with `storageScope: "shared"` so UI and downstream use cases do not present them as workspace-owned records. Persisted downloads, generated models, validation, publishing, and deletion remain workspace-scoped operations.

Asset Library model resource-backed views may show those shared model entries as sanitized descriptor-only assets for the active workspace. They must not expose local paths, read model files, or persist shared-folder entries into the workspace inventory.

Public model and image-generation read models must continue to omit raw local paths. The Settings page may display and edit the configured folder because that is an explicit host configuration action.

## User Library reuse reuse boundary

User Library reuse introduces User Library and Cross-Workspace Asset Reuse as explicit reuse relationships only. Workspace isolation remains the default: workspace-local assets and resources stay visible only inside their owning workspace unless a later promote, link, copy, or import workflow creates a durable relationship. Direct workspace-to-workspace reuse begins as independent import/copy into the target workspace, not live linking.

The User Library is a separate user-owned scope, not a workspace and not the system foundation. User Library reuse must not use the User Library to justify missing workspace context, hidden/default workspaces, system foundation mutation, startup seeding, or legacy/global auto-migration.

## Collaboration placeholders

Workspace records may carry passive collaboration/readiness placeholders for future phases, but workspace foundations does not implement invites, memberships, permissions, sync, remote auth, multi-user conflict resolution, or sharing policy. Those behaviors belong to later collaboration and distribution phases.

## UI route boundary

Workspace-required UI routes must be blocked at the app route boundary before the requested page becomes the visible shell state. Page-level workspace gates remain defensive boundaries, but setup, loading, and unavailable-workspace surfaces must be stable and must not flash or mark the pending workspace page active until a valid active workspace is available.
