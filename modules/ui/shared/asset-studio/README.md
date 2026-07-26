> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Shared Asset Studio UI

This area owns the host-neutral Asset Studio client contract and shared desktop/thin-client authoring surfaces.

## Surfaces

- `AssetStudioWorkspace` is the single ordered from-scratch editor. It keeps semantic definition data, configuration and interfaces, AI context and composition, frontend structure, frontend styling, backend logic, and other backing resources together.
- `SavedAssetDrafts` lists saved, unpublished workspace drafts and sends the selected draft identity back to the host page so it can reopen in Studio.
- `AssetStudioManager` remains the bounded implementation-proposal workflow used by older composition paths; new Assets navigation uses the unified workspace surface.

The Assets tab set is Browse, Import Assets, Studio, Saved, and Customizations. Create and Drafts must not be reintroduced as separate editing tabs.

Legacy authored drafts remain visible in Saved. Opening one lazily creates a
resource-backed Studio draft with seeded frontend structure, styling, and
backend logic while preserving the legacy record. Legacy provenance makes this
upgrade idempotent and prevents duplicate Saved rows.

## Persistence and safety

Semantic records contain safe structured data and artifact descriptors. Actual backing-resource paths and content remain in the authorized immutable artifact boundary. Saving never publishes or executes content. Review materializes a verified immutable snapshot. Publication creates definition and implementation lineage but does not install, activate, deploy, or execute it.

A changed reviewed draft must be saved before it can be reviewed again. Optimistic revisions prevent stale saves and lifecycle transitions.

## Qualification

Desktop and thin-client hosts share this surface and its ordered workflow,
backing-resource validation, busy/error semantics, and responsive rules. Repository
tests prove these automated contracts and non-execution boundaries. They do not
replace the controlled accessibility and security procedure in
`docs/operations/asset-experience-controlled-review.md`.

## Verification

Use focused tests while iterating:

- `UnifiedAssetStudio.unit.test.tsx` for exact saved-draft restoration, ordered sections, and Saved selection.
- `asset-area-tab-consolidation.unit.test.ts` for desktop/thin-client tab parity.
- Desktop and thin-client Asset Studio client tests for transport route/envelope alignment.
- Asset Studio transport parity and workflow tests for actor, workspace, revision, artifact, review, and publication boundaries.

Run the applicable repository gates after the complete increment, as required by `AGENTS.md`.
