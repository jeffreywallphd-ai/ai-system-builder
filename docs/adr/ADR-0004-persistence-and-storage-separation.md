# ADR-0004: Persistence and Storage Separation

- Status: accepted
- Date: 2026-04-14
- Deciders: ai-system-builder maintainers
- Related: docs/adr/ADR-0001-repository-structure.md, docs/architecture/persistence-and-storage.md

## Context

The rebuild requires a clear default for durable structured data while also anticipating significant file/blob artifact handling.

The architecture already points toward Postgres for structured persistence, and toward separate adapter areas for persistence and storage. This ADR formalizes that split so teams do not collapse file handling into runtime, host, or persistence layers.

Storage is broader than a single file/blob shape. The repository already has artifact/object-oriented storage contracts for key/byte operations, and is moving toward additional specialized storage families (for example repo-backed storage with provider/revision/publication semantics).

Key risk areas to avoid:

- treating host filesystem locations (for example desktop AppData paths or server local paths) as if they define architecture,
- mixing relational record concerns with file/blob artifact concerns,
- hiding artifact behavior inside unrelated adapters.
- flattening every storage capability into one artifact-key/blob contract even when semantics differ materially.

## Decision

`ai-system-builder` adopts a **separated persistence and storage model**:

- Postgres is the default persistence system for structured durable application data.
- Persistence and storage are separate architectural concerns.
- Persistence concerns relational/queryable records and structured state.
- Storage adapters are a broad category that contain specialized contract and implementation families with a shared foundation (`StorageKind`, `StorageProviderId`, and thin `StorageBackingReference`).
- Artifact/object storage remains a first-class storage family centered on artifact keys, bytes, checksums, and artifact metadata (`ArtifactObjectStorageLocator` + store/retrieve/has/delete object contracts).
- Repo-backed storage is also storage, with distinct semantics (provider/repo identity, revision/version behavior, and path semantics) and dedicated contracts (`ArtifactRepoTarget`, `ArtifactRepoDescriptor`, `store/retrieve/has artifact in repo`).
- External repo-backed storage must not be collapsed into persistence records and must not be flattened to simple artifact-key/blob semantics.
- Physical disk location does not remove the need for a storage abstraction.
- Application logic depends on persistence and storage ports/contracts rather than concrete database or file-path details.
- Persistence operation identity remains helper-driven and record-aligned (`<recordType>.<action>[.<qualifier>...]`) when a record reference is present.
- Storage identity remains artifact-key-based and path-agnostic through shared key normalization helpers.
- Persistence and storage contract barrels must export only family-owned surfaces; cross-family leakage is not allowed.
- Initial artifact-browser read flow should keep concerns split:
  - browse/list and detail/view operations are metadata/query/read-model concerns aligned to persistence + artifact descriptors,
  - content retrieval is a distinct artifact-content path, modeled canonically as descriptor/reference-oriented content access rather than raw-byte-first transport payloads.
- Artifact browser contracts are normalized system-artifact contracts; they are not filesystem traversal contracts and are not provider-native repository browsing contracts.
- Linkage between persistence metadata and storage artifacts should be explicit (for example through normalized artifact keys or `ArtifactStorageBinding`) without collapsing persistence and storage into one concern.

This sets architectural roles without freezing all storage implementation specifics at this stage.

## Alternatives Considered

### 1) Single data layer for both records and artifacts

Rejected.

Combining concerns would blur lifecycle and operational policies, complicate reasoning, and increase coupling between relational and file semantics.

### 2) Host-path-defined storage architecture (for example, desktop AppData as the model)

Rejected.

Physical deployment paths are environment details, not architectural definitions of storage behavior.

### 3) Runtime-adapter-owned file/blob management

Rejected.

Burying storage inside runtime adapters would make artifact policies implicit and harder to test, evolve, and operate.

## Consequences

### Positive

- Strong default persistence direction through Postgres for structured data.
- Clear architectural home for artifact/file/blob concerns.
- Better long-term flexibility to support multiple storage implementation families (artifact/object and repo-backed) without redefining application roles.
- Cleaner operational reasoning around backups, retention, and data handling responsibilities.
- More mechanical family boundaries with less room for naming/shape drift across persistence and storage adapters.

### Negative

- Requires explicit modeling of metadata linkage between persistence records and storage artifacts.
- Early implementations may need additional adapter scaffolding compared to direct file-path coding, especially as storage families diversify beyond artifact-key/blob-only flows.
- Contributors must maintain two adjacent abstractions instead of one convenience layer.

## Follow-up Documentation or Implementation Needs

- Keep `docs/architecture/persistence-and-storage.md` aligned with this ADR as implementations mature.
- Document baseline persistence and storage port conventions in `docs/standards/` when first adapters are implemented.
- Add guidance for linking persistence metadata to storage artifact identifiers without conflating roles.
- Maintain family invariant tests that protect record-operation alignment, key normalization, and family export discipline.
- Record a follow-up ADR when repo-backed storage contract families and first provider adapters (likely Hugging Face) are formalized.

Note: detailed storage backend and lifecycle policy specifics are intentionally not finalized by this ADR.
