# Asset Authoring, Customization, and Override Management

- Status: current
- Implementation: semantic draft/revision/override authoring plus the bounded Asset Studio source-proposal and human-review workflow are current
- Related decisions: `docs/adr/ADR-0018-asset-authoring-customization-and-overrides.md`, `docs/adr/ADR-0035-layered-derived-asset-customization.md`
- Verification: `docs/architecture/architecture-verification.md`

- Effective asset projections: `docs/architecture/effective-asset-projections.md` and ADR-0019 define how authored/customized records become workspace-scoped effective projections with explicit status/blockers.

## Purpose

Asset authoring/customization defines the architecture baseline for **asset authoring**, **safe customization**, and **explicit override management** without weakening workspace isolation or User Library reuse boundaries.

This document is the canonical architecture reference for asset authoring, customization, and override management.

## Relationship to upstream foundations

- Workspace foundations established explicit workspace scoping and isolation.
- User Library reuse established explicit promote/link/copy/import relationships and conservative provenance/effective-source semantics.
- Asset authoring/customization extends these foundations with controlled authoring/customization vocabulary.

Asset authoring/customization depends on User Library reuse status documented in `docs/architecture/user-library-and-cross-workspace-reuse.md` and ADR-0017. If transport/UI composition claims for User Library reuse regress, asset authoring/customization must treat those surfaces as prerequisites/deferrals and must not assume they are available. Promote/import UI flows and broader effective-source composition surfaces remain conservative; asset authoring/customization must not imply unavailable User Library behavior already exists.

## Vocabulary

- **Authored asset**: an asset created by a user through explicit authoring workflows, with an owning scope and revision history.
- **Workspace-authored asset**: an authored asset owned by a specific workspace.
- **User-authored asset**: an authored asset owned directly by the User Library scope (deferred unless a later canonical decision explicitly introduces direct User Library authoring).
- **Customization**: a user-initiated, explicit change to safe editable fields of an existing asset context.
- **Override**: a non-destructive customization layer applied against a base asset reference.
- **Override record**: a durable workspace-scoped record capturing override intent, changed fields, status, and provenance.
- **Customized asset**: the effective asset view produced by applying safe customizations/overrides to a base asset context.
- **Derived asset**: a workspace-owned asset produced from another source (linked, copied, imported, or system-derived) with provenance to that source.
- **Editable draft**: a mutable pre-publication authored/customization revision.
- **Published authored asset**: an immutable published authored revision unless later canonical decisions explicitly introduce controlled amendment.
- **Asset revision**: an explicit revision/version unit for authored assets or override evolution.
- **Base asset**: the source asset that customization/override targets.
- **Customization target**: the specific asset relationship being customized (linked reference, detached copy, imported copy, or system-derived source).
- **Override scope**: where an override is valid (asset authoring/customization baseline: workspace-local scope).
- **Override status**: lifecycle state of an override (draft, published/active, superseded, conflicted, archived/deprecated as later canonical decisions define).
- **Override provenance**: safe lineage metadata for override origin and transformation context.
- **Detached customization**: customization on a detached workspace-owned copy.
- **Linked customization**: customization applied against a linked reference via workspace-local override behavior.
- **Conflict**: explicit mismatch between base version assumptions and current base state.
- **Resolution**: explicit user-visible action to reconcile a conflict; never silent.
- **Promotable authored asset**: a workspace-authored or customized asset revision eligible for explicit later promotion workflows.
- **Safe editable fields**: explicitly allowlisted, validated, user-facing fields permitted in asset authoring/customization editing.
- **Non-editable source fields**: protected fields and internals that cannot be modified in asset authoring/customization baseline.
- **Layered derived customization**: a workspace-owned draft pinned to exact semantic and implementation bases that stores sparse semantic changes plus an optional bounded source-overlay descriptor.
- **Source overlay**: the changed-file portion of a customization. Raw relative paths and source text exist only inside an authorized authoring proposal/artifact boundary; durable structured records retain bounded counts and an immutable artifact descriptor.
- **Review materialization**: the fail-closed assembly of unchanged base source plus the changed-file overlay into a complete immutable source snapshot for human review, build, and release gates.

## Scope definitions

### What asset authoring means

Asset authoring means creating new assets with explicit ownership scope, safe editable fields, revision state, validation diagnostics, and provenance metadata.

### What asset customization means

Asset customization means changing allowlisted safe fields on an existing asset context while preserving ownership boundaries and source immutability constraints.

### What an override means

An override is the explicit non-destructive representation of divergence from a base asset reference. Overrides do not mutate the source record directly.

### Workspace-local authored assets

Workspace-local authored assets are owned by one workspace and require explicit workspace ID at creation/read/edit boundaries.

### Customized assets

A customized asset is an effective result combining a base asset relationship and one or more explicit safe overrides/draft revisions within allowed scope.

### Override records

Override records are durable, explicit, workspace-visible records that capture what changed, against which base version, under which scope/status/provenance.

## Ownership and scope rules

1. Workspace isolation remains default.
2. Workspace-scoped authoring requires explicit workspace ID.
3. User Library remains separate from workspace and system foundation scopes.
4. System-owned assets remain system-owned.
5. `system.foundation@1.0.0` is immutable.
6. Linked user-library customization must never silently mutate user-library source.
7. Detached copy customization edits the workspace-owned copy.
8. Imported workspace asset customization edits target workspace copy only.
9. Customizations must be explicit and user-visible.
10. Override records must be durable and safe.
11. No hidden propagation execution.
12. No live workspace-to-workspace linking.
13. No collaboration permissions/multi-user auth model in asset authoring/customization.
14. No pack import/export or marketplace behavior.
15. No hidden/default workspace behavior.
16. No startup seeding.
17. No legacy/global auto-migration.
18. Public contracts/provenance/diagnostics/UI must never expose raw paths, storage roots, provider payloads, prompt text, workflow JSON, tokens/secrets, stack traces, command lines, environment values, bytes/blobs/base64, or signed URLs.

Authorized customization-target details plus Asset Studio source and diff
responses are the narrow exceptions for an authoring session: they may expose
bounded logical relative source paths and source text after workspace
authorization. They never expose host filesystem paths. Those values remain
outside Asset Kernel metadata, list/readiness DTOs, logs, and safe diagnostics.

## Ownership model by source relationship

### Workspace-local authored assets

- Created directly into workspace scope.
- Workspace-owned by default.
- Not visible cross-workspace unless later explicit promote/copy/link/import/export workflows are performed.

### User-library authored assets

- Direct authoring into User Library is **deferred** in asset authoring/customization baseline unless later canonical decisions explicitly scope it.
- asset authoring/customization should assume workspace-first authoring and explicit later promotion patterns.

### Customizing linked user-library assets

asset authoring/customization allows only explicit safe options:

- create a workspace-local override record against the linked relationship; or
- create a detached workspace copy and customize that copy; or
- require explicit user choice between local customization and later controlled source update workflow.

Silent source mutation is forbidden.

### Customizing detached copies

- Detached copies are workspace-owned.
- Customization applies to detached workspace asset.
- Provenance must preserve source lineage.

### Customizing workspace imports

- Imported assets in target workspace are target-owned detached copies.
- Customization applies only to target copy.
- Source workspace record remains unchanged.

### Customizing system-owned assets

- System source remains immutable.
- Any customization must be represented as workspace-local override and/or derived workspace asset.
- No mutation/copy of `system.foundation@1.0.0` ownership semantics.

## Authoring model (architectural shape)

Authored assets should conceptually include:

- authored asset ID;
- workspace ID or owning scope;
- asset kind/type;
- display name;
- summary/description;
- safe editable fields;
- revision/version;
- status/lifecycle;
- provenance;
- created/updated timestamps;
- validation diagnostics;
- safe metadata.

asset authoring/customization starts with conservative editing scope and does not permit arbitrary mutation of all asset internals.

## Override model (architectural shape)

Override records should conceptually include:

- override ID;
- target workspace ID;
- base asset reference;
- base asset version;
- base source kind;
- override scope;
- editable fields changed;
- override values or safe patch summary;
- status/lifecycle;
- provenance;
- created/updated timestamps;
- actor/request context when available;
- diagnostics/safe metadata.

Override records must **not** contain:

- raw file bytes/blobs/base64;
- raw local paths or storage roots;
- provider payloads;
- prompt text (until explicitly/safely designed in later canonical decision);
- workflow JSON (until explicitly/safely designed in later canonical decision);
- tokens/secrets;
- stack traces;
- command lines;
- environment values;
- signed URLs.

## Safe editing scope baseline

### Safe editable fields (initial)

- display name;
- summary/description;
- tags/classification when existing contracts support them;
- explicitly allowlisted user-facing configuration fields;
- safe metadata keys that satisfy sanitization rules.

### Custom asset type classification

The asset authoring/customization creation UI uses the allowlisted `classification` editable field to capture the user's intended custom asset type without expanding the Asset Kernel contract surface. Supported UI classifications are:

- `workflow-asset`: reusable workflow or process building block.
- `system-asset`: reusable system or subsystem building block.
- `component-asset`: reusable interface/component building block.
- `data-asset`: reusable data or dataset-oriented building block.
- `model-asset`: reusable model-oriented building block.
- `tool-asset`: reusable tool/action building block.

These classifications are user-facing authoring metadata on workspace-local drafts and authored records. They do not grant runtime execution capability, mutate system-owned assets, or replace the canonical `AssetType`/`AssetFamily` vocabulary.

### Deferred/higher-risk fields

- raw prompt text;
- workflow JSON;
- provider payloads;
- runtime execution settings;
- storage locations;
- binary/resource content;
- credentials/tokens;
- environment variables;
- arbitrary JSON blobs.

These remain deferred pending explicit schemas, validation, diagnostics, and tests.

## Asset Studio implementation workflow

Asset Studio extends, rather than replaces, authored definitions. An author
selects an exact definition version, starts a separate implementation draft,
and submits either a manual source proposal or a provider-neutral coding-model
request. Both modes produce the same bounded plan/file/dependency/capability
proposal. Proposal content is stored as a verified immutable artifact; the
structured workflow record retains only counts, digests, safe diagnostics,
status, and provenance.

The model port has no shell, filesystem, network, persistence, secret,
activation, or publication methods. Repository content is untrusted context,
not authority. Paths, extensions, size, dependency allowlist, capability
allowlist, duplicate identities, and secret-like content are validated before
review. Human approval must exactly match dependencies and capabilities and an
optimistic revision; approval produces an immutable source snapshot. Build,
preview, release, activation, and deployment remain separate gates. A host
without a configured coding-model provider returns an explicit unavailable
result while retaining the complete manual workflow.
For from-scratch resource-backed assets, Studio also owns a workspace-scoped
structured draft that combines the complete semantic definition with an
immutable backing-resource artifact. The structured record stores safe
definition fields, lifecycle, revision, provenance, artifact descriptors,
digests, and file descriptors; actual logical paths and source text remain in
the authorized artifact boundary. Frontend structure, frontend styling,
backend logic, and other resources are actual saved files, not metadata
descriptions of hypothetical files.

The shared desktop and thin-client experience presents identity, definition,
configuration, interfaces, AI context, composition, and all backing-resource
roles in one ordered Studio surface. Saving creates or updates an unpublished
draft. The Saved surface lists only non-published, non-abandoned workspace
drafts and reopens the selected draft in Studio with its exact semantic values
and verified backing-resource content. The former Create and Drafts tabs are
therefore redundant and are not exposed.
Legacy authored drafts remain readable and are not mutated. Saved merges them
with native Studio drafts; opening one creates an idempotent resource-backed
Studio draft with explicit legacy provenance, after which the native draft
de-duplicates the legacy row.

Changing a reviewed Studio draft invalidates its prior review. Review
materializes an immutable definition-plus-resource snapshot; publication creates
the definition and implementation lineage but never installs, activates,
deploys, or executes the implementation.

## Layered derived customization model

ADR-0035 extends the conservative override baseline for an integrated
definition-and-implementation customization workflow. The extension is additive;
existing `AssetOverrideRecord` values remain safe-field-only and do not gain source
content.

A layered customization is workspace-owned and pins all of the following:

- an exact semantic `asset-definition-version` reference;
- an exact implementation release;
- the release's exact immutable source snapshot; and
- the source artifact descriptor and digest for that snapshot.

Before review, the structured draft stores only a sparse safe semantic patch,
including allowlisted display/description/metadata fields and typed configuration,
ports, AI context, requirements, composition rules, and dependencies;
lifecycle/provenance/revision data; safe diagnostics; and an optional source-overlay
descriptor. The descriptor identifies a verified
immutable `source` artifact and bounded file/character totals. It does not contain
source text or paths. Bounded relative paths and changed source text cross only the
authorized Asset Studio proposal boundary and are revalidated before artifact
persistence.

Unchanged fields and files are logically reused through the exact base identities.
Storage adapters may deduplicate content-addressed blobs, but the customization
contract neither requires nor claims physical deduplication.

Review materialization must:

1. re-read and verify the exact base source artifact and overlay artifact by digest;
2. confirm workspace ownership, release/snapshot availability, and optimistic
   revision;
3. revalidate path containment, file types, file and aggregate sizes, duplicate
   paths, secret-like content, dependencies, capabilities, and protected fields;
4. apply changed files over the exact base in an isolated authoring workspace; and
5. persist a complete immutable source snapshot for review without building,
   releasing, installing, activating, deploying, or executing it.

Publication creates a distinct workspace-owned asset definition and implementation
lineage. The base definition, package, implementation release, snapshot, and source
artifact remain immutable in success, failure, conflict, abandonment, and retry
paths.

### Protected fields

The integrated workflow may display important internals, but these categories are
read-only unless a later accepted decision and typed schema authorize a safe edit:

- source asset identity and version;
- ownership, provenance, lifecycle, trust, and admission state;
- package, implementation release, source snapshot, build, and artifact identities;
- signer, digest, revocation, evidence, compatibility, and deployment policy;
- runtime capability grants, secrets, storage locations, and host configuration.

Changing an exact base, a reviewed semantic patch, a reviewed overlay, requested
dependency, or requested capability invalidates prior review. Missing, changed,
revoked, or unavailable bases produce an explicit conflict or invalid state. There
is no automatic rebase or floating-base remap.

## Versioning and conflict baseline

1. Draft and published authored revisions are distinct.
2. Revisions/version identifiers are explicit and durable.
3. Editing authored assets creates explicit new drafts/revisions.
4. Editing overrides similarly creates explicit draft/revision transitions.
5. Base-version mismatches must surface explicit conflicts.
6. Pinned links: linked customization stays pinned; base changes surface conflict/available-update status, not silent remap.
7. Explicit-update links: updates require explicit user action; override compatibility/conflict must be surfaced.
8. Detached copies: no automatic source following; conflicts only within local revision history.
9. Workspace imports: target copy remains detached; source changes do not auto-apply.

Conservative defaults:

- published revisions immutable unless later canonical decision defines controlled amendment;
- conflicts detected/surfaced, never silently resolved;
- no hidden linked override propagation;
- detached/imported copies do not auto-follow source updates.

## Effective-source relationship extension (vocabulary only)

asset authoring/customization prepares effective-source classifications for future contracts/read-models, including:

- `workspace-authored`;
- `workspace-customized`;
- `user-library-customized`;
- `system-derived-override`;
- `linked-with-workspace-override`;
- `imported-customized`.

The architecture defines vocabulary and current boundaries. Implementation status must be checked against current code, canonical docs, and context packs when changing this area.

## Implemented in asset authoring/customization vs deferred

### Asset authoring/customization target scope

- Explicit architecture vocabulary for authoring/customization/override.
- Conservative authored/override record conceptual models.
- Application, persistence, use-case, transport, and UI surfaces are available only where the current code exposes them.

### Deferred scope

- Raw prompt/workflow editing outside the bounded Asset Studio source-overlay
  boundary, arbitrary internals editing, and runtime-execution-linked editing.
- Collaboration permissions/multi-user authorization.
- Pack import/export, marketplace, live workspace-to-workspace linking.

## Asset authoring/customization current status

- Implemented and available through API + IPC/preload + desktop/thin-client UI: workspace-authored asset listing, draft creation, draft update, draft publication, override listing, and override disabling.
- Implemented through application use cases and API/IPC transport surfaces: override create, update, and disable operations.
- Draft publication currently creates new workspace-authored assets only; publishing into an existing authored-asset revision chain is deferred.
- Authored asset revision amendment flows are deferred.
- Effective-summary support is transport-dependent and may return unavailable; UI must show an unavailable/deferred message when unavailable.
- Override creation requires a composed safe customization-target reader and a safe target-selection UX. Where those are unavailable, UI must not present create-override as supported and transport responses may truthfully return unavailable/not-found/unsupported outcomes.
- No workflow execution, no materialized effective-asset generation, no propagation execution, and no conflict rebase/resolution workflows in asset authoring/customization.
- No linked-source mutation and no `system.foundation` mutation/copy behavior.
- Layered-derived customization target discovery, workspace-isolated optimistic
  persistence, sparse semantic/source overlays, immutable review materialization,
  distinct definition plus implementation-draft publication, history, and abandon
  operations are implemented. Server API and desktop IPC/preload transports,
  desktop/thin-client clients, host composition, authenticated actor attribution,
  and workspace enforcement are implemented and covered by focused tests. Desktop
  and thin-client Assets surfaces compose one shared ordered workflow for exact
  target selection; allowlisted definition, configuration, interface, and AI
  context editing; explicit frontend structure, frontend styling, backend logic,
  and other backing-resource sections; immutable review; publication; abandon;
  and customization history. Asset Browser cards can open their exact semantic
  definition and version directly in that workflow.

### Required status checklist

1. Workspace-authored asset creation: implemented via draft -> publish path.
2. Draft creation: implemented.
3. Draft update: implemented for safe editable fields.
4. Draft publication: implemented.
5. Draft publication target: creates new authored assets only.
6. Existing authored-asset revision publishing: deferred.
7. Effective summaries: partial/deferred; unavailable is a valid final-state response.
8. Override creation: application/API/IPC operation implemented; user-facing availability is conditional on safe target selection and target-reader composition.
9. Override listing: implemented.
10. Override disabling: implemented.
11. API exposure: implemented for current asset authoring/customization operations.
12. IPC/preload exposure: implemented for current asset authoring/customization operations.
13. Desktop UI support: implemented for listing/draft actions/override disable and the shared layered-derived customization workflow.
14. Thin-client UI support: implemented for listing/draft actions/override disable and the shared layered-derived customization workflow.
15. Workflow execution from authored/customized assets: not implemented.
16. Materialization from override patches: not implemented.
17. Conflict rebase/resolution workflow: not implemented.
18. Source mutation: not implemented.
19. `system.foundation` mutation: not implemented.
20. Layered-derived customization decision and contracts: implemented.
21. Layered-derived customization target catalog, persistence, and
    create/update/review/publish/abandon application workflow: implemented and
    covered by focused restart, workspace-isolation, immutability, and
    materialization tests.
22. Layered-derived customization host transports: implemented for server and
    desktop hosts with typed clients and focused security/host tests.
23. Layered-derived customization guided UI: implemented as a shared ordered desktop/thin-client workflow with exact Asset Browser handoff, sparse semantic/source changes, explicit backing-resource sections, review/publication, abandon, and history.

## Relationship to asset composition planning

Authoring/customization records remain source-of-truth for edits. asset composition planning consumes effective projection summaries and must route users back to authoring/customization surfaces when source edits are needed.
