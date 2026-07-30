# Persistence and Storage

- Status: current
- Related decisions: `docs/adr/ADR-0004-persistence-and-storage-separation.md`, `docs/adr/ADR-0025-deployment-shaped-structured-persistence.md`, `docs/adr/ADR-0026-local-sqlite-runtime.md`, `docs/adr/ADR-0027-managed-postgresql-runtime.md`, `docs/adr/ADR-0028-atomic-structured-document-mutations.md`, `docs/adr/ADR-0029-organization-tenancy-identity-and-authorization.md`, `docs/adr/ADR-0039-dedicated-system-runtime-data-plane.md`
- Verification: `docs/architecture/architecture-verification.md`

## Asset Kernel relationship

The Asset Kernel is the semantic composition model for reusable building blocks. Persistence and storage remain separate lower-level architecture concerns. Asset metadata may be persisted as structured records for asset definitions, instances, bindings, compositions, lifecycle, and provenance; binary/content payloads remain storage concerns. The current Asset Kernel persistence stack uses typed local repository adapters over the active host's structured-document seam, while retaining its schema-versioned JSON layout only for unshaped development compatibility and explicit legacy import. Descriptor-only resource-backed mapping/view helpers remain separate. This does not add a durable resource-backed mapping repository or version-history service.

Resource-backed assets should reference artifact/resource storage identities instead of embedding raw file paths or bytes in asset metadata. Generated outputs produced by runtime tasks become reusable only after finalization/registration as artifacts or resource-backed assets. Hugging Face repository objects remain external repository objects until registered/imported as resource-backed assets. Existing artifact, model, dataset, and image concepts should not be renamed during Asset Kernel contract baseline.

## Core distinction

`ai-system-builder` treats **persistence** and **storage** as separate architecture concerns.

- **Persistence**: structured, durable application records and relational/queryable state.
- **Storage**: a thin shared foundation plus specialized storage families for artifact content and provider/repository-backed material.

This distinction is required even when both end up on the same machine or disk.

## Storage adapters as a broad architectural category

Storage in this repository is a broad adapter category, not one flat contract shape.

- `modules/adapters/storage/` is the umbrella area for storage adapter families.
- Storage may contain multiple specialized contract families and implementation families.
- Shared storage principles still apply (explicit boundaries, adapter-owned infrastructure details, transport/path neutrality at public contracts).
- Specialization is expected when semantics differ materially.

### Specialized storage families (direction)

At minimum, storage distinguishes two contract families over a shared foundation (`StorageKind`, `StorageProviderId`, and `StorageBackingReference`):

- **artifact-object storage adapters**
  - centered on artifact keys, bytes, checksums, and artifact metadata (`ArtifactObjectStorageLocator` and store/retrieve/has/delete key-object operations),
  - represented today by key-based artifact storage contracts and filesystem-backed implementations.
- **artifact-repo storage adapters**
  - centered on provider/repo identity, revision/version semantics, remote visibility/access semantics, and provider-native publish/import behavior,
  - valid storage adapters even though they are not simple key/blob stores.

Repo-backed storage is still storage.
It must not be collapsed into persistence-record concerns and should not be flattened into the same contract shape as artifact/object key-byte operations.

## Deployment-shaped persistence targets

Structured records use a deployment-specific database target:

| Deployment shape          | Default adapter | Required access boundary |
| ------------------------- | --------------- | ------------------------ |
| Local desktop/application | SQLite          | Embedded and single-host |
| Campus server             | PostgreSQL      | Client/server            |
| Corporate server          | PostgreSQL      | Client/server            |
| Cloud                     | PostgreSQL      | Client/server            |

`modules/contracts/config` owns the finite deployment-shape vocabulary and the
default target mapping. It describes deployment intent; it does not by itself
select an active runtime adapter. Host composition remains responsible for
loading environment-specific configuration and selecting an implemented adapter.

### Local SQLite policy

The local database belongs at
`<desktop-app-data>/persistence/ai-system-builder.sqlite3`. This path is adapter
configuration, never a public contract or diagnostic. Artifact storage and
runtime roots remain separate sibling concerns.

Every local SQLite connection must enable WAL journaling, full synchronous
durability, foreign-key enforcement, and a finite busy timeout. WAL supports
concurrent readers with a single writer but requires all database access to stay
on the same host. Do not place the database or its WAL sidecars on a network
filesystem, synchronize them as ordinary live files, or use SQLite as the shared
database for campus, corporate, or cloud deployments.

Live backup must use the selected driver's online backup facility (or a
transactionally equivalent database-aware snapshot), with restore verification.
Copying only an open `.sqlite3` file is not an accepted backup procedure because
committed state may also be present in WAL sidecars.

### Shared PostgreSQL policy

Campus, corporate, and cloud hosts use PostgreSQL for structured records. The
server owns connection lifecycle, health, and adapter selection; credentials and
connection material enter only through secret/environment configuration at the
composition boundary. Application/domain modules must not receive connection
strings, pools, transactions, SQL, or driver errors.

Backup method, recovery objective, replication, failover, tenant layout, and
retention vary by managed environment and require explicit operational decisions.
Selecting PostgreSQL does not claim those capabilities are already implemented.

### Organization partitioning and placement

Managed structured persistence defaults to pooled organization tenancy. Schema
version 2 keeps platform/legacy records in `structured_documents` and stores
organization-owned records in `organization_documents`, keyed by organization,
namespace, and document key. SQLite implements the same explicit logical
partition for local mode. PostgreSQL additionally enables and forces row-level
security, with visibility and writes tied to transaction-local
`app.organization_id`. Adapters include explicit organization predicates and
bind the setting on a checked-out transaction. Missing request context never
falls back to platform records.

Premium dedicated placement accepts exactly one configured organization before
persistence or storage access. It uses the same schema, contracts, migrations,
and release as pooled placement. Existing records are never assigned during
ordinary startup; use the fingerprinted assignment procedure in the operations
runbook.

Managed filesystem artifact adapters preserve contract-level logical keys while
deriving a physical `organizations/<organization-id>/...` prefix from the
authenticated request scope. The prefix is adapter-owned and cannot be supplied
by callers. Object reads, writes, existence checks, deletes, generated-image
finalization, and unregistered-file access fail closed without organization
context. A future external object-service adapter must preserve those ownership
semantics rather than expose provider bucket/key construction to use cases.

### Dedicated published-system runtime data plane

Published-system operational data is distinct from the platform control plane.
Deployment, release, lifecycle, placement, and audit records remain in the
active platform database and contain only opaque runtime-instance and binding
identities. Conversation and system-owned repositories are created from the
exact runtime database session after organization, workspace, deployment,
release, lifecycle, binding, schema, and health validation.

Desktop stores each runtime instance in a contained host-derived SQLite file at
`<desktop-app-data>/runtime-data/instances/<opaque-id>/persistence/runtime.sqlite3`.
Managed hosts provision one non-semantic PostgreSQL database name and one
least-privilege login role per instance. The provisioner owns database/schema
creation and migration; the runtime role receives only connect plus required
schema/data privileges and cannot provision or connect to another instance.

Stop releases handles but preserves data. A compatible upgrade may reuse a
stopped instance only through explicit migration, health validation, and a new
exact deployment/release binding. A clone or separate installation receives a
new database. Uninstall retains data; deletion is separate, retained-state only,
and requires exact confirmation. Missing storage never falls back to a new blank
database. Managed backup/restore remains unavailable until a platform recovery
adapter is configured and qualified.

### Database portability and migrations

- Repository ports and record contracts define semantic behavior independent of
  a database engine.
- SQLite and PostgreSQL adapters may use engine-specific SQL and migrations; do
  not leak dialect compromises into application contracts.
- Every database maintains a monotonic migration ledger. Schema migration runs
  before repository activation, under an exclusive migration lock appropriate to
  the engine, and fails startup safely when the schema is newer than the binary.
- Each record family needs round-trip, malformed-data, constraint, workspace
  isolation, transaction, and concurrency coverage against every supported
  database adapter.
- Schema changes that remove or reinterpret data require an export/rollback plan
  and explicit approval; application startup must not perform an unbounded or
  destructive conversion silently.
- Both active database adapters expose a deterministic, transactionally
  consistent NDJSON export with a versioned manifest, document count, and digest.
  This is a portability/inspection artifact, not a replacement for engine-native
  disaster-recovery backup.

### Atomic mutation and retry policy

Database-backed repository collection changes use revision compare-and-swap,
including insert-if-absent revision `0`, so independent server processes cannot
silently replace an entire collection with a stale copy. Repository adapters
must use record-store mutation methods; a fitness test rejects direct collection
writes from repository factories. Mutation callbacks are pure computation and
may be re-evaluated after a conflict. The default conflict budget is bounded at
64 attempts.

PostgreSQL application transactions run at Serializable isolation and retry the
complete callback, up to four attempts, for serialization failure (`40001`) and
deadlock detected (`40P01`). JSON compatibility mode serializes same-file
mutations only within one Node process and is not valid shared-server
persistence. These mechanics prevent collection-wide lost updates; they do not
invent domain merge rules for two writers replacing the same logical record.

### Operational boundary

The server publishes process-only liveness separately from dependency-aware
readiness. Readiness combines database schema/query/pool state with artifact-root
access/capacity and sanitizes all failures. Production server shapes require
managed OIDC over HTTPS and drain their pool on restart, SIGINT, or SIGTERM.
Shape profiles and deployment templates are under `config/environments/server`
and `deployments/server`; the compatibility, backup/restore, rollout, and
qualification rules are in `docs/operations`. ADR-0029 decides organization
tenancy and placement. The templates do not decide retention, RPO/RTO, HA, or
the external object-service provider.

### JSON adapter transition

Desktop composition now opens and migrates SQLite before IPC registration,
inventories only allowlisted legacy JSON/NDJSON structured-data families, retains
a rollback copy, imports and reconciles in one transaction, records an activation
marker, and then routes typed repositories to SQLite. Once marked, changed JSON is
treated as divergent state and startup fails; there is no automatic fallback or
dual write. Explicit campus, corporate, and cloud server shapes now select the
PostgreSQL implementation and same import seam before API registration. An
unshaped non-production server remains a named JSON compatibility mode for local
development; production requires an explicit deployment shape.

## Shared persistence contract baseline

The shared persistence contract vocabulary under `modules/contracts/persistence` is intentionally:

- record-oriented (structured durable data references and operation scope),
- result-oriented (persistence operation envelope with shared success/failure semantics),
- identity-explicit (record references by logical type plus stable record id),
- implementation-neutral (no ORM, SQL builder, or driver-specific contract leakage).

Persistence family invariants:

- persistence operations must use shared operation identity format (`lowercase.dot.segments`),
- persistence record references normalize record identity (`recordType`, `id`) at creation boundaries,
- operation identity remains transport-neutral (no API/IPC namespace leakage),
- when a persistence result/error includes a `record`, the operation must target that record type (`<recordType>.<action>[.<qualifier>...]`).
- persistence family barrels should export persistence-only surfaces so consumers get a predictable family boundary.
- application persistence ports should stay record-oriented and operation-aware (not generic CRUD bags) and should depend on persistence contracts, not adapter-native query APIs.

This permits deployment-shaped database adapters without coupling
application/domain boundaries to SQLite- or PostgreSQL-specific APIs.

### Asset Kernel local record adapter checkpoint

`modules/adapters/persistence/asset` provides the current local Asset Kernel persistence adapter. It stores JSON-compatible `AssetDefinition`, `AssetInstance`, `AssetComposition`, and `AssetBinding` records through the active host's structured-document store. Its compatibility/legacy layout remains `asset-kernel/manifest.json`, `definitions.json`, `instances.json`, `compositions.json`, and `bindings.json`; the manifest uses `schemaVersion: 1` and `storeKind: "asset-kernel-local-store"`. The adapter implements application repository ports and remains infrastructure-only: it does not own Asset Kernel validation, business rules, host composition, API/IPC/UI exposure, resource-backed mapping helpers, artifact/object storage, workflow execution, graph execution, runtime readiness, prompt assembly, embeddings, or AI-generated context.

The local adapter persists records and references only. It must not embed raw file/blob bytes, generated model/image/dataset payload bytes, secrets, environment values, local filesystem handles, or adapter-native paths in asset records or public errors. Durable resource-backed asset mapping persistence and explicit persistence-to-storage linkage remain deferred beyond this checkpoint.

### Workspace local persistence checkpoint

Workspace application repository ports and local persistence adapters store workspace records/indexes, active workspace selection, and workspace system-pack activation records through the active structured-document store. The compatibility/legacy layout remains `workspaces/index.json`, `workspaces/active-workspace.json`, `workspaces/<workspaceId>/workspace.json`, and `workspaces/<workspaceId>/activations/system-packs.json`. This adapter stores records and references only: active workspace selection is a persisted preference/read model rather than global application-service state, and system-pack activations reference packs by id/version such as `system.foundation@1.0.0` without installing, copying, embedding, or mutating pack manifests, assets, or definitions. Workspace record save and activation save are create-or-replace seams; workspace record update and activation update are existing-record-only and must not create missing records.

Workspace persistence must avoid raw local path leakage in public errors/read models. Workspace creation writes only through workspace ports, validates display names, generates safe workspace IDs, persists workspace records, may persist active workspace selection only when explicitly requested, and may create a reference-only `system.foundation@1.0.0` activation record. UI-created workspaces must be backend-resolvable workspace records, active workspace selection remains a persisted preference/read model rather than global mutable application-service state, and the System Foundation checkbox persists a reference-only activation. Workspace persistence does not add pack import/export/install UI or collaboration behavior.

## What belongs in persistence

Examples:

- primary entities and aggregate state,
- references, relationships, and lifecycle metadata,
- job/task state records,
- audit metadata designed for structured querying.

System deployment uses database-neutral structured namespaces scoped by
organization and workspace for deployments, runs, and bounded audit entries.
Optimistic revisions protect lifecycle transitions. These mutable operational
records reference immutable `SystemRelease` identities and digests; they do not
embed release artifacts, secrets, host paths, provider payloads, or runner
output. SQLite and PostgreSQL therefore share semantics while physical release
artifacts remain behind the system-build artifact storage port.

These concerns belong behind persistence ports/contracts and adapters (for example in `modules/adapters/persistence/`).

## What belongs in storage

Examples:

- uploaded files,
- generated artifacts (reports, exports, model outputs),
- images/media/binary payloads,
- temporary workspace material,
- cache-like files or staging artifacts.
- provider-backed repository artifacts and package-like content where provider/repo identity and revision/publication semantics are part of storage behavior.

These concerns belong behind storage ports/contracts and adapters (for example in `modules/adapters/storage/`) with contract families matched to semantics.

## Desktop and server physical mapping

Physical location can vary by host mode:

- Desktop local structured persistence targets a SQLite database under the
  desktop application-data persistence root.
- Desktop mode may store artifacts under OS-specific app data locations.
- Campus, corporate, and cloud server structured persistence targets PostgreSQL;
  the database is reached through a configured client/server connection rather
  than a shared SQLite file.
- Server mode may store artifacts in configured file paths, mounted volumes, or object/blob services.
- Server or hybrid compositions may also include repo-backed providers where the primary storage identity is provider/repository/revision rather than local filesystem path.
- For the current server app, the default filesystem storage root is resolved from the server app/module location so
  it is deterministic and not launch-`cwd` dependent; `SERVER_STORAGE_ROOT` remains the explicit override.

Important: physical location choice does **not** remove the architectural need for storage abstraction.

## Why this separation matters

Without this separation, teams tend to:

- bury file/blob behavior in host lifecycle code,
- hide artifact handling in runtime adapters,
- mix relational and file semantics in one unreliable abstraction,
- make migration, backup, and operational policies harder to reason about.

Separate boundaries keep policies clear and change safer.

## Boundary guidance

- Application/domain should define what must be persisted or stored, not how.
- Persistence adapters implement structured record behavior.
- Storage adapters implement storage-family behavior (artifact/object, repo-backed, and future specializations as needed).
- Hosts choose concrete adapter wiring per deployment mode.

## Shared storage contract baseline

The shared storage contract vocabulary under `modules/contracts/storage` is intentionally thin and family-neutral:

- identity primitives (`StorageKind`, `StorageProviderId`),
- thin backing references (`StorageBackingReference`),
- explicit linkage between internal artifacts and concrete backings (`ArtifactStorageBinding`).

The shared baseline does not force every storage family into one request/response shape.

Specialized storage families then define their own operation contracts:

- **artifact-object storage** keeps key/blob/object semantics (`store`/`retrieve`/`has`/`delete` with storage-key descriptors),
- **artifact-repo storage** keeps provider/repository/revision/path semantics (`store/retrieve/has artifact in repo`).

Storage family invariants:

1. Shared foundation remains thin and generic rather than object-storage-specific.
2. Artifact-object and artifact-repo are peer first-class families.
3. Object-family contracts stay key/blob oriented without repo/provider fields.
4. Repo-family contracts stay provider/repository/revision/path oriented without key/blob flattening.
5. Storage family barrels export storage-only surfaces so family boundaries remain explicit and mechanically discoverable.

This keeps storage responsibilities explicit and separate from persistence-record modeling.

## Asset Kernel local persistence and resource-backed mapping boundary

- Asset Kernel contract baseline local Asset Kernel persistence is record storage for definitions, instances, compositions, and bindings only. Its text filtering is simple deterministic substring matching over selected saved record values.
- The local store manifest validates the current schema version, store kind, and basic timestamp shape on read; no migration framework or schema upgrade behavior is implemented.
- Asset persistence is a JSON-compatible durable boundary. Non-JSON record values such as functions, symbols, undefined values, non-finite numbers, Dates, buffers/streams, class instances, and circular references are rejected before write.
- Resource-backed mapping remains a pure application-layer contract mapper. External repository `objectPath` values stay provider metadata on `AssetExternalRepositoryObjectReference` and must not be promoted into canonical asset ids. Internal backing ids and `asset-resource-backing` references are sanitized mapping identifiers, not local paths, URLs, or provider-native object paths.
- This checkpoint adds no API/IPC/UI wiring, resource-byte storage, runtime/workflow/graph execution, prompt assembly, embeddings, AI-generated context, or automatic composition behavior.

## Repo-backed storage direction (current + next)

Repo-backed providers are a valid storage class under the storage adapter category.

### Implemented first provider slice

- **Hugging Face** is now the first concrete `artifact-repo` provider adapter implementation.
- The generic family remains provider-neutral (`ArtifactRepoStoragePort` + repo request/result contracts).
- A provider-neutral composition seam dispatches by `target.provider`; Hugging Face is currently one registered provider.
- Initial operations implemented: `hasArtifactInRepo`, `storeArtifactInRepo`, `retrieveArtifactFromRepo`.
- Published/re-check verification metadata is persisted on `ArtifactStorageBinding.backing.verification` (`exists`, `verifiedAt`) for durable read-side status.

### Auth and configuration (minimal by design)

- Token can be provided explicitly at composition boundary.
- Fallback env vars: `HF_TOKEN`, then `HUGGING_FACE_TOKEN`.
- Auth handling remains isolated to the provider adapter boundary.

### Practical constraints for this first slice

- This is intentionally a narrow vertical slice, not full provider lifecycle management.
- Upload path support can vary by provider/repo configuration; behavior should be treated as adapter-level and validated per deployment environment.
- Provider-native repository browsing/viewing semantics may exist, but they do not define internal system artifact-browser contracts.

## Ingestion and staged artifact semantic layer

The repository now treats ingestion/staged-artifact as the canonical semantic layer for inbound content.

- Storage is the artifact capability for bytes + key + adapter mapping.
- Ingestion is the semantic intake layer for staged artifacts.
- Artifact is the canonical ELT-side term for stored/flowing data objects.
- Asset terminology is reserved for composable system parts and larger built systems, not ELT-side data/blob/file material.
- Ingestion contracts provide a transport-neutral staged artifact descriptor with intake metadata (source kind, media type, size/checksum, original name when applicable).

This keeps storage generic while preventing image-only/file-only semantic drift in higher-level intake contracts.

Current implementation note:

- Image upload is the active vertical slice and is treated as a specialized ingestion path.
- Upload admission requires a coherent allowlisted extension/media-type pair
  plus bounded content evidence before storage. Binary formats require their
  expected signature; JSON must parse as UTF-8; text-like formats must be valid
  UTF-8 without NUL bytes. A caller-supplied media type or filename alone never
  establishes the artifact type.
- Website HTML acquisition uses one secure-egress boundary in desktop and server
  composition. Simple HTTP and rendered-browser requests share scheme, DNS,
  redirect, byte, deadline, media-type, and concurrency controls; browser
  document/subresource traffic cannot bypass that boundary through service
  workers or WebSockets.
- This does not imply a full ingestion engine, catalog, or ELT orchestration is implemented yet.

## Artifact browser read-side direction (initial image-backed slice)

The first read-side browser/viewer slice is image-backed but artifact-shaped.

- `artifact.browse` is a metadata/query concern for catalog-style listing of existing artifacts through an explicit artifact catalog application-port seam (append/browse/read catalog records).
- Browse adapters sort and cap results before local-availability work, batch
  storage-binding reads, and bound any remaining availability probes. This
  prevents a large catalog or binding collection from causing unbounded
  per-record I/O.
- `artifact.read` is a single-artifact detail/read-model concern for selected artifact metadata from the same catalog seam.
- `artifact.content.read` is a descriptor-oriented artifact-content contract and must not be collapsed into browse/detail contracts or byte payload contracts.
- actual image/media bytes for rendering should be delivered through a separate retrieval path that still resolves by storage key at the boundary.
- Preview rendering is a bounded read-side concern over that separate retrieval path. The retrieval request may carry an application-owned maximum-byte ceiling, and object adapters must reject content above it before byte materialization; filesystem adapters stat before `readFile`. Text/JSON/CSV previews are sampled and bounded, raster images use an allowlist, SVG and Office content remain unsupported, and PDF object URLs render only in titled sandboxed frames. Full downloads remain a separate explicit operation.
- Canonical browse/read/content contracts should remain descriptor/reference-oriented at public boundaries (locator + metadata + availability/retrieval hints), not raw-byte-first payload contracts.
- Browser contracts stay storage-key based and path-agnostic; public browse/view contracts must not expose filesystem paths.
- Browser list/read models may include artifact/backing-state metadata (for example remote-only/localized/published cues) while preserving artifact-first semantics and path-agnostic contracts.
- The system artifact browser is a normalized browser over internal artifacts; it is not a filesystem browser.
- The system artifact browser is also not the same as a provider-native browser (for example a Hugging Face repository UI).
- External provider-native browsers may coexist, but normalized internal browse/read/content contracts remain the system source of truth.
- This is an early data-lake-like artifact browser/viewer surface, not a claim that full ingestion/catalog/ELT platform capabilities are complete.

This keeps persistence-storage linkage explicit (metadata/read models referencing artifact keys or `ArtifactStorageBinding` backing references) while preserving separation between structured record/query behavior and artifact byte retrieval behavior.

## Not yet finalized

The following are intentionally open:

- exact storage backend lineup per environment,
- standardized retention/lifecycle policies for all artifact classes,
- final conventions for linking persistence records to storage artifacts.

Until formalized, contributors should keep persistence and storage concerns explicitly separated and document any interim conventions in ADRs/context docs.

## Family invariant tests

Contract-family tests should protect this boundary model directly:

- persistence invariants (operation identity + record alignment + family exports),
- storage invariants (key normalization + artifact operation shapes + family exports).
- application persistence-port seam invariants in `modules/application/ports/persistence/tests/` (thin operation-aware record requests/results and no storage-key drift).

If these invariants change, update canonical docs and context packs in the same change.

### Current server-exposed artifact-repo operations

Server host composition now exposes a minimal but usable artifact-repo API slice through application use cases (not direct adapter calls):

- `POST /api/artifact-repo/has` -> `HasArtifactInRepoUseCase`
- `POST /api/artifact-repo/store` -> `StoreArtifactInRepoUseCase`
- `POST /api/artifact/publish` -> `PublishArtifactToRepoUseCase` (store + verify + published binding write)

This is intentionally partial. It does **not** claim full provider management or provider-native browser parity.

### Current desktop artifact-repo publish path

Desktop host composition also wires the shared `PublishArtifactToRepoUseCase` with filesystem artifact storage, binding persistence, and Hugging Face artifact-repo storage adapter.

- Renderer -> preload bridge -> Electron IPC -> shared publish use case.
- Publish success persists `ArtifactStorageBinding` (`role = published`) and desktop artifact detail surfaces that backing metadata.

### Hugging Face provider hardening status

The Hugging Face adapter remains one provider behind the generic artifact-repo
port. Existence checks and uploads use the official `@huggingface/hub` client;
localization constructs the validated provider resolve URL and streams it
through the shared secure-egress broker so provider redirects, response bytes,
media type, deadline, and concurrency are bounded before local persistence.

- Provider/repo/path validation is explicit and deterministic.
- Dataset browse uses the provider's logical converted-Parquet inventory rather
  than a recursive raw-file tree. It accepts only bounded same-Hub URLs for the
  exact dataset and exposes stable logical config/split paths.
- Auth is adapter-boundary-only and required for write operations.
- A missing repository is not auto-created. Creation requires an explicit
  approved request with a private/public choice; managed hosts additionally
  authorize the exact provider repository for the active organization before
  provider I/O. Private is the UI default and public is never inferred.
- Provider status mapping is explicit (`validation`, `not-found`, `unavailable`, `internal`).
- Localization drops provider authorization on cross-origin redirects, rejects
  private/reserved redirect targets, and returns no partial content when a
  transfer violates its configured bounds.
- Published-backing linkage is persisted as `ArtifactStorageBinding` (`role = published`, `kind = artifact-repo`) after successful publish verification.
- Artifact detail read flow can surface published-backing metadata from binding records so thin-client detail panels can render durable remote backing state.
- Published backing data is now hardened as a structured target + verification model:
  - `target` (`provider`, `repository`, `path`, `revision`, `locator`)
  - `verification` (`exists`, `verifiedAt`)
- Locator fallback compatibility remains supported through centralized backing-target resolution helpers for legacy rows.
- Artifact identity and backing identity are now explicitly separated:
  - internal artifact id is system-owned for new repo registrations/imports,
  - provider/repository/path/revision identify backing/source relationships.

### Repo-backing authority update (April 2026)

- New publish and register-from-repo writes must populate structured `backing.target` fields (`provider`, `repository`, `path`, `revision`) on `ArtifactStorageBinding`.
- Read and verify/update paths now treat structured target data as authoritative and only fall back to locator decoding for legacy bindings that predate structured targets; legacy verify/update flows should backfill structured targets when possible.
- Remote registration now writes `role = imported-source` bindings (not `published`) to preserve backing semantics.
- Imported artifacts can now be explicitly localized/downloaded through shared orchestration (`artifact.localize.from-repo`) while keeping artifact browser as the primary surface.
- Imported-source verification is exposed as a separate shared operation (`artifact.source.verify`) so source backing status can be refreshed distinctly from published backing status.

## Hugging Face token persistence

- Hugging Face token configuration is stored as host-side config, not browser-only state.
- Managed server paths persist a separate owner-only provider credential beneath
  the server storage root for each organization. The active authenticated
  organization is required for status, mutation, and use; status and API
  responses never contain the raw secret.
- Managed token updates through both the focused token API and generic Settings
  API converge on the same organization-aware credential service. There is no
  second global in-memory token slot.
- A legacy server token or `HF_TOKEN`/`HUGGING_FACE_TOKEN` value is never
  assigned across a pooled deployment. Migration requires an explicit target
  organization (or the one organization in dedicated placement), writes the
  target atomically, and retires the legacy file only after success.
- Desktop path persists token under desktop AppData artifact config directory and surfaces masked status to renderer via preload/IPC.
- Hugging Face artifact-repo and model adapters resolve one token dynamically
  for the active operation; managed hosts supply the organization-aware
  provider while local hosts retain their device-local provider.

## Asset Kernel local record persistence

Local Asset Kernel persistence is structured record persistence, not artifact/blob storage. `composeLocalAssetKernel` receives the host-selected document store; its root-relative Asset Kernel identities also define the explicit legacy JSON import layout. The helper returns path-safe diagnostics (`storeKind`, `schemaVersion`, and initialized state) rather than local filesystem paths, and it does not store artifact/resource bytes, generated image/model/dataset payloads, secrets, tokens, runtime installs, or provider-native file handles.

Desktop and server host registration initialize this store for internal host composition under `storageRootDirectory` only; runtime roots must not be used for Asset Kernel records or resource-backed provider reads. Built-in definition seeding and trusted system-pack installation are explicit internal application services. Host startup invokes and awaits the installer with the guarded system-definition refresh option so product-owned immutable entries can advance with the compiled manifest while user/custom conflicts still fail without overwrite; failure to establish the foundation fails host feature composition closed. Managed hosts keep global immutable definitions on the deployment store while organization-owned instances, compositions, workspaces, implementation records, and related operations retain the request-context store. Trusted implementation seeding runs inside that active organization context, validates exact immutable release/binding fields, and skips compatible existing records. These services do not write files directly, import persistence adapters, create migrations, create durable active-pack records, apply override/resolver behavior, or expose public install/import/export surfaces.

The registry read facade is an application-layer service only. It reads through repository ports and an optional computed resource-backed view provider, treats `system.foundation` records as system defaults only when trusted source metadata or an installer-managed marker proves that ownership, never scans storage, never executes seeding, and validates only when explicitly requested. Shared host-level `composeInternalAssetRegistry` wiring composes the local store, read facade, and safe resource-backed provider aggregate for private consumers while retaining path-safe diagnostics and no automatic seeding.

Read-only Asset Registry API/IPC/preload wrappers and desktop/thin-client Asset Library pages operate over persisted definitions and computed resource-backed view list/detail reads. This does not change the persistence/storage boundary: Asset Library UI and transport code must not access local persistence adapters, storage adapters, filesystem paths, resource bytes, provider clients, runtime roots, resolver result objects, or resource scans directly. Built-ins appear only when already persisted/seeded through internal seeding, and resource-backed views remain computed descriptor-only read models that do not read bytes or turn generated outputs/external repository objects into registered assets.

Resource-backed mappings are still not persisted. Artifact/document, image/generated-output, dataset/model, and external-repository object views are computed from safe descriptor/read seams only. Asset Kernel persistence continues to store records only, not resource bytes, generated outputs, source files, thumbnails, model files, dataset files, provider payloads, or durable resource-backed view mappings.

## Runtime roots are not artifact storage roots

Runtime roots are neither persistence nor artifact-object storage roots. Runtime roots contain sidecar installs, managed Python environments, dependency state, runtime caches, and temporary sidecar outputs.

Artifact storage roots contain durable artifacts and catalog-backed content. ComfyUI `output/` should be treated as runtime/temp staging until generated outputs are finalized into artifact storage.

Shared model storage is a configured host-local storage source for model discovery and reuse across workspaces. It is intentionally separate from workspace model inventory persistence: discovery produces read-only shared inventory entries at list/read time, while workspace downloads and generated models remain persisted workspace records. Model registry files must not persist discovered shared entries just because a workspace listed them.

Server defaults should keep `SERVER_STORAGE_ROOT` and `SERVER_RUNTIME_ROOT` distinct. Desktop local mode should use desktop-owned runtime roots and desktop-owned artifact storage roots. Server/thin-client mode should use server-owned runtime roots and server-owned artifact storage roots. Future desktop-remote mode should not assume remote artifacts are local files.

See ADR-0013 and ADR-0012.

## Storage security guidance

Storage keys are opaque identifiers, not raw paths. Filesystem storage adapters must enforce path canonicalization + containment under configured storage roots. Artifact content reads/writes should be authorization-aware. Secrets and credentials are not ordinary settings payloads. Optional encryption at rest should be introduced via a `DataProtectionPort` seam, and audit events should cover sensitive artifact operations. See ADR-0015.

## Workspace contract vocabulary and storage descriptors

workspace foundations introduces passive workspace contracts and application workspace creation foundations. `WorkspaceStorageRootDescriptor` names storage ownership by descriptor fields such as kind, storage id, and label; it is not a public raw filesystem path contract. Workspace creation may store a host-managed descriptor and may explicitly persist active workspace selection through the selection repository, but it does not create resource directories or scope artifacts/images/models/data. Workspace system-pack activation records are reference-only summaries of system pack id/version and do not install, copy, or embed system pack definitions into workspace storage; the system foundation pack baseline installer remains separate and is not used for workspace activation.

### Active workspace selection boundary

Active workspace selection is a persisted host/UI preference or request-context value used to gate workspace-scoped pages. It is not a persistence authorization boundary and is not application-service global mutable state. Workspace-scoped persistence for assets, artifacts/data, models, images, and generated outputs requires explicit workspace ids and must not be inferred from UI state alone.

## Workspace system pack activation availability

Workspace system-pack activation storage remains a reference-record store only. The application-layer activation read/list/status use cases consume `WorkspaceSystemPackActivationRepository` records, recognize only the known `system.foundation@1.0.0` reference, and return sanitized diagnostics plus a compact active-system-pack availability result. They do not write Asset Kernel definitions, copy manifests/assets into workspace directories, create resource-scoped artifact/data/model/image storage, call the system foundation pack baseline installer, or scan filesystem pack directories. Public pack import/export/install/override behavior, collaboration, and Asset Library effective-view filtering remain deferred.

## Workspace-scoped artifacts and uploads

Artifact catalog browse, artifact detail/content reads, and upload/store flows are workspace-scoped. Callers must provide an explicit workspace id; missing or invalid workspace context fails safely and must not fall back to legacy global artifact catalog records. New uploaded artifact records carry workspace ownership, and upload-generated storage keys use a workspace namespace under `workspaces/<workspaceId>/artifacts/files/` rather than display names or raw host paths. Legacy unscoped artifact records are not auto-migrated or shown in workspace-scoped artifact pages; any future import/migration must be explicit.

Desktop artifact publication is also workspace-scoped. The use case authorizes
the workspace principal before artifact/catalog/binding/credential/provider
reads, requires artifact-write and provider-credential-use capabilities, and
requires the repository-create capability plus explicit approval when a missing
repository may be created. Desktop authorization decisions use a security audit
sink distinct from diagnostics. Renderer media previews use revocable Blob
object URLs over exact bounded byte slices; data URLs and base64 copies are not
part of the desktop preview transport.

User/workspace-owned image asset records, generated-output descriptors/finalization, dataset preparation outputs, model inventory records, and runtime task outputs created from workspace actions require an explicit workspace id. Missing workspace context must fail safely and must not fall back to global records. Workspace-owned records from one workspace must not be listed or read as another workspace. Generated-output finalization validates source workspace ownership before writing finalized image assets or Asset Kernel instances, and finalized provenance/metadata carries workspace context. Legacy global image/model/dataset/generated-output records are not silently assigned to a hidden/default workspace and are not auto-migrated; any import/migration flow must be explicit. Global runtime readiness, installed-runtime/model diagnostics, and provider configuration diagnostics may remain global, but they must not be presented as workspace-owned resource records. User Library and cross-workspace reuse remain governed by their own canonical docs.

## workspace foundations workspace persistence stabilization

Workspace records, active-selection preferences, and system-pack activation records persist through workspace repositories. Save/update semantics remain distinct: update does not create missing workspace records, and activation status updates do not create missing activation records. Active workspace selection is a preference only, not authorization.

Workspace-owned resources require explicit workspace ids and must not fall back to legacy global storage. Artifacts/uploads use a workspace-scoped root/keyspace. Image assets, generated outputs, dataset outputs, model inventory records, and runtime task outputs are workspace-scoped where implemented; legacy global records are not auto-migrated or silently assigned to a hidden/default workspace. Storage descriptors exposed through contracts remain path-free, and public diagnostics must not expose raw roots or provider payloads.

workspace foundations final cleanup hardens resource reads at the storage boundary: artifact byte retrieval must first validate the workspace-owned catalog record and must not fetch bytes after missing, invalid, wrong-workspace, or unavailable catalog ownership checks. Missing catalog files represent an empty catalog, but non-`ENOENT` catalog read failures are operational failures and must not be hidden as empty lists. Storage/catalog/generated-image errors crossing application, API, IPC, preload, renderer, or thin-client boundaries must use fixed sanitized messages plus safe operation/error-code details only. Generated image persistence must validate/brand workspace ids before constructing `workspaces/<workspaceId>/generated/images/...` keys. Normal model UI/API read models omit raw `localPath`, `validationReportPath`, and equivalent filesystem diagnostics; upload clients require an active workspace id before sending API/IPC requests.

## Workspace persistence boundary

workspace foundations is Workspace Foundations. Workspace-owned persistence and storage reads/mutations must receive an explicit workspace id from contracts, clients, transports, use cases, ports, providers, and adapters; UI gating alone is not sufficient. Missing workspace context must fail safely or return sanitized diagnostics rather than falling back to global records.

`system.foundation@1.0.0` remains system-owned and is activated by workspace reference only. Workspace activation persistence must not copy definitions into workspace storage, call the system foundation pack baseline installer, create workspace-scoped startup seeds, create hidden/default workspaces, or auto-migrate legacy global resources. This does not prevent the host-owned global foundation installer described above. Until deeper per-workspace Asset Kernel storage exists, adapters may use safe metadata/source ownership filtering for workspace-scoped duplicate/read paths, but must not expose raw paths, storage roots, task payloads, prompts, workflow JSON, or unsafe provider data in diagnostics.

## Approved-release system-data persistence

`createStructuredSystemDataRepository` stores release-owned records and
append-only audit evidence through the shared structured-document seam. Keys
include workspace, release, entity, and record/audit identity; organization
partitioning remains adapter-owned. Record creation/update and audit append are
one transaction, record updates require the expected application revision, and
there is no audit mutation/delete operation in the repository port.

SQLite production-runtime integration covers round-trip, audit, stale-write
rollback, backup, and restore on the Electron database implementation.
PostgreSQL live conformance covers the same repository semantics, serializable
retry, and organization RLS isolation when a disposable `TEST_POSTGRES_URL`
target is available. The reference migration-plan artifact is release evidence;
it does not execute destructive DDL or replace the monotonic database migration
ledger.
