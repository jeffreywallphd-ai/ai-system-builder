# Context Documentation

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`docs/context/` contains reusable context-assembly artifacts for prompt construction and implementation planning.

It is designed to help contributors assemble **minimum-sufficient** task context quickly.

## How Context Docs Differ from Canonical Docs

Canonical guidance lives in:

- `docs/adr/` for architectural decisions.
- `docs/architecture/` for intended system structure and boundary model.
- `docs/standards/` for canonical implementation and documentation rules.

Context docs summarize and route that guidance for execution workflows. They do not replace canonical sources.
If a context pack/template conflicts with ADRs, architecture docs, or standards docs, canonical docs take precedence.
Context packs should describe current reusable guidance, not phase history, prompt sequences, roadmap checkpoints, or closeout diaries.
When existing code has moved ahead of canonical docs, record the conflict in `docs/docs-mismatch-register.md`; do not make the context pack the hidden source of truth.

## Folder Structure

- `docs/context/packs/`
  - Reusable context modules used to assemble task-specific prompt context.
  - Packs are compact summaries and routing aids tied back to canonical docs.
  - Each context pack must stay at or below 200 physical lines. If a pack grows past that limit, summarize duplicated/history-only detail or split it into focused companion packs with updated routing links.
  - Each context pack must include a canonical source/reference section.
  - Packs must stay downstream from canonical docs; if a pack needs to record a mismatch, add it to `docs/docs-mismatch-register.md` instead of changing the pack into a diary.
- `docs/context/templates/`
  - Optional scaffolds for feature, epic, and story context artifacts when structured work-item context is useful.
  - Not every task or feature needs feature/epic/story context files.
- `docs/context/prompt-routing.md`
  - Lightweight decision guide for choosing which packs to include.
- `docs/context/pack-catalog.json`
  - Machine-readable pack identifiers, retrieval signals, path signals, and verification commands.
  - The default budget is one primary pack plus at most one adjacent-boundary pack; expand only from repository evidence.

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

Use `docs/context/pack-catalog.json` for machine-readable discovery and `docs/context/prompt-routing.md` for human-readable selection rules.

Run `npm run docs:check` and `npm run agent-support:check` after editing context packs or routing metadata.
