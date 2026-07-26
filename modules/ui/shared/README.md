> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

- User-facing glossary hints live in `modules/ui/shared/glossary`; add or update entries when introducing novel form-field or detail-label terms.
- Keep glossary hint buttons off broad page headings and descriptive home-area cards. Use them beside form labels, filters, and compact detail rows where users need help understanding what to enter or read.
- Shared buttons use the centralized controls stylesheet. Keep primary and
  outline buttons flat and rounded. Outline actions must include both `ui-button`
  and `ui-button--outline`; the obsolete secondary modifier must not return. No
  button may use native appearance, grey fills, gradients, inset highlights,
  raised shadows, or hover translation.
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
  The shared Design surface has a collapsible Layouts bar, a wide full-hierarchy
  Canvas, and a details sidebar with fitted Properties, Styling, and Layers
  tabs. Configure identity, Collapse, breadcrumbs, protected-node actions,
  Connections mode, immediate local layout selection, and recursive preview are
  shared UI rather than host-specific reconstructions. Layout choices load only
  after the Layouts bar is opened. States regions start collapsed. Only the
  active Properties, Styling, or Layers body mounts, and presentation state is
  not persisted. Narrow layouts use focus-restoring panel controls. Systems
  keeps the Compose panel
  mounted while sibling tabs are active so its canonical draft and loaded catalog
  survive Manage and Build handoffs; other tab content remains lazy by default.
  Every exact slot-bearing Canvas container exposes Add element. It opens the
  shared modal scoped to that container, lets the user choose an available
  region, and requests bounded searchable compatible definitions and compatible
  unassigned visual instances. Results are grouped into labeled UI categories
  with a category filter directly below search. Selection maps to canonical add/place commands,
  closes the modal, selects the result, and reveals it on the Canvas. Layers
  retains explicit native move-destination and order controls. Do not restore a
  persistent Asset Palette, drag surfaces, or renderer drag state.
  The structural Composer catalog projects abstract source-ordered geometry for
  all slot-bearing assets so the Canvas never stops at an intermediate page,
  card, form, conversation, or trusted visual system facade. Do not render
  standalone catalog fixtures inside those containers: container nodes show
  their actual named regions and leaf nodes alone render their
  composition-aware semantic surface.
  If a saved historical container has canonical child placements but its exact
  catalog contract is unavailable, show those occupied edges through bounded
  read-only structural regions. Never infer compatibility or accept additions for
  that fallback, rewrite the exact instance version, or persist renderer-derived
  slots. Without exact geometry, preserve source-order auto-flow rather than
  assigning overlapping named grid areas.
  Fixed layout rows expand to show placed Canvas children without nested region
  scrollbars; the outer Canvas remains the single scrolling boundary. Never
  serialize selection, focus, disclosure, or panel state.
  Structured saves must preserve exact root references, structure, placements,
  configuration, and typed bindings. Do not infer a replacement root from visual
  order, accept arbitrary port names, or mix containment with bindings. A
  legacy-flat hierarchy may be materialized only by the application preview
  operation after an explicit layout selection or the closed-reference Minimal
  default request; the renderer must not synthesize or persist it directly.
  Foundation layout regions are fixed abstract container projections. Ordinary
  containers expose a shared Container layout summary and group schema-declared
  direction, spacing, padding, alignment, columns, wrap, and responsive controls
  under Layout. Do not add
  editable width, height, region, CSS, responsive-rule, or raw JSON controls.
  Layout selections go through the application preview client, immediately
  update the local undoable Canvas draft, and persist only through the normal
  immutable-revision save. Classify unmatched instances from exact catalog
  summaries: compatible visual instances appear only in an Add element modal;
  policies, models, workflows, contracts, unknowns, and other nonvisual assets
  remain selectable under System resources and logic in Layers.
  Structural catalog summaries include exact identity, ports, slots, geometry,
  availability, and compatibility but omit configuration schemas and defaults.
  Properties reads exact detail only for the current selection while active;
  Styling reads only the exact root detail while active. Ignore superseded
  responses. Candidate searches are exact-parent/region scoped and paged.
  Full instance configuration remains in the revision draft for preview,
  undo/redo, validation, and immutable save.
  Compose previews use the shared modal and recursively render current in-memory
  placements and configuration through registered side-effect-free System
  Foundation renderers. Keep node counts and viewport frames bounded, expose
  unsaved/unassigned/unsupported states truthfully, and never execute backend or
  unqualified implementation logic or imply release, activation, or deployment.
  Foundation v3 Properties exposes all declared content plus allowlisted
  per-asset style roles. Styling edits the system-root theme with native color
  pickers and bounded selects for typography, density, buttons, forms, and
  surfaces. Both use the canonical undoable draft and immutable-revision save
  path. Semantic style fields must not appear in Advanced JSON, and previews
  may project only stable data roles and generated CSS variables, never user
  CSS, selectors, or arbitrary dimensions.
  Foundation v1/v2-to-v3 upgrade remains an explicit preview and confirmation;
  never write during preview or discard unmapped configuration. Confirmation
  creates a new immutable revision and preserves the exact source revision.
  The Systems Manage surface must remain shared between desktop and thin client.
  Consume its workspace-scoped application projection instead of joining system
  records and releases in renderer code. Preserve native table semantics on wide
  screens and labeled card rows on narrow screens. Preview exact revisions in
  the shared modal; route edits into Compose; use canonical clone, archive, and
  restore commands. Describe delete as recoverable archive behavior and never
  imply that immutable revision or release history was erased. Keep Duplicate,
  archive, restore, and delete in Manage rather than duplicating them in Compose.
  The Compose system picker requests and displays active records only; archived
  records remain available in Manage for preview and restoration. Successful
  Manage lifecycle actions invalidate the mounted Compose picker without
  reinitializing an unrelated active draft.
  Keep its entry surface separated into semantic fieldsets for editing an active
  system, creating a named system with the default Minimal layout, and creating
  from a template. Both creation paths require explicit independent names and
  must not share hidden form-name state.
  The existing-system picker stages a choice; Edit system loads it, and preview,
  upgrade, build, and editor controls stay hidden until its revision is ready.
  Put the loaded-system actions in one toolbar immediately below all three forms,
  never inside an option fieldset. A direct Compose visit shows only these forms
  and must not request the Composer layout catalog. Request it only when Edit
  system, Create system, successful template creation, or an active Open in
  Compose handoff needs it.
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
- `npm run test:visual-composer` runs the shared one-worker Composer workflow
  against a freshly packaged Windows Electron application and local Chrome with
  isolated state and sanitized ignored evidence. Its pointer, keyboard-cancel,
  undo/redo, axe, 320-pixel reflow, forced-colors, and reduced-motion checks are
  automated regression evidence; they do not replace physical touch,
  assistive-technology, manual security, or other-platform qualification.
