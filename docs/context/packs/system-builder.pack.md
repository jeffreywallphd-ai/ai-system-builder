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
- New interactive records begin with one Foundation v3 system root, a required
  exact application layout, and a canonical application/page containment tree.
  The default is `builtin.layout.application.minimal@3.0.0` when no layout is
  requested. Save, clone, persistence, API, IPC, preload, and shared UI paths
  preserve exact structure and placements; legacy-flat revisions remain readable
  without persistence-time synthesis.
- Validation resolves exact definitions and enforces root identity, slot
  declaration and compatibility, cardinality, placement coverage, bounded
  depth, and acyclic containment before a revision can be treated as valid.
- The workspace Composer catalog supplies exact definitions, schemas, defaults,
  ports, slots, availability, container geometry, and compatibility. Both hosts
  share a three-column Design workspace: searchable Asset Palette, wide Canvas,
  and one sidebar with fitted top tabs for Properties, Styling, and Layers;
  Configure identity and Collapse follow below the tabs. Styling uses
  color pickers and allowlisted typography, density, button, form, and surface
  selects; semantic styles are unavailable through Advanced JSON, and per-asset
  roles remain bounded Properties selects. The Palette supports collapsed,
  one-column normal, and wider multi-column maximized views. Its Layout, Assets,
  Unassigned visual assets, and System resources and logic disclosures start
  collapsed. Canvas States also start collapsed while retaining their drop
  surfaces. Collapsed bodies do not mount hidden drag or preview descendants;
  only the active details body mounts and rebuilds from the canonical draft.
  Layers lists only placed hierarchy; presentation state is not persisted.
  Square tiles and Canvas regions are pointer, touch, and keyboard drag surfaces;
  legacy Add-here, move-order, reparent, and wrapper forms are absent. Foundation
  layouts expose labels but no editable dimensions, regions, responsive rules,
  raw JSON, CSS, or coordinates. Ordinary containers retain bounded Layout
  fields and nested drop regions. Containers expose structure; leaf nodes render
  one composition-aware surface without repeating descendant UI. Fixed rows
  expand for descendants and use the outer Canvas as their scroll boundary.
- Layout selection uses one HTTP/IPC preview operation and immediately updates
  the undoable draft. Expected-revision checks and canonical order report
  preserved, moved, and unassigned assets without persistence. An already-current
  legacy-flat UI reference may preview Minimal; v1/v2 references require the
  explicit Foundation upgrade first. Layout application materializes the current
  root and shell in memory while preserving historical assets and bindings.
  Reference profiles may add bounded current containers/actions, but bindings
  never imply containment. Exact catalog types place unmatched pages,
  components, features, and trusted slot-bearing facades under draggable
  Unassigned visual assets; policies, models, workflows, contracts, unknowns,
  and other nonvisual assets remain under nondraggable System resources and
  logic. Only Save creates the next immutable revision.
- Canonical saved placement edges remain visible when a historical container's
  exact catalog definition is unavailable. Canvas exposes a bounded read-only
  structural region for those occupied edges so traversal does not stop, but it
  does not infer compatibility, allow drops, change exact versions, or persist
  synthesized slots. Without exact geometry, regions use source-order auto-flow.
- System Builder Composer may project the complete exact current built-in
  Foundation catalog for a workspace with an older active trusted Foundation
  generation. This Composer-only seam supplies nested slots and qualified
  previews without widening the workspace Asset Library effective view.
- Catalog bootstrap uses the complete workspace catalog as the primary read and
  falls back to a layout-only query only when it contains no application
  layouts. Mounted-workspace compatibility results are cached by exact parent
  definition version and region; configuration edits do not refetch them.
- Foundation v1/v2-to-v3 upgrade is explicit and two-step. Preview is read-only;
  confirmation requires the exact source revision, rejects lossy or invalid
  mappings, and creates a new immutable v3 revision while preserving source history.
- The shared Compose UI preview recursively follows current in-memory placements
  and canonical region order, includes unsaved configuration, exposes unplaced
  visual, nonvisual resource, and unsupported nodes truthfully, and offers
  desktop/tablet/mobile frames. Exact-version
  frontend backing programs drive the registered structural, form, display,
  state, conversation, and preview renderers. Nested regions render as one
  composed application and primary content suppresses simultaneous alternative
  states. Foundation v3 root colors become inherited CSS variables, while root
  and per-asset style choices become stable semantic data roles. The renderer
  accepts no arbitrary CSS, selector, or dimension. It never executes backend or unqualified implementation
  source and does not imply build, release, activation, or deployment. Keep the
  three hand-authored reference-system semantic HTML fixtures as fidelity
  oracles; do not replace them with generated snapshots.
- `npm run test:visual-composer` uses one worker and isolated ignored state to
  qualify the shared workflow through packaged Windows Electron IPC and local
  Chrome API paths. Treat its sanitized automation as exact-environment
  regression evidence, not as physical-touch, screen-reader, cross-platform,
  manual-security, or production-performance qualification.
- Systems Manage uses one workspace-scoped application projection for draft,
  published, and archived systems across API and IPC. Its shared host surface
  supports search/filter/sort/paging, exact-revision preview, Compose handoff,
  duplication, archive-backed deletion, and restore. Archive is recoverable and
  retains immutable history. These actions are not duplicated in Compose, whose
  active-only picker refreshes after Manage lifecycle changes.
- Compose shows edit-existing, create-new, and create-from-template forms without
  eager system or layout loads. Edit stages then loads; new uses Minimal; both
  creation flows require names. Loaded actions share a toolbar below the forms,
  and the catalog is requested only for an edit, creation, or Manage handoff.
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
