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

## Draft session and retry behavior

Studio owns one editor session per workspace, client and selected saved draft.
Changing that context retires old interface updates; it does not claim to cancel
a server write. Save, review, publish and abandon admit one request before React
renders busy state. Successful replies must name the expected workspace, draft,
definition, lifecycle state and next revision before the editor accepts them.
Thrown adapter failures use safe notifications, release current controls and
permit explicit retry. A failed saved read exposes Retry opening saved asset;
opening does not save or publish. Newer text/resource edits made while saving
remain dirty and need another save before review/publication. Identity fields
are locked while saving.

Focused Node DOM tests initialize the browser renderer after DOM setup and use
native input events for meaningful semantic/resource editing, save/reopen/review/
publish, invalidated reviews, duplicates, foreign replies, rejection/retry and
workspace/client/draft/unmount races. They use fixed clients and do not qualify
actual transports, storage, apps, providers, native retirement or execution.

A saved editor stays disabled until its initial read or explicit retry succeeds.
The retry button stays available after failure. A retired session is checked
before dispatch as well as before accepting a reply. These controls prevent
editing a placeholder that would be replaced by a later saved-draft read.

## Saved view ownership and recovery

Saved owns a view per workspace, Studio client and legacy client. Replacing any
of them retires its old reads, conversion results and navigation callbacks.
One read or legacy open is admitted before React renders busy state. Search
cannot release or overlap an in-flight conversion. Search text stays fixed
while reading and resets when the view changes. No server write is cancelled.

Studio and legacy lists settle separately. Valid data from one source remains
available if the other fails. Rendering fields and duplicate row identities are
checked; legacy rows must name the requested workspace. A failed source does
not prove an empty workspace. Failures use the notification center and explicit
Search or Open retry. Thrown details are never displayed.

An accepted legacy open must return a canonical Studio record for this workspace
with the same legacy provenance. The existing application may return an already
converted record with a later revision, another exact definition or any canonical
lifecycle state. The UI does not force a new seed or revision 1. Conversion
preserves the legacy record and grants no publication or execution authority.

Focused UI cases cover meaningful open/retry behavior, one in-flight action,
malformed and foreign replies, partial lists, retired results and dispatch, and
idempotent record reuse. They use fixed clients. Actual application, transport,
storage, host and native qualification remain separate and pending.
