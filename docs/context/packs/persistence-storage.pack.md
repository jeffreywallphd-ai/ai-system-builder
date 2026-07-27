# Context Pack: Persistence and Storage

- Pack name: `persistence-storage`

## Purpose

- Keep work aligned with the repository's persistence/storage separation.
- Prevent structured records, artifact bytes, repository objects, and runtime roots from being conflated.

## Use When

- Upload/download, generated artifact, import/export, artifact browser, or file/blob storage work.
- Model, dataset, image, generated-output, or shared model storage location work.
- Local AppData/server storage-root decisions, temp/staged intake, persistence adapters, or storage adapters.
- SQLite, PostgreSQL, database migration, backup/restore, or deployment-shape
  persistence selection.
- Workspace-scoped resource storage, artifact reads, or model/image/dataset persistence.

## Do Not Use When

- Pure UI-only work with no data, file, or storage boundary changes.
- Runtime execution work that does not read/write records or resources.

## Core Guidance

- Persistence stores durable structured records; storage stores bytes, objects, and provider-backed resources.
- Local structured persistence targets embedded single-host SQLite; campus,
  corporate, and cloud server shapes target client/server PostgreSQL.
- SQLite WAL databases must remain on one host and outside artifact/runtime roots.
- Host composition, not the config contract alone, selects the active adapter.
  Existing JSON records require the implemented explicit
  inventory/import/verification/rollback workflow before cutover.
- AppData/server path conventions are deployment details, not architecture boundaries.
- Persistence contracts are record-oriented and operation-identity driven.
- Storage contracts are family-specific: shared foundation identity, artifact-object key/blob semantics, artifact-repo provider/repository/revision/path semantics, and ingestion/staged-artifact intake semantics.
- Artifact browser list/detail/content concerns stay separated; media/content retrieval must not collapse into descriptor-first browse contracts.
- Artifact previews are bounded read-side renderers: sample text-like content, prefer compressed/downscaled image object URLs, constrain video/PDF display, keep Office previews placeholder-only without a safe parser, and leave full-fidelity viewing to download/open actions.
- Artifact upload classification requires coherent filename/media metadata and
  content evidence; binary signatures and valid UTF-8/JSON checks fail closed
  before storage.
- Storage keys are opaque contract vocabulary and must flow through shared helpers; UI-facing contracts must stay path-agnostic.
- Application logic depends on persistence/storage ports, not direct DB/filesystem/provider details.
- Host wiring composes concrete adapters and roots; runtime roots must not be used as persistence or asset-resource roots unless a canonical doc explicitly says so.
- Workspace-owned records and resources require explicit workspace context and must not fall back to global records.
- Organization-owned records and bytes additionally require explicit
  organization context. Platform/legacy records are a separate partition and
  are never an implicit fallback.
- Shared model storage is an additional configured model source, not a replacement for workspace model storage.

## Key Constraints

- Keep persistence adapters and storage adapters distinct.
- Keep provider import, localization, publication, and verification semantics explicit; do not flatten them into local blob put/get.
- Workspace-scoped artifact byte reads must validate workspace/catalog ownership before reading bytes.
- Missing catalogs can be empty when documented; non-`ENOENT` failures are safe operational failures.
- Public failures must not expose filesystem messages, absolute paths, storage roots, raw JSON lines, commands, env values, stacks, secrets, or resource contents.
- Normal UI/API model read models must not expose raw `localPath`, validation report paths, cache paths, or equivalent local diagnostics unless an admin boundary is documented and tested.
- Asset Kernel records store sanitized metadata/references only; they do not own artifact bytes, generated outputs, model files, dataset files, or provider payloads.

## Current Implementation Shape

- Deployment-target config maps local to SQLite and campus/corporate/cloud to
  PostgreSQL. Desktop composition actively selects the Electron SQLite runtime;
  explicit managed server shapes actively select the PostgreSQL runtime.
- Both engines provide schema-version-2 migrations, transactions, revisions, health,
  and portable exports. SQLite adds online backup/validated restore. Managed
  PostgreSQL backup/restore remains an operator/platform responsibility.
- Database-backed collection mutations use bounded revision compare-and-swap;
  PostgreSQL transactions use bounded full-callback retries at Serializable
  isolation. Mutation callbacks must remain pure because they may run again.
- JSON compatibility remains only for an unshaped non-production server. Import
  is allowlisted, rollback-preserving, activation-marked, and fail-closed on
  changed source; never add silent fallback, split-write, or implicit re-import.
- Managed deployment qualification uses digest-pinned database/application
  images, a restricted single-replica Compose/Kubernetes posture, separate
  liveness/readiness semantics, and retained scan/smoke/render evidence. Do not
  increase replicas before identity/tenancy and target-platform qualification.
- Schema version 2 adds organization-keyed documents. PostgreSQL enables and
  forces RLS with transaction-local tenant binding; SQLite provides the same
  logical partition for a generated local profile.
- Managed filesystem storage derives physical organization prefixes from the
  authenticated request scope while returning stable logical keys. Pooled is
  default; premium dedicated placement rejects every other organization.
- Legacy assignment is an explicit fingerprint-confirmed atomic move with a
  rollback source. Ordinary startup never assigns ownership.
- Artifact-object storage owns key/byte/checksum/metadata behavior.
- Artifact-repo storage owns provider/repository/revision/path import and publish behavior; Hugging Face is one provider adapter, not the whole storage family.
- Hugging Face token configuration is host-side persisted config, not
  client-only state. Managed servers isolate it by authenticated organization,
  use one credential service for token and Settings APIs, and require an
  explicit organization target before migrating any legacy/environment token;
  desktop/local hosts retain device-local scope.
- Hugging Face publication does not auto-create a missing repository. Creation
  requires explicit approval and visibility, plus active-organization
  capability authorization in managed hosts; private is the UI default.
- Artifact browser reads normalize internal artifacts across backing-store differences.
- Artifact browse caps sorted results, batches backing bindings, and bounds
  availability probes. Hugging Face dataset browse uses a capped logical
  converted-Parquet inventory and rejects foreign or malformed URLs.
- Remote registration/localization flows create or localize internal artifacts through shared application use cases.
- Workspace local persistence uses a `workspaces/` namespace for workspace records, active selection preference, and system-pack activation references.
- Workspace resource scoping applies where implemented for artifacts/uploads, image assets, generated outputs/finalization, dataset outputs, model inventory records, and runtime task outputs.

## Asset Kernel Notes

- Include `asset-kernel` when storage/resource work affects reusable assets or Asset Registry resource-backed views.
- Resource-backed views are computed, descriptor-only, sanitized read models over safe seams.
- Providers must not scan storage, read bytes, call provider clients, call runtimes, inspect model/dataset/image contents, or persist durable mappings during reads.
- Generated outputs become reusable only after explicit finalization/registration.
- External repository objects remain external until explicit import/localization/registration.
- `system.foundation@1.0.0` activation is reference-only and must not copy/install pack definitions into workspace storage.

## Canonical Source Docs

- `docs/adr/ADR-0004-persistence-and-storage-separation.md` - persistence/storage decision.
- `docs/adr/ADR-0025-deployment-shaped-structured-persistence.md` - deployment
  database defaults and JSON transition constraints.
- `docs/adr/ADR-0026-local-sqlite-runtime.md` - local driver, migration,
  transaction, health, backup, and restore behavior.
- `docs/adr/ADR-0027-managed-postgresql-runtime.md` - managed pool, TLS,
  migration lock, server selection, import, and shutdown behavior.
- `docs/adr/ADR-0028-atomic-structured-document-mutations.md` - revision
  compare-and-swap, retryable callback purity, and PostgreSQL retry policy.
- `docs/adr/ADR-0029-organization-tenancy-identity-and-authorization.md` - tenant identity, placement, RLS, and object-key containment.
- `docs/architecture/organization-tenancy-and-identity.md` - current tenancy implementation and operator procedures.
- `docs/adr/ADR-0008-ingestion-and-staged-artifact-semantic-model.md` - staged artifact intake model.
- `docs/architecture/persistence-and-storage.md` - boundary model and implementation guidance.
- `docs/architecture/workspace-model.md` - workspace scoping and active selection.
- `docs/architecture/asset-kernel.md` - asset/resource-backed view semantics.
- `docs/architecture/module-dependency-rules.md` - adapter dependency constraints.
- `docs/architecture/host-model.md` - host composition vs storage ownership.
- `docs/operations/persistence-operations.md` - maintenance, readiness, backup,
  restore, upgrade, rollback, and compatibility procedures.
- `docs/operations/deployment-qualification.md` - shape qualification evidence.
- `docs/standards/coding-standards.md` - boundary-safe implementation expectations.

## Common Over-Inclusions To Avoid

- Pulling runtime/host docs for pure persistence/storage boundary work.
- Treating filesystem placement as architectural ownership.
- Treating provider-native repo browsers as replacements for normalized artifact-browser contracts.
- Copying full persistence/storage docs into prompts.

## Prompt Assembly Notes

- Typical set: `index` + `persistence-storage`.
- Add `asset-kernel` for resource-backed Asset Registry or Asset Library work.
- Add `security` when storage reads/writes expose public diagnostics, credentials, tokens, paths, or provider metadata.
- Add `desktop-host` or `server-host` only when host-specific root composition, API/IPC wiring, or thin-client behavior changes.
