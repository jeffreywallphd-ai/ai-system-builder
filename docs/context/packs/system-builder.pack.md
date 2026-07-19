# Context Pack: System Builder

- Pack name: `system-builder`

## Purpose

- Keep composed-system work aligned to the Asset Kernel and the Systems product area.
- Prevent builder-application status from being modeled as user system state.

## Use When

- Changing System Builder records, system composition semantics, or the Systems page.
- Preparing system creation, editing, validation, persistence, or plan materialization.
- Preparing deterministic builds, immutable releases, composed policy, finite workflows, or system-level Run & Test.
- Moving or labeling software status and runtime diagnostics near the Systems/Settings boundary.

## Do Not Use When

- A task concerns only System Foundation ownership, a system prompt, or operating-system resources.
- Runtime diagnostics work does not affect System Builder terminology or placement.
- Reuse canonical `AssetSlotDefinition` and `AssetPlacement` for containment; do not overload typed bindings or create renderer-owned hierarchy.
- Slot-aware revisions declare an explicit profile and exact layout identity. Preserve logical start/end names and source order across responsive presentation.
- Treat omitted structure plus omitted placements as immutable `legacy-flat` data; reads must not synthesize or persist a migration.

## Core Guidance

- A system is a workspace-owned composed Asset Kernel unit, not builder-application health.
- Reuse `AssetComposition`, asset instances, bindings, references, rules, provenance, and validation summaries.
- System compositions are limited to `system` and `system-of-subsystems`.
- System Builder lifecycle is design-time only; never substitute runtime, installer, host, or software-health status.
- Keep asset composition planning as an optional non-executing source record.
- Require explicit workspace identity for every future system-owned operation and persistence seam.
- Systems is workspace-scoped; Settings / Software status remains global and operational.
- Design identity, immutable revisions, build attempts, immutable releases, deployments, and execution runs are separate record families.
- Security assets may narrow but never widen platform/organization authority; the initial workflow language is finite, typed, and capability-based.

## Current Implementation Shape

- Contracts and immutable revisions: `modules/contracts/system-builder/`.
- Repository port and application behavior:
  `modules/application/ports/system-builder/` and
  `modules/application/use-cases/system-builder/`.
- Shared structured persistence: `modules/adapters/persistence/system-builder/`.
- Shared system validation:
  `modules/application/services/system-builder/validate-system-builder-revision.service.ts`.
- API/IPC transports and clients are present for both hosts; Systems uses the
  shared `modules/ui/shared/system-builder/` editor in desktop and thin client.
- The shared Compose UI preview uses current in-memory instance order and applied
  configuration, is bounded to registered System Foundation frontend renderers,
  and reports nonvisual or unsupported assets truthfully. It never executes
  backend or implementation source and does not imply build, release, activation,
  or deployment.
- Deterministic attempts and immutable releases live in the separate
  `system-build` contract, application, persistence, storage, API/IPC, and
  shared Build & Release workflow families. Approval re-verifies every artifact
  and derives release identity from content.
- Plans and whole-system Run & Test live under Systems, not Assets.
- The closed secured data-entry template and its release-bound `system-data`
  runtime are implemented. Runtime schema/policy comes only from one verified
  approved manifest; application services own validation, authorization,
  masking, optimistic writes, and redacted audit. Desktop and thin-client use
  the shared `SystemDataRunTest` presenter.
- The closed controlled-chatbot template composes reusable foundation and
  conversation assets, builds through the existing immutable release pipeline,
  and uses the shared `ConversationRunTest` presenter with real execution-plan
  identity. Protected instructions stay behind application boundaries; release
  approval is not runtime activation.
- The closed secured data-review template composes reusable browser, masking,
  policy, audit, and preview assets. Its `system-review` runtime resolves policy
  only from a verified approved release, uses opaque artifact references,
  bounds storage reads before byte materialization, masks metadata, and records
  redacted audit. Desktop and thin client use the shared
  `SystemReviewRunTest` presenter; release approval is still not deployment.
- The separate `system-deployment` family now owns organization/workspace-scoped
  install, activation, readiness, rollback, revocation, bounded run history,
  and redacted audit. Desktop maps only the three closed references to the local
  trusted adapter; managed server maps campus/corporate and cloud profiles.
  Thin client is control/read only, and imported/authored execution remains
  `sandbox-unavailable` without an independently qualified adapter.
- `dev-tools/config/asset-system-qualification.json` owns the versioned
  compatibility, deprecation, performance, admission, and profile evidence
  matrix. Deployment re-reads frozen implementation revocations before every
  privileged lifecycle transition; missing controlled/manual evidence keeps a
  profile incomplete.
- Operational diagnostics remain in
  `apps/desktop/src/renderer/features/settings/components/SoftwareStatusSection.tsx`.
- Deployment is never implied by the design-time editor or a successful build;
- `docs/adr/ADR-0036-canonical-slot-composition-and-foundation-layouts.md`
  it requires an explicit compatible install and readiness-verified activation.

## Canonical Source Docs

- `docs/architecture/system-builder.md`
- `docs/architecture/system-build-and-release.md`
- `docs/adr/ADR-0024-system-builder-area-and-software-status-placement.md`
- `docs/adr/ADR-0033-system-builds-releases-security-and-workflows.md`
- `docs/architecture/asset-kernel.md`
- `docs/architecture/asset-composition-planning.md`
- `docs/architecture/workspace-model.md`
- `docs/architecture/module-dependency-rules.md`
- `docs/operations/asset-system-support-qualification.md`

## Anti-Drift Rules

- Do not create a parallel asset/composition vocabulary in System Builder.
- Do not put Python, ComfyUI, host lifecycle, resource utilization, or software status on System Builder records.
- Do not make Systems globally accessible without an active workspace.
- Do not claim deployment, execution, independent reproducibility, or a higher
  SLSA assurance level until its implementation and qualifying evidence exist.
- Do not mutate old system revisions/releases or store deployment/runtime status in design records.
- Do not rename valid ownership terms such as `system.foundation` or `system-owned`.

## Companion Packs

- `asset-kernel` for component and composition vocabulary.
- `asset-composition-planning` for plan inputs and compatibility.
- `desktop-implementation` for Systems or Settings UI changes.
- `persistence-storage`, `ipc-electron`, `server-host`, or `testing` only when those boundaries are explicitly in scope.
