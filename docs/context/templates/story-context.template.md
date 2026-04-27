# Story Context Template

> Use this template for a single implementation-ready work item (human or AI-executed).
>
> This should be the most operational context artifact: precise, bounded, and execution-oriented.
>
> **Authoring rule:** delete sections that are not materially relevant. Do not fill mechanically.

## Title

- Story title:

## Parent Epic

- Epic context doc:
- Parent feature doc (optional):

## Objective

- Exact outcome required for this story.
- One-sentence "done" statement.

## Exact Scope

- Specific behavior/files/interfaces in scope.
- Boundaries that must not be crossed.

## Explicit Non-Goals

- What this story must not implement.
- Deferred follow-ups tracked elsewhere.

## Repository and Branch Context

- Repository: `ai-system-builder`
- Target branch (if predefined):
- Related PR/issues/tasks:

## Target Files or Directories

- Files/paths expected to change:
- Files/paths that must not change:

## Canonical References (Minimum-Sufficient)

### Relevant ADRs

- `docs/adr/...`

### Relevant Architecture Docs

- `docs/architecture/...`

### Relevant Standards

- `docs/standards/...`

> Include only docs that directly constrain this story.

## Constraints and Anti-Patterns to Avoid

- Boundary constraints to preserve.
- Naming/coding constraints that are critical here.
- Common mistakes to avoid for this story.

## Implementation Guidance

- Suggested implementation approach (short, concrete steps).
- Contract-first or test-first expectations (if required).
- Sequencing notes if order matters.

## Logging Requirements

- Required log points (boundary events, failures, timings as needed).
- Required structured fields for new/updated logs.
- Redaction/privacy constraints.

## Testing Requirements

- Required tests to add/update (unit/integration/UI).
- Required behavior coverage (success/failure/regression).
- Determinism and CI expectations.

## Documentation Requirements

- Docs that must be updated in the same change (if applicable).
- Whether ADR/architecture/standards/context docs need updates.

## Acceptance Criteria

- [ ] Criterion 1 (observable behavior)
- [ ] Criterion 2 (boundary/contract correctness)
- [ ] Criterion 3 (tests/logging/docs complete)

Keep criteria testable and reviewable.

## Output Expectations

- Expected deliverables (code/tests/docs).
- Expected verification commands.
- Explicit completion checklist for handoff/review.
