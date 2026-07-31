# Context Pack: User Library and Cross-Workspace Reuse

- Pack name: `user-library`

## Purpose

- Route User Library and cross-workspace asset reuse work.
- Keep promote/link/copy/import/provenance/propagation behavior aligned with canonical architecture and ADR guidance.

## Use When

- Promoting workspace assets to the User Library.
- Linking user-library assets into workspaces.
- Copying user-library assets into workspaces.
- Importing assets from another workspace.
- Cross-workspace reuse relationships, provenance, propagation policy, pinned/explicit-update semantics, effective asset source summaries, or accidental sharing prevention.

## Do Not Use When

- The task only concerns workspace-local resources with no reusable library relationship.
- The task is asset authoring/customization without promote/link/copy/import or provenance behavior.

## Core Guidance

- Workspace isolation remains the default.
- Workspace-owned data crosses workspace boundaries only through explicit reuse workflows.
- The User Library is user-owned, not a workspace, hidden/default workspace, or system foundation.
- Promotion is explicit and must preserve safe provenance.
- Linking is a reference relationship with explicit propagation policy; hidden latest-following is not the default.
- Copying user-library assets into a workspace is detached by default.
- Workspace-to-workspace reuse starts as import/copy into the target workspace, not live linking.
- `system.foundation@1.0.0` remains system-owned and reference-activated only.
- Legacy/global resources are not auto-migrated into workspaces or the User Library.

## Current Status

- API routes, Electron IPC, and desktop preload expose narrow promote/link/copy/import plus user-library/effective-source reads with explicit workspace ids where required.
- Desktop renderer and thin-client UIs provide minimal safe User Library views and explicit link actions with conservative pinned-version defaults.
- Promote/import transport operations may exist, but the minimal UI does not present unsupported flows as complete actions.
- Propagation execution, live workspace-to-workspace links, broad authoring, override editing, collaboration, pack import/export, marketplace, and automatic migration remain deferred.

## Anti-Drift Rules

- Do not claim unavailable user-library behavior is complete.
- Do not replace Asset Kernel definitions, instances, references, compositions, resource-backed views, or system foundation packs.
- Do not introduce hidden/default workspaces, startup seeding, system foundation mutation, or installer calls during workspace creation.
- Do not rely on UI gating alone as the workspace boundary.
- Do not add direct live Workspace A to Workspace B links unless a later ADR accepts that model.
- Do not expose raw bytes/content, paths, provider payloads, prompts, secrets, commands, env values, or stacks in provenance/effective summaries.

## Canonical Docs To Inspect

- `docs/architecture/user-library-and-cross-workspace-reuse.md`
- `docs/adr/ADR-0017-user-library-and-cross-workspace-reuse.md`
- `docs/architecture/workspace-model.md`
- `docs/architecture/asset-kernel.md`
- `docs/architecture/persistence-and-storage.md` when storage ownership is involved.
- `docs/architecture/module-dependency-rules.md` when adding contracts, ports, adapters, transports, or UI seams.

## Companion Packs

- `asset-kernel` for asset/source semantics.
- `asset-authoring` when reuse combines with custom authored assets or overrides.
- `effective-asset-projections` when effective source/projection behavior changes.
- `persistence-storage`, `security`, and `testing` for storage, safe diagnostics, and regression coverage.
- `desktop-host`, `server-host`, and `ipc-electron` only when transport/host exposure changes.

## Prompt Assembly Notes

- Typical set: `index` + `user-library` + `asset-kernel`.
- Add `asset-authoring` for customization/override work on top of reuse relationships.
- Keep implementation history out of reusable context; this pack should remain a compact routing surface.
