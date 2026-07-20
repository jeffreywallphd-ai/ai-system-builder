> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

- User-facing glossary hints live in `modules/ui/shared/glossary`; add or update entries when introducing novel form-field or detail-label terms.
- Keep glossary hint buttons off broad page headings and descriptive home-area cards. Use them beside form labels, filters, and compact detail rows where users need help understanding what to enter or read.
- Artifact preview UI lives in `modules/ui/shared/artifact-preview`. Keep previews sampled and bounded: text-like previews should show only a small first-page-sized sample, image previews should prefer compressed/downscaled object URLs, video/PDF previews should be visually constrained, and full-fidelity viewing should remain a download action. Office document and spreadsheet previews should stay placeholder-only until a safe parser is added.
- Modal headers should stay fixed at the top of the modal, use a darker header background than the body, place the clear modal title on the left, and place the red square close button on the right. Put scrollable content inside the modal body region so only the body scrolls when needed. When one modal opens from another, use the stacked modal overlay class so the newest modal is visually on top.
- Import Assets UI lives in `modules/ui/shared/asset-package`. Keep the starter
  deterministic and contract-owned, perform its Blob download locally, keep file
  reading in the surface client, put package parsing and trust decisions behind
  application use cases, require exact capability consent, and reuse the shared
  ordered-workflow surface in desktop and thin clients.
- Functional system-default previews live in `modules/ui/shared/foundation-assets`.
  They consume the closed data-only functional catalog, remain side-effect
  free, and never accept definition-provided components or source.
- The shared System Builder editor lives in `modules/ui/shared/system-builder`.
  Keep system records and immutable revision state behind its client interface;
  both desktop and thin-client surfaces must use the workspace-scoped exact
  composer catalog and the same draft, validation, history, and save semantics.
  The geometry-aware Layout chooser within the Asset Palette, compatible square
  visual-asset tiles, full active-layout Canvas, tabbed Properties
  and Layers and Structure details sidebar, breadcrumbs, protected-node actions,
  Connections mode, immediate local layout selection, and recursive preview are shared UI
  rather than host-specific reconstructions. The wide layout reserves its largest
  region for the canvas and lets both sidebars collapse to compact rails; narrow
  layouts use focus-restoring panel controls.
  Each asset tile is the pointer, touch, and keyboard drag handle, and fixed
  layout regions are the drop surfaces. Keep the legacy Add-here, move-order,
  reparent, and wrapper forms out of the Design workspace; the drag adapter maps
  interactions to the canonical add/place operations.
  Never serialize drag, selection, focus, zoom, or panel state.
  Structured saves must preserve exact root references, structure, placements,
  configuration, and typed bindings. Do not infer a replacement root from visual
  order, accept arbitrary port names, or mix containment with bindings. A
  legacy-flat hierarchy may be materialized only by the application preview
  operation after an explicit layout selection; the renderer must not synthesize
  it.
  Foundation layout regions are fixed abstract container projections. Do not add
  editable width, height, region, CSS, responsive-rule, or raw JSON controls.
  Layout selections go through the application preview client, immediately
  update the local undoable Canvas draft, retain unmatched instances in
  Unassigned at the bottom of the Asset Palette rather than on the Canvas,
  remain undoable, and persist only through the normal immutable-revision save.
  Compose previews use the shared modal and recursively render current in-memory
  placements and configuration through registered side-effect-free System
  Foundation renderers. Keep node counts and viewport frames bounded, expose
  unsaved/unassigned/unsupported states truthfully, and never execute backend or
  unqualified implementation logic or imply release, activation, or deployment.
  The Systems Manage surface must remain shared between desktop and thin client.
  Consume its workspace-scoped application projection instead of joining system
  records and releases in renderer code. Preserve native table semantics on wide
  screens and labeled card rows on narrow screens. Preview exact revisions in
  the shared modal; route edits into Compose; use canonical clone, archive, and
  restore commands. Describe delete as recoverable archive behavior and never
  imply that immutable revision or release history was erased.
- The shared System Builder Build & Release workflow lives beside the editor in
  `modules/ui/shared/system-builder`. Keep exact revision selection, deployment
  profile, build diagnostics/evidence, approval, immutable release history, and
  comparison semantics in this shared presenter. Host clients may translate
  transport envelopes only; they must not generate releases or bypass artifact
  verification in the renderer.
- The shared `SystemDataRunTest` presenter consumes only an approved release
  descriptor and narrow CRUD/audit client. It renders native labeled controls,
  summary plus field errors, bounded lists, explicit masked values, optimistic
  conflicts, and safe audit evidence identically in desktop and thin client.
  Authorization, schema validation, masking, and audit decisions remain in the
  trusted application layer.
- The shared `ConversationRunTest` presenter consumes actual execution-plan
  summaries plus the controlled conversation client. Keep execution-plan
  identity intact, use application-projected actions/availability, bound
  message and transcript rendering, preserve the accessible live log, and show
  unsupported capabilities truthfully. It must not accept composition-plan ids,
  expose protected instruction/provider payloads, or call a provider directly.
- The shared `SystemReviewRunTest` presenter consumes one approved release and
  the narrow release-bound review client. Keep release selection, bounded native
  name filtering, masked detail, shared artifact previews, safe audit evidence,
  empty/loading/failure states, and object-URL cleanup identical in desktop and
  thin client. It must not accept caller-selected principals, expose paths or
  provider payloads, parse content in host surfaces, or turn unsupported types
  into embedded active content.
- The shared `SystemDeploymentWorkflow` consumes approved-release summaries and
  the narrow deployment lifecycle client. Keep install, compatibility,
  activation/readiness, rollback, revocation, bounded run history, and safe
  audit states identical in desktop and thin client. The thin surface must say
  that execution remains server-owned; renderers must never supply principal,
  organization, host capabilities, runtime ABI, sandbox qualification, paths,
  credentials, or raw runtime output.
- Automated semantic tests for these shared asset/system presenters are
  regression evidence, not a WCAG conformance claim. Each supported desktop and
  thin-client profile still requires the keyboard, focus, zoom/reflow,
  contrast, screen-reader, status, and error review in
  `docs/operations/asset-system-support-qualification.md`.
