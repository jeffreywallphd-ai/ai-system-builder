# Documentation Standards

## Purpose

Documentation in `ai-system-builder` is part of the system, not commentary about the system.

It exists to:

- preserve architectural intent during a rebuild,
- keep contributors and AI agents aligned on boundaries,
- reduce drift between implemented behavior and expected behavior,
- make major decisions traceable over time.

If the code and docs disagree, the implementation is not complete.

## Canonical documentation hierarchy

Use these folders intentionally and do not blur their roles:

- `docs/adr/`
  - Decision records: **why** a meaningful architectural decision was made.
  - Source of truth for accepted/superseded decisions over time.
- `docs/architecture/`
  - System shape and dependency boundaries: **how** the architecture is organized.
  - Operational guidance for where code belongs and what may depend on what.
- `docs/standards/`
  - Canonical rules for implementation quality and consistency: **how we work here**.
  - This includes coding, naming, logging, testing, and documentation standards.
- `docs/context/`
  - Task-oriented, situational summaries used to accelerate implementation.
  - Must derive from canonical docs (`adr`, `architecture`, `standards`) rather than redefining them.

Rule: canonical standards belong in `docs/standards/`, not only in prompts, chat threads, or temporary AI context files.

## Documentation quality rules

All repository docs must be:

- **specific** to `ai-system-builder` architecture and directory model,
- **actionable** for implementation and review,
- **explicit** about what is decided vs not yet finalized,
- **maintained** with code changes that alter documented behavior.

Avoid:

- vague placeholders (`TBD`, `future-proof`, `to be decided later`) without concrete scope,
- generic textbook prose not tied to repository boundaries,
- duplicate guidance spread across multiple docs with subtle conflicts,
- “aspirational” statements with no observable implementation or decision backing.

## Documentation update requirements

Documentation updates are required in the same change set when any of the following occurs:

- architectural boundary changes,
- dependency direction changes,
- host/runtime/transport/persistence responsibilities change,
- application port-family boundaries, required seam usage, or port contract-alignment rules change,
- transport contract specialization rules, operation identity constraints, or IPC channel rules change,
- runtime/logging diagnostic normalization rules change,
- persistence/storage contract-family invariants or export discipline change,
- behavior that docs currently describe is materially altered,
- standards are added, tightened, or intentionally relaxed.
- an application port seam is added or materially changed (ownership, required usage, or contract alignment expectations).

A pull request is incomplete if behavior changed but canonical documentation was not updated.
Document seam ownership and stable boundary rules; do not mirror adapter internals or transient implementation details.

## When to update ADRs vs architecture docs vs standards

### Update an ADR when

- a meaningful architectural decision is introduced,
- an accepted decision is replaced or constrained,
- tradeoffs and alternatives need durable historical capture.

Use `docs/adr/template.md` and maintain ADR status (`proposed`, `accepted`, `superseded`, `deprecated`).

### Update architecture docs when

- repository shape, layer responsibilities, or dependency rules change,
- host model/runtime model/persistence model behavior changes,
- previously “not finalized” areas become concrete.

### Update standards docs when

- repository-wide implementation expectations change,
- conventions need stronger enforcement to prevent drift,
- repeated review failures indicate missing or unclear standards.

## AI context relationship

`docs/context/` is downstream from canonical docs.

- Context docs may summarize, sequence, or package guidance for tasks.
- Context docs must link back to canonical sources.
- Context docs must not quietly introduce conflicting architecture or standards.

If a context doc conflicts with an ADR/architecture/standard doc, fix the context doc or propose a canonical doc update first.

When a canonical change affects context-pack guidance, update only the materially relevant packs in the same work item.

## Consistency and templates

Use repository templates where they exist (`docs/templates/`, `docs/adr/template.md`) to keep structure consistent.

Expectations:

- stable headings and sections for scanability,
- concise rationale + rule + expected behavior,
- explicit cross-links for related docs when useful,
- filenames and document titles that match repository naming standards.

## Review checklist for documentation changes

Before merging:

- Does this change reflect current implementation behavior?
- Is any canonical guidance duplicated elsewhere and now inconsistent?
- Should this have been an ADR instead of a silent doc edit?
- If behavior changed in code, were architecture/standards/context docs updated appropriately?
- Would a new contributor understand what to do without reading chat history?

If the answer to any question is “no”, revise before merge.
