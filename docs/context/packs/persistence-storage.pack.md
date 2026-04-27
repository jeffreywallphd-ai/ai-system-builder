# Context Pack: Persistence and Storage

- Pack name: `persistence-storage`

## Purpose

- Keep implementation work aligned with the repository’s persistence/storage separation.
- Prevent conflating structured durable records with file/blob artifact handling.

## Use When

- Upload/download, generated artifact, export/import, or file-storage work.
- Temp workspace handling or local data directory decisions.
- Desktop AppData/server storage-root usage decisions.
- Persistence/storage adapter work and DB-vs-file responsibility boundaries.

## Do Not Use When

- Tasks with no persistence or storage impact.
- Pure UI-only tasks with no file/data boundary changes.

## Core Guidance

- Postgres is the default persistence target for structured durable application data.
- Storage adapters are a broad architecture category under `modules/adapters/storage`, not a single flat contract shape. Shared storage foundation contracts define family-neutral identity (`StorageKind`, `StorageProviderId`, `StorageBackingReference`).
- Storage is a separate concern from persistence and can include specialized storage families with distinct semantics.
- Artifact-object storage (keys/bytes/checksums/metadata, including `ArtifactObjectStorageLocator`) is one storage family; do not assume all storage concerns fit this shape.
- Artifact-repo storage is a valid storage specialization (provider/repository/revision/path plus import/publish behaviors).
- Hugging Face is now the first implemented artifact-repo provider adapter; do not frame it as "just another blob store" and do not treat it as the definition of the whole family.
- Ingestion/staged artifact contracts are the canonical higher-level intake semantics for inbound content; storage stays the underlying artifact capability.
- Persistence contracts stay record-oriented: operation identity + record reference + result/error envelope.
- Persistence operation names should stay helper-driven and transport-neutral (`lowercase.dot.segments` with no `api.`/`ipc.` prefixes).
- When persistence contracts include a record reference, operation identity should target that record type (`<recordType>.<action>[.<qualifier>...]`).
- Keep persistence family exports scoped to persistence contracts only.
- Keep application persistence-port seams operation-aware and record-oriented (not CRUD-generic), with focused anti-drift tests in `modules/application/ports/persistence/tests/`.
- Shared storage contracts should stay thin and family-neutral (`modules/contracts/storage`) and should avoid physical-path assumptions.
- Specialized families define operation contracts: artifact-object for key/blob semantics and artifact-repo for provider/repository/revision/path semantics.
- Shared ingestion contracts (`modules/contracts/ingestion`) should carry staged artifact intake metadata (for example source kind, original name, staged artifact identity) without becoming transport-specific.
- Storage key creation/normalization should flow through shared storage key helpers to prevent per-operation key-shape drift.
- Storage checksums should be computed in concrete storage adapters from persisted bytes and surfaced through descriptor results; checksum support does not imply deduplication behavior.
- Keep storage family exports scoped to storage contracts only.
- For artifact-browser read work, keep contracts split by concern:
  - browse/list contracts are metadata/catalog oriented,
  - detail/read contracts are artifact read-model oriented,
  - content retrieval stays in a separate content-read contract path and should remain descriptor/reference-oriented at canonical public boundaries (avoid raw-byte-first canonical payloads).
- The system artifact browser is a normalized browser over internal artifacts across backing-store differences.
- Do not implement direct filesystem browsing semantics in UI-facing contracts; keep artifact browser locators key-based and path-agnostic.
- Do not treat provider-native repo browsers (for example Hugging Face UI browsing) as replacements for normalized system artifact-browser contracts.
- Keep media retrieval on a separate retrieval path; do not collapse byte retrieval into descriptor-oriented artifact-browser contracts.
- Metadata records and file/blob content are different concerns and should stay separated. Use explicit linkage contracts (for example `ArtifactStorageBinding`) instead of flattening families.
- Application logic should depend on persistence/storage ports and contracts, not direct DB/filesystem details.
- AppData/server filesystem roots are deployment details, not architecture boundaries.
- Do not bury file/blob behavior inside runtime adapters or host glue.

## Key Constraints

- Physical location does not define architecture; boundary ownership does.
- Do not assume filesystem placement answers persistence-vs-storage design questions.
- Keep persistence adapters and storage adapters as distinct responsibilities.
- Keep provider import semantics and provider publication semantics explicit; do not flatten them into local blob put/get assumptions.
- For app-layer seams, pass request metadata through `ApplicationRequestContext` and keep storage request payload contracts focused on storage semantics.

## Canonical Source Docs

- `docs/adr/ADR-0004-persistence-and-storage-separation.md` — decision rationale for separating persistence and storage.
- `docs/adr/ADR-0008-ingestion-and-staged-artifact-semantic-model.md` — direction for ingestion-centric staged artifact semantics above storage mechanics.
- `docs/architecture/persistence-and-storage.md` — current boundary model and practical implementation guidance.
- `docs/architecture/module-dependency-rules.md` — dependency constraints for adapters and inner layers.
- `docs/architecture/host-model.md` — host wiring responsibilities vs storage/persistence ownership.
- `docs/standards/coding-standards.md` — boundary-safe implementation expectations.

## Common Over-Inclusions to Avoid

- Pulling full runtime/host docs for tasks limited to persistence/storage boundary clarity.
- Treating AppData/server path conventions as canonical storage architecture.
- Copying full canonical persistence/storage docs into prompts.

## Prompt Assembly Notes

- Typical set: `index` + `persistence-storage`.
- Add `architecture` for cross-layer boundary changes.
- Add `desktop-host` or `server-host` only when host-specific composition or path wiring changes.



## Current implementation checkpoint (artifact-repo family)

- Hugging Face adapter uses official `@huggingface/hub` client methods (`fileExists`, `uploadFile`, `downloadFile`) as the only provider integration path (no handcrafted fallback provider path).
- Server and desktop hosts expose publish workflow wiring through the shared application use case path (`PublishArtifactToRepoUseCase`), while keeping artifact-object storage flows separate and intact.
- Publish flow writes durable `ArtifactStorageBinding` records for published artifact-repo backings.
- Published backing metadata read paths should prefer structured backing target fields + backing verification metadata (`verification.exists`, `verification.verifiedAt`) when present and use centralized locator decode helpers only as fallback for legacy records.


- Current artifact-browser read adapters should prefer structured repo target fields for backing metadata and use locator decode only for compatibility with legacy rows.
- Current verify/update flows should also prefer structured repo target fields and only decode locator for compatibility; updates should backfill structured targets when available.
- Remote registration slice now exists (`artifact.register.from-repo`): verify remote target, create internal catalog record, persist `imported-source` binding.
- New registration writes use system-owned internal artifact ids; provider/repository/path/revision remain backing/source identity.
- Imported artifacts can now be explicitly localized (`artifact.localize.from-repo`) to create local artifact-object bytes when only remote-source backing exists.
- Imported-source verification can now be re-checked independently (`artifact.source.verify`) while preserving artifact-first read/detail semantics.


- Hugging Face token config now follows a host-side persisted config seam (server-storage-root for thin client and desktop AppData for desktop host) and is consumed dynamically by artifact-repo operations; do not fall back to client-only token state as source of truth.
