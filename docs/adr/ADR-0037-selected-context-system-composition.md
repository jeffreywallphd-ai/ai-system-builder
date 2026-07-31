# ADR-0037: Selected-Context System Composition

- Status: accepted
- Date: 2026-07-25
- Deciders: ai-system-builder maintainers
- Related: ADR-0024, ADR-0033, ADR-0036, `docs/architecture/system-builder.md`

## Context

The first visual Composer exposed a persistent Asset Palette and recursively
registered every eligible Canvas node as a pointer, touch, and keyboard drag
surface. It also loaded property schemas and defaults with the structural
catalog. Large reference systems therefore paid interaction and data costs for
controls that were not in use, while the Palette reduced the space available to
inspect the composed hierarchy.

Canonical `AssetPlacement` records already model insertion, ordering, and
reparenting independently of a renderer or interaction library. The interaction
model can change without changing persisted revisions.

## Decision

- The Design workspace reserves its persistent columns for the Canvas and one
  details sidebar. Application layouts live in a collapsible bar below the
  Design and Connections tabs and are requested only when that bar is opened.
- Every exact slot-bearing Canvas container exposes an **Add element** action.
  It opens the shared accessible modal scoped to that container. When multiple
  regions are available, the user selects one before choosing an element.
- The modal requests a bounded, searchable, paged compatibility projection for
  the exact parent definition and region. It presents both new compatible
  definitions and compatible unassigned visual instances. New definitions are
  grouped into stable user-facing categories and can be filtered by category
  beneath search. Choosing an item performs the existing canonical add or place
  command, closes the modal, selects the resulting instance, and reveals it on
  the Canvas.
- Reparenting and ordering remain explicit native controls in Layers. Pointer
  dragging, renderer drag state, and drag-library dependencies are removed.
- Composer catalog list items are structural summaries. They include exact
  identity, classification, ports, slots, layout geometry, availability, and
  compatibility, but omit configuration schemas and default configuration.
- A separate workspace-scoped exact-detail read returns the configuration
  schema and defaults for one exact definition. Properties requests detail only
  for the currently selected instance while the Properties tab is active.
  Styling requests only the exact system-root detail while Styling is active.
  Superseded responses must not replace the current selection.
- Current instance configuration remains in the complete in-memory revision.
  Preview, undo/redo, validation, and immutable save continue to use those full
  values; lazy detail loading changes editor metadata, not revision data.
- HTTP, Electron IPC/preload, desktop, and thin-client clients expose the same
  list and exact-detail operations. Authorization, bounded errors, and
  workspace isolation remain application/transport responsibilities.

## Consequences

### Positive

- Canvas width is no longer permanently consumed by asset discovery.
- Large hierarchies avoid drag registrations and eager property-schema payloads.
- Compatibility stays server-owned and exact-version aware.
- The same canonical placement commands remain accessible without dragging.

### Negative

- Adding an element requires opening a modal instead of one drag gesture.
- The UI owns loading, empty, failure, pagination, focus restoration, and stale
  response states for layouts, candidates, and exact details.
- List consumers that need editable schemas must use the exact-detail read.

## Non-goals

- No change to slot, placement, binding, revision, validation, or persistence
  semantics.
- No renderer-authored slots, arbitrary dimensions, raw CSS, or implementation
  execution.
- No claim that lazy editor metadata permits partial revision loading or
  partial immutable saves.
