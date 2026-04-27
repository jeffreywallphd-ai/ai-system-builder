# ADR-0008: Ingestion and Staged Artifact Semantic Model

- Status: accepted
- Date: 2026-04-16
- Deciders: ai-system-builder maintainers
- Related: docs/architecture/system-overview.md, docs/architecture/persistence-and-storage.md, docs/context/packs/persistence-storage.pack.md

## Context

The current implementation has a working artifact-upload vertical slice, but the platform direction is broader than image/file upload alone.

Inbound content spans multiple intake shapes:

- user-uploaded content,
- scraped content,
- generated outputs selected for retention,
- API/runtime-driven inbound payloads,
- content imported from external repo-backed storage providers.

Treating each of these as isolated file operations causes vocabulary and contract drift:

- narrow upload/file semantics become overfit to one vertical slice,
- metadata conventions drift between transports and hosts,
- future staged inspection surfaces lack a shared canonical object model,
- multi-host evolution (desktop/server/hybrid) risks duplicating intake semantics in host- or transport-specific ways.

The repository already separates persistence (records) from storage (artifact bytes). What was missing is a higher-level semantic contract for inbound staged artifacts that sits above raw storage mechanics while staying transport-neutral.

## Decision

Adopt ingestion/staged-artifact as the canonical higher-level semantic model for inbound content regardless of backing store origin.

### Direction-setting decisions

- The system moves from isolated upload/file semantics toward a shared ingestion and staged artifact model.
- Uploaded, scraped, and selected generated/API/runtime inbound content are modeled as staged artifacts.
- Storage remains a generic architecture category with specialized storage families (artifact-object and artifact-repo) over a shared storage foundation; ingestion contracts define higher-level staged artifact semantics above those families.
- Inbound staged artifacts may originate from artifact-object storage (key/blob/object) or from artifact-repo storage (provider/repository/revision/path).
- Import from repo-backed providers should normalize into canonical internal staged artifact semantics and descriptor vocabulary.
- Existing artifact upload remains a specialized intake path and is aligned to the staged artifact model.
- Canonical metadata vocabulary for intake outcomes is ingestion-centric (source kind + staged artifact descriptor), not image-only.
- Early viewer direction is staged artifact inspection (an early data-lake-like surface), not a generic file browser.
- The first end-to-end read-side vertical slice is image-backed artifact browsing and viewing:
  - `artifact.browse` for catalog/metadata-oriented list behavior,
  - `artifact.read` for single-artifact detail/read-model behavior,
  - `artifact.content.read` as a distinct content-retrieval path (separate from browse/detail metadata contracts) with canonical descriptor/reference-oriented content-access semantics.
- This browser/viewer direction is artifact/catalog oriented and storage-key based; it does not introduce filesystem-path browsing semantics.
- The system artifact browser is a normalized browser over internal artifacts; it is not a provider-native repository browser.
- Provider-native browsing/viewing semantics may coexist (for example in external repo UIs), but they do not replace normalized system artifact browser contracts.
- Publication to repo-backed providers is a separate semantic operation from local byte storage and should be modeled as such in specialized storage/provider flows.

### ELT progression posture

This ADR sets semantic direction compatible with future ELT-style progression:

1. intake,
2. raw/staged storage,
3. metadata/cataloging,
4. transformation,
5. viewing/exploration.

This ADR does **not** commit the repository to implementing a full ELT platform immediately.
The image-backed artifact browser/viewer direction should be read as early staged-artifact exploration capability, not a claim that full ingestion/catalog/ELT platform maturity is complete.

## Consequences

### Positive

- Contract vocabulary becomes durable across transports (API/IPC) and hosts (desktop/server).
- Image upload remains functional while becoming clearly one intake specialization.
- Future ingestion paths (including repo-backed imports) can reuse the same staged artifact descriptor semantics, reducing parallel semantic drift.
- Documentation and context-routing can reference one intake model with minimum-sufficient pack inclusion.

### Negative

- Teams must distinguish ingestion semantics from storage mechanics instead of using file upload as a catch-all.
- Teams must keep repo-backed provider import/publication semantics explicit rather than flattening them into local blob assumptions.
- Additional follow-up ADRs may be needed when metadata cataloging, transformation orchestration, or viewer capabilities become implementation priorities.

### Follow-up

- Keep ingestion contracts intentionally small and transport/storage neutral.
- Align specialized intake contracts/results (starting with artifact upload) to staged artifact descriptor semantics.
- Update context packs and architecture docs only where stable semantic guidance changed.
