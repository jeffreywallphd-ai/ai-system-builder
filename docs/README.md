# Documentation Map

This directory is organized into four documentation areas with distinct roles.

## Areas and Roles

- `docs/adr/`
  - Architecture Decision Records (ADRs): major architectural decisions and rationale.
- `docs/architecture/`
  - Current intended system structure, module boundaries, and operating model.
- `docs/standards/`
  - Canonical implementation and documentation rules.
- `docs/context/`
  - Reusable context-assembly support for prompts and implementation work.

## How to Use These Docs

- Read ADRs for major decision history and constraints.
- Read architecture docs for structure and boundary guidance.
- Read standards docs for canonical rules to follow during implementation.
- Use context docs to assemble task-relevant context without replacing canonical docs.
- If context docs conflict with ADR/architecture/standards docs, canonical docs take precedence.

## Automation Note

- Start prompt assembly from `docs/context/packs/index.pack.md`.
- Use `docs/context/prompt-routing.md` to choose only additional packs that are materially relevant.
- Include `docs/context/packs/persistence-storage.pack.md` for DB-vs-file/blob boundary work.
