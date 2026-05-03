# Context Documentation

`docs/context/` contains reusable context-assembly artifacts for prompt construction and implementation planning.

It is designed to help contributors assemble **minimum-sufficient** task context quickly.

## How Context Docs Differ from Canonical Docs

Canonical guidance lives in:

- `docs/adr/` for architectural decisions.
- `docs/architecture/` for intended system structure and boundary model.
- `docs/standards/` for canonical implementation and documentation rules.

Context docs summarize and route that guidance for execution workflows. They do not replace canonical sources.
If a context pack/template conflicts with ADRs, architecture docs, or standards docs, canonical docs take precedence.

## Folder Structure

- `docs/context/packs/`
  - Reusable context modules used to assemble task-specific prompt context.
  - Packs are compact summaries and routing aids tied back to canonical docs.
- `docs/context/templates/`
  - Optional scaffolds for feature, epic, and story context artifacts when structured work-item context is useful.
  - Not every task or feature needs feature/epic/story context files.
- `docs/context/prompt-routing.md`
  - Lightweight decision guide for choosing which packs to include.

## Template Location Clarification

- The pack template is `docs/context/packs/pack.template.md`.
- It is intentionally stored in `docs/context/packs/` (not in `docs/context/templates/`).
- Feature, epic, and story templates remain in `docs/context/templates/`.


## Context Pack Index (Selected Packs)

- `docs/context/packs/index.pack.md`
  - Baseline pack included for all automated prompt assembly.
- `docs/context/packs/debugging-error-handling.pack.md`
  - Select for debugging/error-fix prompts (errors, exceptions, hangs, timeout, transport disconnect, runtime still running).
  - Focuses on execution timeline, invariants, lifecycle-safe error handling, and boundary-preserving fixes.

Use `docs/context/prompt-routing.md` for full pack selection rules and minimal-context routing.
