# Context Pack: Documentation Standards

- Pack name: `docs-standards`

## Purpose

- Keep implementation work aligned with canonical documentation responsibilities and update discipline.

## Use When

- Architectural or standards changes.
- Repository structure changes.
- Any implementation likely to change documented behavior.
- Creating/updating context packs, ADRs, architecture docs, or standards docs.
- Planning repository-scale or architecture-sensitive automated development.

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
- Classify decision readiness before implementation; proposed or explicitly open architecture is not authorization to choose silently.
- Use the change-impact matrix to inspect callers, consumers, host wiring, tests, and downstream docs before editing.
- Follow the tool-neutral agent work cycle: discover, classify, analyze impact, plan, implement, verify, and reconcile knowledge.
- Apply the universal security impact screen before editing docs or governance. A standards, context, ADR, roadmap-skill, dependency, workflow, or agent-evaluation change can be security-relevant even when it does not change product code.
- Run `npm run docs:check` after documentation-heavy work.
- Every README must keep the AI documentation reminder that points updates toward related ADRs, architecture docs, context packs, and README files.

## Key Constraints

- Do not introduce conflicting rules in context docs that bypass ADR/architecture/standards docs.
- Do not leave PRs with behavior changes but stale docs.
- Prefer template-aligned doc structures for consistency and scanability.
- Do not remove the docs drift check or README reminder without replacing them with an equal or stronger guardrail.

## Canonical Source Docs

- `docs/standards/documentation-standards.md` - canonical documentation hierarchy and update rules.
- `docs/standards/ai-agent-development-standards.md` - required development cycle, scope controls, safety rules, and completion evidence.
- `docs/standards/change-impact-matrix.md` - boundary-specific inspection, update, and verification requirements.
- `docs/standards/security-by-design-standards.md` - mandatory security impact disposition, proportional threat/control review, secure rollback, and evidence rules.
- `docs/standards/documentation-metadata-standards.md` - minimal canonical metadata and evidence rules.
- `docs/standards/agent-support-evaluation-standards.md` - deterministic harness checks and reproducible model-in-loop evaluation rules.
- `docs/adr/decision-readiness.md` - current decision gates for architecture-sensitive work.
- `docs/architecture/architecture-verification.md` - direct, representative, and missing architecture fitness coverage.
- `docs/context/pack-catalog.json` - machine-readable retrieval and verification signals.
- `dev-tools/agent-evals/scenarios.json` - representative proceed/escalate agent-support scenarios.
- `docs/adr/README.md` - ADR lifecycle and status conventions.
- `docs/architecture/README.md` - architecture docs role and maintenance expectations.
- `docs/context/packs/pack.template.md` - context pack structure and brevity requirements.

## Common Over-Inclusions to Avoid

- Copying full canonical docs into context packs/prompts.
- Treating chat prompts as authoritative policy repositories.
- Updating context docs while leaving canonical docs stale for changed behavior.

## Prompt Assembly Notes

- Typical set: `index` + `docs-standards`.
- Add one scope-specific pack (`architecture`, `security`, `runtime`, `desktop-host`, `server-host`, `persistence-storage`) based on the change surface and security impact disposition.
