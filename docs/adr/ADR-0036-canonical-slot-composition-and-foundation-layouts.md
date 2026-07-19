# ADR-0036: Canonical Slot Composition and Foundation Layouts

- Status: accepted
- Date: 2026-07-18
- Deciders: ai-system-builder maintainers
- Related: ADR-0016, ADR-0024, ADR-0030, ADR-0033, ADR-0034, `docs/architecture/system-builder.md`

## Context

System Builder revisions currently preserve a flat ordered instance list. That
cannot express that one asset contains another in a named region, cannot enforce
an interactive system shell, and leaves renderers to infer structure. Typed
`AssetBinding` records already own data, event, control, resource, runtime,
adapter, and dependency connections; overloading them with visual containment
would mix distinct semantics.

Interactive layout also needs responsive defaults without exposing arbitrary
dimensions, CSS, or grid coordinates. Existing `system.foundation@1.0.0`
references and backing resources are immutable and must continue to resolve.

## Decision

- `AssetSlotDefinition` declares versioned, named, bounded child regions on an
  exact asset definition. Slot IDs are stable logical identifiers such as
  `start-sidebar`, `content`, and `end-panel`; visual left/right placement is a
  renderer concern.
- `AssetPlacement` is the canonical ordered parent-instance, slot, and
  child-instance containment edge. Placements are revision-owned Asset Kernel
  data and may be referenced by `AssetComposition`. They do not replace or
  specialize `AssetBinding`.
- Slot and placement schemas are closed and versioned. Normalization rejects
  unsafe identifiers, unknown schema versions, excessive counts, duplicate
  parents or positions, invalid cardinality/order, and self-placement. System
  validation additionally owns membership, compatibility, cycle, and depth
  checks with bounded diagnostics.
- Slot-aware System Builder revisions declare an explicit profile and structure
  schema. An omitted descriptor plus omitted placements is classified as
  `legacy-flat` on read. Reading never synthesizes placements or writes a
  migration.
- Interactive revisions require exactly one exact or explicitly derived
  `builtin.system.system` root and the required application-shell and page-host
  placements. Service and workflow profiles remain explicit and do not acquire
  renderer structure by inference.
- `system.foundation@2.0.0` is a complete immutable release parallel to 1.0.0.
  It provides eight approved application-shell presets and bounded page-layout
  presets using exact direction-neutral slots, closed responsive tokens,
  accessible source order, preview fixtures, and complete trusted backing
  resources.
- Users select predefined layouts; they do not create slots, dimensions, raw
  CSS, or arbitrary grid coordinates. Layout switching is an explicit later
  migration operation and may not discard unmatched children silently.
- Persistence, API, Electron IPC/preload, desktop, and thin-client clients carry
  the same structure and placement contracts. The renderer never owns a second
  hierarchy.

## Consequences

### Positive

- Containment is deterministic, portable, testable, and independent of a
  renderer or drag-and-drop library.
- Responsive presentation can change while logical source and keyboard order
  remains stable.
- Typed connections and visual/semantic containment remain separately
  understandable.
- Historical revisions and System Foundation 1.0.0 remain immutable and
  readable.

### Negative

- Foundation manifests, installers, backing resources, validators, builders,
  and clients must become exact-version aware.
- Moving an instance requires placement validation and may surface an unassigned
  state during later explicit layout migration.
- Arbitrary freeform layout is intentionally unavailable.

## Non-goals

- No renderer-only hierarchy, arbitrary code, CSS, dimensions, or user-authored
  slots.
- No legacy mutation, reference-template migration, canvas, drag and drop,
  collaboration, marketplace, or new runtime/deployment authority in this
  decision alone.
