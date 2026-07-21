# System Builder

- Status: current
- Related decisions: `docs/adr/ADR-0005-builder-core-platform-capabilities-and-user-composable-assets.md`, `docs/adr/ADR-0016-asset-kernel-terminology-and-architecture-baseline.md`, `docs/adr/ADR-0020-asset-composition-planning.md`, `docs/adr/ADR-0024-system-builder-area-and-software-status-placement.md`, `docs/adr/ADR-0033-system-builds-releases-security-and-workflows.md`, `docs/adr/ADR-0036-canonical-slot-composition-and-foundation-layouts.md`
- Verification: `docs/architecture/architecture-verification.md`

## Purpose

System Builder is the workspace-scoped product area where users construct systems by composing assets and larger asset compositions. It is not an application-health dashboard and must not become a second asset, planning, runtime, or execution architecture.

The repository implements the revision-safe CRUD and typed composition-editor
boundary accepted by ADR-0033 plus deterministic build attempts and immutable,
content-addressed system releases. A validated design revision is still not a
release, deployment, or running system: build and approval remain explicit
downstream actions.

## Canonical concepts

- **Composed system**: a user-buildable `system` or `system-of-subsystems` Asset Kernel composition.
- **System Builder record**: the workspace-owned design-time aggregate used to identify a composed system and track its construction lifecycle.
- **System composition**: an `AssetComposition` specialization containing system roots, asset instances, bindings, rules, dependencies, provenance, and validation summary.
- **Source composition plan**: an optional reference to the non-executing asset composition plan from which a System Builder record is derived.
- **Materialized system definition**: an optional future reference to a versioned system `AssetDefinition`; the initial contract does not materialize or publish one.
- **Asset slot definition**: an exact definition-owned, named, bounded child region with accepted child rules; slot array order is logical source order.
- **Asset placement**: the revision-owned ordered containment edge from one parent instance and named slot to one child instance. It is separate from typed data/event/control/resource/runtime/dependency bindings.
- **System profile**: an explicit interactive, service, or workflow construction policy. Interactive profiles require one Foundation-derived system root and approved shell/page structure.
- **Legacy-flat structure**: a historical revision with no structure descriptor and no placements. Reads classify it without synthesizing or persisting a hierarchy.
- **Software status**: builder-application, host, runtime, installer, and resource diagnostics. This belongs to Settings and is never part of a System Builder record.

## Contract and data-model baseline

`modules/contracts/system-builder` is the family barrel for the initial baseline:

```ts
SystemBuilderRecord {
  systemId
  targetWorkspaceId
  name
  description?
  status
  revision
  currentRevisionId?
  composition
  sourceCompositionPlanId?
  systemDefinitionRef?
  createdAt
  updatedAt
  createdBy
  updatedBy
  archivedAt?
}
```

Slot-aware revisions add a versioned `SystemBuilderStructure`, canonical
`AssetPlacement` records, and matching composition placement references. The
structure and placement schemas are bounded and transport-neutral. Unknown
schema versions, unsafe IDs, duplicate child parents or positions, self
placement, excessive counts, invalid cardinality, and invalid order fail closed.
The same revision may still contain `AssetBinding` records, whose connection
semantics remain distinct from containment.

Historical revisions omit both additions and remain immutable. A read reports
`legacy-flat`; it never invents placements or writes an upgrade.
An explicit predefined-layout selection is the migration boundary for a
legacy-flat draft: the application preview operation materializes the current
protected Foundation root, selected fixed-region shell, and required empty
layout content in memory, preserves every historical instance and binding, and
reports unmatched instances without discarding them. The shared UI uses each
instance's exact composer-catalog definition to separate unmatched visual assets
from nonvisual system resources and logic. For the three closed reference
templates, the same operation upgrades only instances with an exact current
Foundation definition and applies an explicit template-owned visual placement
profile. It may add bounded current Foundation containers and submit controls
needed for a usable visual composition, but it never reinterprets dependency
bindings as containment. The renderer does not synthesize this hierarchy, and
only the normal Save operation may persist it as a new immutable revision.
For backward compatibility, a workspace with any active trusted System
Foundation generation may discover the complete exact current built-in
Foundation definition catalog through System Builder Composer only. This
Composer-only compatibility seam supplies the slots and backing-program
availability needed to render and edit every migrated hierarchy level; it does
not activate or expose current-generation assets in the workspace Asset Library.
`SystemBuilderRevision` is an immutable snapshot containing the composition,
instances, bindings, safe validation issues, actor, and timestamp. Updating a
record requires the caller's expected record revision. Saving a composition
creates a new revision and advances the record atomically; an old revision is
never overwritten.

The composition field narrows the existing Asset Kernel `AssetComposition` to `system` or `system-of-subsystems`. It does not copy its instance, binding, rule, dependency, provenance, lifecycle, or validation vocabularies.

Design-time statuses are `draft`, `in-composition`, `blocked`, `ready-for-validation`, `validated`, and `archived`. These statuses describe construction progress only. They do not mean runtime-ready, execution-ready, healthy, installed, running, stopped, or failed software.

## Ownership and dependency boundaries

- System Builder records are workspace-owned and require explicit workspace identity at every future contract, client, transport, use-case, repository, and persistence seam.
- Asset Kernel definitions, instances, bindings, compositions, and references remain canonical component vocabulary.
- Asset composition planning remains the non-executing compatibility/planning input. A system record may reference a plan but must not mutate the plan or effective asset projections implicitly.
- Runtime readiness, execution plan preparation, and controlled execution remain downstream and separate.
- Software diagnostics must not be persisted into composed-system records or used as their lifecycle status.
- Future application behavior belongs behind focused ports and use cases; UI must not write local files or invent renderer-only system records.

## Product-area placement

**Systems** is a top-level, workspace-required destination. It owns system lists, revision-safe creation/editing, validation, builds, releases, and system-level Run & Test through explicit contracts and use cases. Surfaces must remain truthful while each operation is increment-gated.

General asset composition planning is presented in Systems / Plans as an
input-building workflow. System-specific assembly, record management, and
system-level Run & Test belong in Systems. Assets owns catalog, package import,
authoring, customization, and single-asset Studio workflows.

## Implemented composition boundary

- `modules/application/ports/system-builder` owns the repository seam.
- `modules/adapters/persistence/system-builder` uses structured document stores,
  so local SQLite and managed PostgreSQL receive the same semantics.
- `modules/application/use-cases/system-builder` owns revision-safe lifecycle
  commands; adapters and UI do not invent system truth.
- `ValidateSystemBuilderRevisionService` resolves exact definitions and composes
  canonical Asset Kernel validators with system endpoint, cardinality, and
  dependency-cycle checks. Slot validation additionally requires one exact or
  provenance-derived `builtin.system.system@3.0.0` root for interactive
  revisions, declared slot membership, compatible children, complete placement
  coverage, bounded depth, and acyclic containment.
- New interactive systems start with the Foundation v3 system root, one required
  selected application layout, its required page hosts, a page layout, and
  bounded empty content. When a caller does not choose an application layout,
  the canonical default is `builtin.layout.application.minimal@3.0.0`. Service
  and workflow profiles remain explicit and are not assigned an interactive
  hierarchy.
- Structured persistence clones the complete revision, including structure and
  placements, and preserves workspace isolation plus optimistic conflicts. API,
  IPC, preload, desktop/thin clients, and the shared editor forward those fields
  without deriving a replacement root. Historical flat revisions continue to
  round-trip with both fields omitted.
- `modules/adapters/transport/api-express/system-builder` and
  `modules/adapters/transport/ipc-electron/system-builder` expose the same
  operations. API reads require `asset:read`; mutations require `asset:write`.
- The workspace-scoped composer read model resolves exact effective definitions,
  configuration schemas/defaults, declared ports and slots, preview/implementation
  availability, abstract geometry for every slot-bearing container, and server-owned slot
  compatibility for both desktop and thin client. Foundation layout geometry is
  an abstract projection of approved named regions; renderers do not reconstruct
  compatibility or accept author-defined dimensions from Asset Library summaries.
  Foundation v3 audits every frontend-backed definition so each renderer-owned
  content value is schema-declared or explicitly classified as fixed structural
  preview copy. Its system root owns bounded semantic theme tokens for colors,
  typography, density, buttons, forms, and surfaces; relevant visual assets own
  allowlisted semantic overrides. Exact v1 and v2 definitions remain unchanged.
- `modules/ui/shared/system-builder` is the shared desktop/thin-client editor.
  Predefined geometry-aware layout icons inside the Asset Palette create or
  remap the required root/shell/page-host structure. One
  canonical in-memory draft drives a flat three-column Design workspace with the
  searchable Asset Palette, a wide Canvas showing every fixed region of the
  active application layout, and one details
  sidebar whose accessible tabs switch between Properties, Styling, and Layers
  and Structure. The Asset Palette has collapsed, normal, and maximized presentation
  sizes. Normal presents layout choices and asset tiles in one column; maximized
  borrows width from the Canvas and uses multi-column galleries while preserving
  the details-sidebar width. Its Layout, Assets, Unassigned visual assets, and
  System resources and logic sections are independent disclosures that start
  collapsed. Canvas States regions also start collapsed without removing their
  drop surfaces, and Layers and Structure contains only the placed hierarchy.
  These presentation states are not persisted. A thin
  dnd-kit adapter maps pointer,
  touch, and keyboard insertion/reorder/reparent interactions onto bounded
  add/place commands; each square visual asset tile is the drag handle and fixed
  regions are the drop surfaces. The Design workspace does not expose the legacy
  choose-slot, Add-here, move-order, reparent, or wrapper forms. Drag state is
  never serialized. Selection, breadcrumbs, protected required nodes, responsive
  panel focus restoration, and bounded undo/redo remain synchronized across
  regions. Every exact slot-bearing container recursively exposes its named
  regions and placed descendants on the Canvas. Trusted Foundation system or
  subsystem facades with a qualified declarative preview participate as visual
  containers; ordinary policies, models, workflows, and backend resources do
  not. Canvas container nodes render only their structural identity and actual
  named child regions; they never repeat the complete standalone catalog preview.
  Only leaf nodes render their own composition-aware semantic surface, so each
  visible detail is contributed by one asset in the hierarchy.
- Opening a closed legacy-flat UI reference system invokes the same application
  layout-preview operation with the Minimal default and presents the result as
  an unsaved draft. The renderer does not synthesize or persist structure on its
  own; historical storage changes only through the normal validated save path.
- Properties generates Design, Data, and Events sections from exact schemas, applies
  defaults and field constraints, offers approved asset/reference choices, and
  retains a bounded Advanced JSON fallback for ordinary non-style fields.
  Semantic style fields are excluded from that fallback. Foundation v3
  conversation titles, labels, sample content, placeholders, descriptions, and
  accessibility text are ordinary declared Properties. The adjacent Styling
  tab always edits the canonical system-root instance rather than the current
  child selection. It renders colors as native color pickers and typography,
  density, button, form, and surface choices as allowlisted selects. Relevant
  per-asset overrides remain bounded selects in Properties. Both paths commit
  through the same local draft history and immutable-revision save. Slot-bearing
  containers expose a common Container layout summary, and their declared
  direction, spacing, padding, alignment, columns, wrapping, and responsive
  fields are grouped under Layout. System Foundation
  layout containers expose only their declared semantic fields: width, height,
  regions, responsive rules, raw JSON, arbitrary CSS, and grid coordinates remain
  locked. Connections accepts only declared,
  contract-compatible source and target ports; typed bindings remain separate
  from containment.
- Changing an existing application layout calls the workspace-scoped
  `PreviewSystemBuilderLayoutChangeUseCase` through parity HTTP and IPC paths.
  The operation checks the expected record revision, maps direct shell children in
  canonical source order, returns preserved/moved/unassigned dispositions and
  bounded validation issues, and does not persist. A successful selection
  immediately commits the returned structure, instances, bindings, and placements
  to the local draft history, where undo/redo includes the layout descriptor.
  Unassigned visual assets remain selectable and removable at the bottom of the
  Asset Palette rather than on the
  Canvas, and are reattachable by dragging them to compatible Canvas regions.
  Trusted Foundation system/subsystem facades with declared slots and a
  qualified declarative preview remain draggable visual containers. Nonvisual
  policies, models, workflows, data contracts, and other system
  resources appear separately under System resources and logic. They remain
  selectable for Properties or Connections but are never presented as Canvas
  drag sources. Missing exact catalog metadata fails closed into the nonvisual
  group.
  Save remains a separate optimistic command that creates a new immutable revision.
- Compose provides a design-time UI preview of the current unsaved hierarchy and
  configuration. The shared modal recursively follows canonical placement and
  canonical region order, reports unplaced visual, nonvisual resource, and
  unsupported asset states truthfully, and offers
  bounded desktop/tablet/mobile frames. Exact-version backing programs select
  side-effect-free semantic renderers for layouts, structural containers, forms,
  display surfaces, states, conversations, and bounded artifact previews.
  Container slots render their actual nested children; alternative error/loading
  states and preview variants do not all appear simultaneously when primary
  content is available. Backend or unqualified imported/authored implementation
  logic remains unexecuted. The v3 root preview projects validated colors into
  inherited CSS custom properties and bounded choices into stable semantic data
  roles. Descendants may override only their declared surface, text, typography,
  spacing, border, button, form, and control-size roles. No arbitrary CSS source,
  selector, or numeric layout value crosses this boundary. Preview grants no
  build, release, activation, or
  deployment authority. Hand-authored semantic HTML mockups for all three closed
  reference systems are permanent test oracles: normalization ignores runtime
  trace IDs and styling attributes but preserves meaningful elements, nesting,
  labels, controls, states, and text.
- The one-worker visual Composer qualification harness drives the same shared
  workflow through a freshly packaged Windows Electron preload/IPC boundary and
  a local Chrome thin-client/API boundary. Every run uses isolated desktop data,
  server storage, and runtime roots and emits bounded sanitized evidence under
  ignored `artifacts/qualification/visual-composer`. Automated input,
  accessibility, reflow, and recovery checks remain scoped regression evidence;
  they do not qualify another operating system, browser, physical touch device,
  screen reader, manual security review, or production performance profile.
- Compose exposes a shared Build & test handoff in both hosts. The handoff is
  disabled for dirty or archived systems and opens the existing Build & Release
  workflow for the selected saved system; it does not build from renderer state or
  combine design validation with release/runtime authority.
- Systems Manage is the workspace-scoped operational index for draft, published,
  and archived system records. Its application-owned projection supplies search,
  lifecycle filters, deterministic ordering, bounded pagination, latest-revision
  summaries, and exact published-release identity through API and IPC parity.
  Both hosts share the same responsive list and actions: preview an exact
  revision, hand off to Compose, duplicate through the canonical clone command,
  archive through the existing archive-backed delete command, and restore.
  Archive is disclosed as recoverable; immutable revisions and releases are
  retained rather than destructively removed.
- `modules/contracts/system-build`, `modules/application/use-cases/system-build`,
  and the matching persistence/storage/transport adapters own deterministic
  attempts and immutable releases without adding runtime state to system
  records.
- Systems / Build & Release freezes an exact revision and deployment profile,
  exposes safe diagnostics and evidence, and requires an explicit integrity-
  verified approval before a release exists.

**Settings / Software status** owns:

- desktop host and feature-lifecycle diagnostics;
- Python runtime status and explicit controls;
- ComfyUI install status and repair controls;
- builder-application resource and readiness diagnostics.

Opening Systems must never trigger these operational reads. Opening Settings or Software status must not create, mutate, validate, or execute a composed system.

## Secured data-entry reference execution

Increment 7 adds one closed, versioned reference template,
`reference.secured-data-entry@1.0.0`. Template creation atomically persists the
system record and its first immutable revision; it does not bypass Asset Kernel
validation or create runtime state.

The corresponding `system-data` application family runs only from one
integrity-verified manifest belonging to an approved release. It fails closed
when the release, manifest, authentication declaration, audit declaration,
field mask, entity, operation, workflow, form, or narrowing role policy is
missing, duplicated, malformed, or bound to another entity. The trusted
application layer allowlists fields and values, enforces action policy, masks
protected fields, bounds reads, and atomically commits optimistic record writes
with append-only redacted audit entries.

Desktop and thin-client Systems pages share the same native-control Run & Test
presenter. API identity comes from authenticated request context, desktop IPC
uses its explicit local trusted principal, and neither renderer can select or
broaden the effective principal. This is a finite built-in release runtime, not
authorization for arbitrary release code, deployment activation, or a second
data/policy architecture.

## Controlled chatbot reference system

Increment 8 adds the closed `reference.controlled-chatbot@1.0.0` template. It
atomically creates and validates a 31-instance Asset Kernel composition using
exact-version shell, conversation, model/context, protected instruction,
bounded generation, narrowing policy, audit, controlled inference, fallback,
and complete-state assets. The template does not create a provider client,
runtime session, execution plan, deployment, or activation.

The existing deterministic build and approval families produce its immutable
release. Systems Run & Test remains a distinct downstream workflow: desktop and
thin client use the same shared presenter, list actual execution plans, and
create an approval-gated conversation session through the existing controlled
conversation clients. Protected instruction values remain behind application
configuration/context boundaries and are absent from public build summaries,
approval results, operational diagnostics, and session summaries. Tools,
retrieval, memory, multimodal IO, streaming, cancel, and retry are not implied.

## Secured data-review reference system

Increment 9 adds the closed `reference.secured-data-review@1.0.0` template and
the release-bound `system-review` application family. The template composes
exact-version shell, artifact browser/filter/detail, masking, audit,
authentication, finite workflow, and explicit text/table/raster-image/PDF/
unsupported preview assets without embedding stored files in Asset Kernel
definitions.

Runtime policy is derived only from one integrity-verified approved release.
The trusted application layer enforces workspace ownership, authenticated
narrowing roles, opaque artifact references, metadata masking, bounded list and
preview quotas, conservative content classification, and redacted audit. The
shared desktop/thin-client Run & Test presenter consumes those safe read models;
it cannot choose a principal, reveal host paths/provider payloads, or turn a
successful build into deployment authority. SVG and Office content remain
unsupported, and malformed, oversized, unavailable, or unauthorized reads fail
closed with safe states.

## Remaining increment-gated gaps

- independent qualified rebuild and higher assurance claims;
- qualified imported/authored execution sandboxes and portable standalone packaging;
- collaboration, permissions, import/export, marketplace, and deployment synchronization.

## Multi-shape deployment handoff

`modules/contracts/system-deployment` and its application, persistence,
runtime, transport, and shared UI families keep operational state separate from
System Builder designs and immutable releases. Install re-verifies release
artifacts and manifest classification, checks the frozen deployment profile,
host API/runtime ABI, implementation trust/runtime facts, required host
capabilities, and sandbox qualification before calling a runtime adapter.

Desktop owns `local-desktop`; server maps campus/corporate to `campus-server`
and cloud to `cloud-server`. The trusted adapter recognizes only the three
closed reference-system kinds and returns a bounded release-bound handoff. Thin
client can install, activate, inspect health/history, roll back, revoke, and
request a server run through authenticated HTTP, but it never receives local
runtime, filesystem, secret, capability, sandbox, organization, or principal
authority. The shared `SystemDeploymentWorkflow` presents these truthful
states in both hosts.

Policy is deny-by-default and can only narrow platform ceilings. Capability,
opaque secret-reference, HTTPS-origin egress, duration, memory, output, and
concurrency checks run before runtime invocation. Activation/readiness failure,
interruption, cancellation, rollback, and revocation preserve explicit safe
state and bounded redacted audit. Imported/authored execution returns
`deployment.sandbox-unavailable` unless a separately qualified adapter is
injected; the managed runner template is operator evidence, not sandbox proof.

Build/release support must not be inferred from design validation, and a release
must not be treated as deployed or running. See
`docs/architecture/system-build-and-release.md`.
