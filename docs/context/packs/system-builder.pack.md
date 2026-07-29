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
- The workspace Composer catalog supplies structural exact-definition summaries,
  ports, slots, availability, container geometry, and compatibility without
  eagerly carrying configuration schemas or defaults. Both hosts share a
  two-column Design workspace: a wide Canvas and one sidebar with fitted top tabs
  for Properties, Styling, and Layers. Styling uses color pickers and allowlisted typography, density,
  button, form, and surface selects; semantic styles are unavailable through
  Advanced JSON, and per-asset roles remain bounded Properties selects. Canvas
  States start collapsed. Only the active details body mounts and receives exact
  definition detail for its current asset. Layers also separates System resources and logic.
  Every exact slot-bearing container exposes Add element. Its shared modal scopes
  compatible new definitions and unassigned visual instances to the selected
  region, groups and filters them by UI category, and inserts or reattaches a
  clicked choice without drag state. Explicit Move up, Move down, and Move to
  controls preserve accessible ordering and reparenting. Foundation layouts
  expose labels but no editable dimensions, regions, responsive rules, raw JSON,
  CSS, or coordinates. Ordinary containers retain bounded Layout fields and
  nested regions. Containers expose structure; leaf nodes render one
  composition-aware surface without repeating descendant UI.
- Layout selection uses one HTTP/IPC preview operation and immediately updates
  the undoable draft. Expected-revision checks and canonical order report
  preserved, moved, and unassigned assets without persistence. An already-current
  legacy-flat UI reference may preview Minimal; v1/v2 references require the
  explicit Foundation upgrade first. Layout application materializes the current
  root and shell in memory while preserving historical assets and bindings.
  Reference profiles may add bounded current containers/actions, but bindings
  never imply containment. Exact catalog types place unmatched pages,
  components, features, and trusted slot-bearing facades in the compatible Add
  element modal as unassigned visual instances; policies, models, workflows,
  contracts, unknowns, and other nonvisual assets remain under System resources
  and logic in Layers. Only Save creates the next immutable revision.
- Canonical saved placement edges remain visible when a historical container's
  exact catalog definition is unavailable. Canvas exposes a bounded read-only
  structural region for those occupied edges so traversal does not stop, but it
  does not infer compatibility, allow insertion, change exact versions, or
  persist synthesized slots. Without exact geometry, regions use source-order
  auto-flow.
- System Builder Composer may project the complete exact current built-in
  Foundation catalog for a workspace with an older active trusted Foundation
  generation. This Composer-only seam supplies nested slots and qualified
  previews without widening the workspace Asset Library effective view.
- Catalog bootstrap reads schema-free structural summaries. The collapsible
  Layouts bar performs a bounded layout query only when opened. Add element
  performs a bounded exact-parent and region compatibility query only when its
  modal opens. Properties reads exact detail only for the selected asset, and
  Styling reads root detail only while active; stale responses cannot replace a
  newer selection. Full instance values stay in the canonical local draft.
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
- `npm run test:visual-composer` rebuilds the current packaged Windows worktree and qualifies it plus local Chrome against isolated stores and a dedicated test organization; it does not qualify physical assistive technology, other platforms, manual security review, or production performance.
- Persistence conformance uses 36 builds to check status, isolation, associations,
  conflicts, immutable releases, rollback, restart, and ordering through Electron
  SQLite. PostgreSQL is unqualified when its live test skips; 36 is not a maximum
  or SLO.
- Systems Manage uses one workspace-scoped draft/published/archived projection
  across API and IPC. It owns search/filter/sort/paging, exact-revision preview,
  Compose handoff, duplication, recoverable archive, and restore while retaining
  immutable history; Compose refreshes its active-only picker after changes.
- Compose shows edit-existing, create-new, and create-from-template forms without eager system or layout loads. Edit stages then loads; new uses Minimal; both creation flows require names. Loaded actions share a toolbar below the forms, and the catalog is requested only for an edit, creation, or Manage handoff.
- Separate `system-build` seams own attempts and releases. Guided preparation
  re-reads, validates, and resolves every implementation against the build's
  host-owned target; renderers cannot choose technical policy. Foundation 3.0 has
  exact trusted implementations/resources while immutable 1.0/2.0 remain. Publish
  confirms explicitly before approval re-verifies artifacts and derives identity.
- The controlled-chatbot template has no seeded transcript or default model. Its required message-composer picker lists sanitized compatible workspace models; one typed persisted-only `conversation-turn` binding connects composer to history. Authority re-resolves the exact model, the build lock records its revision digest, and runtime start never substitutes a caller-supplied or fallback model.
- Systems has Manage, Compose, and Publish; Compose Connections replaces the duplicate Plans page without removing planning contracts. Publish owns routine exact-release lifecycle controls and automatically opens a matching trusted declarative visual interface after Start. The bounded generic workflow catalog remains an unmounted advanced application boundary rather than a standalone Run & Test tab.
- The closed secured data-entry, controlled-chatbot, and secured data-review
  capabilities retain their separate authoritative records and use cases.
  Desktop and thin client expose them only through the shared
  `SystemRunWorkflow` presenter and application-owned profiles. Runtime schema,
  authorization, masking, protected instructions, optimistic writes, bounded
  previews, and redacted audit remain behind trusted boundaries; approval is
  not activation.
- The separate `system-deployment` family now owns organization/workspace-scoped
  install, activation, readiness, rollback, revocation, retained run history,
  uninstall, and redacted audit. One atomic current pointer exists per exact
  release and host target; retirement preserves earlier generations and
  restart-safe evidence. Desktop maps only trusted exact releases to its local
  adapter; managed server maps host-owned profiles. Thin client is control/read
  only, and imported/authored execution remains `sandbox-unavailable` without
  an independently qualified adapter.
- Routine Publish controls use `system-published-lifecycle`; renderers send only exact release, projected action, and opaque revision;
  application and host layers resolve all IDs and inject authority, profile,
  capabilities, secrets, egress, and policy. Install also activates. Running
  projects Stop only; active stopped projects Start, Deactivate, and Uninstall;
  inactive stopped projects Activate and Uninstall. Visual runs may return a
  bounded exact-release launch descriptor; Publish verifies the selected build,
  reads its exact revision, and renders trusted resources. Services have no UI.
- `system-run-workflow` is the shared application catalog over those distinct record families. Its inert bounded descriptors cannot carry policy or code; API/IPC inject authority at trusted boundaries, exact source identity is rechecked, and deployment dispatch uses stable runtime profile IDs with explicit legacy decoding.
- `dev-tools/config/asset-system-qualification.json` owns the versioned
  compatibility, deprecation, performance, admission, and profile evidence
  matrix. Deployment re-reads frozen implementation revocations before every
  privileged lifecycle transition; missing controlled/manual evidence keeps a
  profile incomplete.
- Operational diagnostics remain in `apps/desktop/src/renderer/features/settings/components/SoftwareStatusSection.tsx`.
- Deployment is never implied by the design-time editor or a successful build; it requires an explicit compatible install and readiness-verified activation.
- `docs/adr/ADR-0036-canonical-slot-composition-and-foundation-layouts.md`

## Canonical Source Docs

- `docs/architecture/system-builder.md`
- `docs/architecture/system-build-and-release.md`
- `docs/architecture/system-run-workflows.md`
- `docs/adr/ADR-0024-system-builder-area-and-software-status-placement.md`
- `docs/adr/ADR-0033-system-builds-releases-security-and-workflows.md`
- `docs/adr/ADR-0038-application-owned-system-run-workflows.md`
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
