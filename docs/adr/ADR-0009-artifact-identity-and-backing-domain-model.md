# ADR-0009: Artifact Identity and Backing Domain Model

- Status: accepted
- Date: 2026-04-18
- Deciders: ai-system-builder maintainers
- Related: ADR-0004, docs/architecture/system-overview.md, docs/architecture/persistence-and-storage.md

## Context

Artifact publish/verify/register/import logic had identity and backing rules spread across use cases and adapters.
Repo coordinates were also being used as de facto internal artifact ids for registration/import.

This created boundary ambiguity:

- internal artifact identity vs provider/repo/path/revision backing identity,
- duplicate backing updates across publish/verify/register flows,
- imported artifacts with remote source metadata but no explicit localize step.

## Decision

Introduce a small artifact domain slice under `modules/domain/artifact/`:

- `ArtifactId` as canonical internal id value object (system-owned for new registrations/imports),
- `SystemArtifactIdFactory` as the id-generation policy seam used by application composition/use cases,
- `ArtifactBacking` as backing/source role + verification value object,
- `Artifact` as lightweight entity for backing attach/update/dedup decisions.

Apply this domain model in:

- `PublishArtifactToRepoUseCase`,
- `VerifyPublishedArtifactBackingUseCase`,
- `VerifyImportedArtifactSourceBackingUseCase`,
- `RegisterArtifactFromRepoUseCase`.

Add shared import-usefulness step:

- `LocalizeArtifactFromRepoUseCase` for explicit download/localize of imported artifacts,
- exposed through server API, desktop IPC/preload, thin-client and desktop artifact-browser clients/UI.
- imported-source verification re-check (`artifact.source.verify`) follows the same shared application path through server + desktop transports.

## Consequences

### Positive

- Internal artifact identity is now explicit and system-owned for new import/register writes.
- Backing/source identity remains backing metadata (`provider/repository/path/revision`), not canonical artifact identity.
- Backing role and verification updates are centralized and reused across publish/verify/register/localize workflows.
- Artifact browser remains the primary surface, now with explicit imported-source/published/local-object state clarity and post-localize progression.

### Negative

- Transitional compatibility must preserve legacy records that still use repo-derived ids and locator-only backing rows.
- Domain model usage currently focuses on artifact-repo publish/import workflows; broader domain coverage is still incremental.

### Follow-up

- If/when migration tooling is introduced, migrate legacy repo-derived artifact ids to system-owned ids while preserving backing references.
- Extend localize/read capabilities by artifact kind as new slices beyond images are implemented.
