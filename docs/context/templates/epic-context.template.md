# Epic Context Template

> Use this template for a coherent implementation slice inside a larger feature (or as a standalone bounded initiative when no feature context is needed).
>
> This is often the most practical reusable context unit for planning and execution.
>
> This template is not a general feature essay and not a replacement for canonical docs.
>
> **Authoring rule:** remove irrelevant sections instead of filling them with "N/A".

## Title

- Epic title:

## Parent Feature

- Feature context doc (if one exists):
- If none, explain why epic stands alone:

## Objective

- Specific outcome this epic must deliver.
- What will be true when done.

## Scope (In)

- Bounded capabilities included in this epic.
- Concrete implementation boundary.

## Out of Scope

- Explicit non-goals for this epic.
- Adjacent work deferred to later epics/stories.

## Dependencies / Prerequisites

- Required prior epics/stories/infra changes.
- Required migration/config/environment setup.

## Canonical References (Source of Truth)

### Relevant ADRs

- `docs/adr/...`

### Relevant Architecture Docs

- `docs/architecture/...`

### Relevant Standards

- `docs/standards/...`

> Link only what is needed for this epic. Avoid broad doc dumps.

## Affected Modules, Folders, or Subsystems

- `modules/...`
- `apps/...`
- `docs/...`

For each, specify touch intent: add, change, refactor, test, docs.

## Key Contracts, Boundaries, or Interfaces

- Contracts to create/update (`modules/contracts/...`).
- Ports/adapters/host boundaries involved.
- Interface ownership and dependency direction notes.

## Implementation Constraints

- Architectural constraints that must be preserved.
- Naming/coding constraints that materially affect this epic.
- Explicit "do not touch" areas.

## Logging, Testing, and Documentation Expectations

- Required logging behavior for changed flows.
- Required test layers and minimum coverage targets by behavior.
- Required documentation updates (if behavior/architecture/standards are affected).

## Risks and Anti-Patterns to Avoid

- Likely failure paths.
- Typical boundary mistakes for this epic.
- Over-inclusion and over-abstraction traps.

## Suggested Story Breakdown

- Story 1: [implementation-ready slice]
- Story 2: [implementation-ready slice]
- Story N: ...

Each story should be independently reviewable and boundary-safe.

## Minimum Recommended Task Context

For downstream story/Codex tasks, include only:

- Exact objective and acceptance criteria.
- Exact files/folders expected to change.
- Relevant canonical docs (small set).
- Key constraints and non-goals.
- Required tests/docs follow-through.

Omit broad background unless it changes implementation quality.
