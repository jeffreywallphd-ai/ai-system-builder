# Context Pack: Documentation Standards

- Pack name: `docs-standards`

## Purpose

- Keep implementation work aligned with canonical documentation responsibilities and update discipline.

## Use When

- Architectural or standards changes.
- Repository structure changes.
- Any implementation likely to change documented behavior.
- Creating/updating context packs, ADRs, architecture docs, or standards docs.

## Do Not Use When

- Narrow code changes that clearly do not affect documented behavior.
- Tasks already fully covered by local doc edits with no standards/architecture implications.

## Core Guidance

- Canonical documentation roles are distinct: ADRs (decisions), architecture docs (system boundaries), standards docs (working rules), context docs (task-oriented summaries).
- If code changes affect documented behavior or boundaries, update canonical docs in the same work item.
- Prompts/AI context are accelerators, not substitutes for canonical documentation.
- Avoid duplicated guidance across docs when cross-references are sufficient.
- Use context packs as routing aids and compact summaries, not as sole sources of truth.
- When canonical transport specialization or operation/channel rules change, update affected context packs in the same change set.
- When runtime/logging or persistence/storage family invariants change, update only the materially affected ADR/architecture/standards docs and packs in the same work item.
- When application-port seam rules change (required seam use, port-family shape, or anti-drift placement), update the materially affected canonical docs and packs in the same work item.
- When contract export/import discipline changes, update canonical docs and cross-family invariant guidance together so automation inherits one stable extension surface.
- If implementation changes documented behavior, structure, boundaries, or standards and canonical docs are not updated, the work is incomplete.
- Mark what is decided versus intentionally not finalized.

## Key Constraints

- Do not introduce conflicting rules in context docs that bypass ADR/architecture/standards docs.
- Do not leave PRs with behavior changes but stale docs.
- Prefer template-aligned doc structures for consistency and scanability.

## Canonical Source Docs

- `docs/standards/documentation-standards.md` — canonical documentation hierarchy and update rules.
- `docs/adr/README.md` — ADR lifecycle and status conventions.
- `docs/architecture/README.md` — architecture docs role and maintenance expectations.
- `docs/context/packs/pack.template.md` — context pack structure and brevity requirements.

## Common Over-Inclusions to Avoid

- Copying full canonical docs into context packs/prompts.
- Treating chat prompts as authoritative policy repositories.
- Updating context docs while leaving canonical docs stale for changed behavior.

## Prompt Assembly Notes

- Typical set: `index` + `docs-standards`.
- Add one scope-specific pack (`architecture`, `runtime`, `desktop-host`, `server-host`, `persistence-storage`) based on the change surface.
