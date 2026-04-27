# Feature Context Template

> Use this template **selectively** for major, cross-cutting, or architecture-sensitive initiatives that will span multiple epics.
>
> Do **not** use it for every feature, small change, or single-story task.
>
> This template supports context assembly. It does **not** replace ADRs, architecture docs, or standards as canonical sources.
>
> **Authoring rule:** remove sections that are not materially relevant. Do not fill every section mechanically.

## Title

- Feature title:

## Status

- Draft | In progress | Ready | Superseded
- Owner(s):
- Last updated (YYYY-MM-DD):

## Objective

- What outcome this feature must produce.
- 1–3 measurable success signals when possible.

## Why This Feature Exists

- Problem/opportunity being addressed.
- Why now (business/technical driver).
- Why existing behavior is insufficient.

## Scope (In)

- Explicitly list included capabilities/boundaries.
- Keep this list finite and reviewable.

## Out of Scope (Explicitly Excluded)

- List what must **not** be implemented in this feature.
- Include adjacent requests intentionally deferred.

## Canonical References (Do Not Duplicate)

### Relevant ADRs

- `docs/adr/...`

### Relevant Architecture Docs

- `docs/architecture/...`

### Relevant Standards

- `docs/standards/...`

> Prefer links + short relevance notes, not long copied summaries.

## Key Affected Areas in the Repository

- `apps/...`
- `modules/...`
- `docs/...`
- `config/...` / `migrations/...` (if relevant)

For each area, note expected change type (new, modify, refactor, docs-only).

## Architectural Constraints

- Boundary rules that are non-negotiable for this feature.
- Dependency direction constraints.
- Host/runtime/transport/persistence/storage constraints (as relevant).

## Risks and Failure Modes to Avoid

- Highest-risk design/implementation mistakes.
- Likely overreach areas (scope creep, boundary violations, premature abstraction).
- Mitigations or guardrails.

## Sequencing Notes

- Suggested implementation order.
- Parallelizable vs serialized work.
- Blocking prerequisites.

## Suggested Epic Breakdown

- Epic 1: [name + bounded objective]
- Epic 2: [name + bounded objective]
- Epic N: ...

Each epic should have a clear boundary and explicit non-goals.

## Notes for Downstream Context Assembly

- Minimum context that downstream epic/story docs should include.
- Context that should usually be omitted to avoid prompt bloat.
- Known assumptions that must be revalidated before implementation.

## Exit / Done Signals

- What indicates this feature context is no longer needed or should be superseded.
- What canonical docs must be updated if architectural or standards decisions changed.
