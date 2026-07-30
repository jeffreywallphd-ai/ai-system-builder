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
templates, the same operation updates the required system root and applies an
explicit template-owned visual placement profile while preserving the exact
versions of other historical instances. It may add bounded current Foundation
containers and submit controls
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

Foundation v1/v2-to-v3 migration is a separate explicit preview-and-confirm
operation over parity API and IPC contracts. Preview performs no writes;
confirmation requires the exact source revision, maps only declared v3 fields
and exact Foundation references, revalidates the candidate, and atomically
creates a new immutable revision while retaining the exact source history. Missing target
definitions, mixed unsupported Foundation versions, stale revisions, unknown
configuration fields, or validation errors block confirmation rather than
silently discarding data.

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

Systems does not expose a separate Plans page. System-specific structure and
typed relationships are edited directly through Compose and its Connections
surface. This removes a duplicate user workflow; it does not remove or redefine
the lower-level asset-composition planning contracts used by controlled
application behavior. System record management, publication, and system-level
Run & Test remain in Systems. Assets owns catalog, package import, authoring,
customization, and single-asset Studio workflows.

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
  One canonical in-memory draft drives a two-column Design workspace: a wide
  Canvas showing the complete active hierarchy and one details sidebar with
  fitted Properties, Styling, and Layers tabs. Predefined geometry-aware layout
  choices live in a collapsible bar below Design and Connections and load only
  after that bar is opened. States regions start collapsed. Only the active
  details panel body mounts, and disclosure, selection, focus, and panel state
  are not persisted.
  Every exact slot-bearing Canvas container recursively exposes its named
  regions, placed descendants, and Add element action. Add element opens the
  shared modal scoped to that exact parent. The user chooses an available region
  when needed, searches bounded paged compatible candidates, and selects either
  a new definition or compatible unassigned visual instance. The choice maps to
  the existing canonical add/place command, closes the modal, selects the
  result, and reveals it on the Canvas. Layers retain explicit native
  destination and order controls for reparenting and reorder. There is no
  persistent Asset Palette, pointer drag behavior, or renderer drag state.
  Trusted Foundation system/subsystem facades with a qualified declarative
  preview participate as visual containers; ordinary policies, models,
  workflows, and backend resources do not. Canvas container nodes render only
  structural identity and actual named child regions; leaf nodes alone render
  their composition-aware semantic surface. Canonical placements remain visible
  when a historical container's exact catalog contract is unavailable: the
  Canvas derives occupied region labels as read-only traversal surfaces. It does
  not infer compatibility, accept additions, rewrite exact versions, or persist
  synthesized slot definitions. Without exact geometry, those regions remain in
  source-order auto-flow. Fixed rows preserve abstract proportions as minimums
  but expand for descendants, leaving the Canvas as the sole scroll boundary.
- An already-current closed legacy-flat UI reference system may invoke the same
  application layout-preview operation with the Minimal default and present the
  result as an unsaved draft. A reference containing v1 or v2 Foundation assets
  must use the explicit upgrade first; layout selection cannot materialize a
  mixed invalid hierarchy. The renderer does not synthesize or persist structure
  on its own; historical storage changes only through validated save or upgrade.
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
  Unassigned visual assets remain off the Canvas and appear only as compatible
  choices in an occupied container's Add element modal. Nonvisual policies,
  models, workflows, data contracts, and other system resources appear
  separately in the Layers view under System resources and logic. Missing exact
  catalog metadata fails closed into that nonvisual group. Save remains a
  separate optimistic command that creates a new immutable revision.
- Composer startup reads structural catalog summaries that omit configuration
  schemas and defaults. Opening Layouts performs its bounded layout query on
  demand. Opening Add element performs a region-scoped compatibility query and
  presents bounded, searchable pages of new definitions and compatible
  unassigned visual instances. Properties reads exact detail only for the
  selected asset. Candidate summaries carry only a lightweight category ID so
  the modal can group and filter results without loading editable metadata.
  Styling reads exact detail only for the system root while that tab is active. Responses are scoped to their initiating selection so stale
  requests cannot replace current detail. Full revision instance values remain
  in the local draft for preview, undo, redo, and save.
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
  disabled for dirty or archived systems and opens a focused modal for the exact
  selected saved revision. An application preparation use case re-reads that
  revision, checks current/active/validation state, verifies that every part has
  a supported implementation at the host-owned target, and supplies that target
  policy. The renderer cannot choose deployment profile, capability,
  trust, ABI, or toolchain policy. The modal reports plain-language readiness and
  bounded results; it does not build from renderer state, publish, install,
  activate, or combine design validation with runtime authority.
- Compose presents three explicit semantic entry groups: edit an active existing
  system, create a named blank system with the required default Minimal layout,
  or create from a validated template. The two creation groups keep independent
  required name state. Selecting an existing record only stages it; the Edit
  system action loads its revision, after which preview, upgrade, build, and
  editor controls appear. Loaded-system actions share one toolbar below all three
  entry forms rather than appearing inside an option fieldset. A direct Compose
  visit does not select the first record, request the Composer layout catalog, or
  mount the editor. The catalog is requested only by Edit system, Create system,
  successful template creation, or an active-system Open in Compose handoff. The
  editor appears only after the selected revision is loaded or a creation
  succeeds.
- Systems Manage is the workspace-scoped operational index for draft, published,
  and archived system records. Its application-owned projection supplies search,
  lifecycle filters, deterministic ordering, bounded pagination, latest-revision
  summaries, and exact published-release identity through API and IPC parity.
  Both hosts share the same responsive list and actions: preview an exact
  revision, hand off to Compose, duplicate through the canonical clone command,
  archive through the existing archive-backed delete command, and restore.
  Archive is disclosed as recoverable; immutable revisions and releases are
  retained rather than destructively removed. Compose requests and displays only
  active systems; archived records remain available through Manage for preview
  and restoration. Successful Manage lifecycle changes refresh the mounted
  Compose active-system index without reinitializing unrelated active editor
  state. Compose does not duplicate, archive, restore, or delete systems; those
  record-management actions remain in Manage.
- `modules/contracts/system-build`, `modules/application/use-cases/system-build`,
  and the matching persistence/storage/transport adapters own deterministic
  attempts and immutable releases without adding runtime state to system
  records.
- Systems / Publish uses an application-owned workspace projection of active
  systems and their build versions. It defaults to a ready build where one
  exists, distinguishes unavailable and already-published builds, and requires
  an explicit confirmation naming the system and build. The existing release
  use case re-verifies the expected lock digest and every artifact before an
  immutable release exists. Publish does not install, activate, deploy, or run a
  system, and transport errors remain bounded rather than exposing storage,
  provider, command, environment, or stack details.
- Controlled support evidence for this lifecycle is intentionally
  environment-specific. Packaged Windows Electron and local Chrome exercise the
  real host boundaries; Electron SQLite exercises representative 36-build
  history, conflicts, immutable releases, rollback, restart, backup, and
  restore. Live PostgreSQL parity remains unqualified whenever
  `TEST_POSTGRES_URL` is absent or its test is skipped. See
  [System Build and Release](system-build-and-release.md#qualification-limits-and-recovery)
  and [Persistence Operations](../operations/persistence-operations.md).

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

Desktop and thin-client Systems pages share the application-owned Run & Test
workflow boundary in `docs/architecture/system-run-workflows.md`. API identity
comes from authenticated request context, desktop IPC uses its explicit local
trusted principal, and neither renderer can select or broaden the effective
principal. Finite handlers adapt the existing release-bound data, review,
conversation, and deployment use cases; this is not authorization for arbitrary
release code or a second data/policy architecture.

## Controlled chatbot reference system

Increment 8 adds the closed `reference.controlled-chatbot@1.0.0` template. It
atomically creates an Asset Kernel composition using
exact-version shell, conversation, model/context, protected instruction,
bounded generation, narrowing policy, audit, controlled inference, fallback,
and complete-state assets. The template deliberately contains no default model
record and no example transcript. Its first revision therefore remains blocked
until the user selects one compatible workspace model through the required
message-composer resource picker. The template does not create a provider
client, runtime session, execution plan, deployment, or activation.

One typed `conversation-turn` control binding connects the message composer to
the message-history display with `persisted-only` transcript semantics. The
binding is composition data rather than executable asset code. Composer model
options are a sanitized application projection; Advanced JSON cannot replace
the selected model resource and renderers cannot submit a provider, path, or
free-form model identifier.

An explicit Foundation 1.x/2.x-to-3.x upgrade may persist the structurally
mapped revision when missing model selection is its only validation blocker,
but the resulting system remains `blocked` until the user selects and saves an
authorized model. Other mapping or validation failures still prevent upgrade.

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
authority. The shared `SystemRunWorkflow` presents deployment together with
other supported application-owned profiles through the same bounded, ordered
Run & Test experience in both hosts.

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
