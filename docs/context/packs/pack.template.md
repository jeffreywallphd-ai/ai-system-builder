# Context Pack Template

> Use packs for reusable, AI-oriented context assembly modules (for example: repository overview, architecture, runtime, desktop host, server host, docs standards).
>
> Packs are concise routing aids. They summarize and point to canonical docs; they do not replace canonical docs.
>
> **Authoring rule:** remove irrelevant sections. Keep packs short and reusable. Packs summarize current task guidance from canonical docs; they do not preserve phase history, prompt sequences, review notes, roadmap checkpoints, or closeout diaries.
>
> **Line budget:** each context pack must be no more than 200 physical lines. If the pack needs more room, split it into a focused companion pack or replace historical detail with links to canonical docs.

## Pack Title

- Pack name:

Add the same id/path, concise task signals, path signals, and applicable repository commands to `docs/context/pack-catalog.json`. Every selectable pack must also have coverage in `dev-tools/agent-evals/scenarios.json`.

## Purpose

- What this pack helps an implementer/agent do faster and more accurately.

## Use When

- Specific situations where this pack materially improves execution.

## Do Not Use When

- Situations where this pack adds noise or prompt bloat.
- Work types better served by a narrower context set.

## Core Guidance

- 3-7 high-signal guidance bullets.
- Keep actionable and boundary-aware.

## Key Constraints

- Non-negotiable architectural/standards constraints relevant to this pack.
- Explicit exclusions to prevent overreach.

## Canonical Source Docs

- `docs/adr/...`
- `docs/architecture/...`
- `docs/standards/...`

For each source, include a one-line relevance note.
If code and docs are known to disagree, cite `docs/docs-mismatch-register.md` and do not resolve the conflict inside the context pack.

## Common Over-Inclusions to Avoid

- Large background sections not needed for task execution.
- Unrelated host/runtime/adapter detail.
- Copying canonical docs into prompt payloads.
- Phase/prompt/review history that should live in issues, PRs, or a changelog outside reusable context.

## Prompt Assembly Notes

- Recommended companion packs/docs.
- Typical ordering when assembling prompts.
- Minimum-sufficient assembly guidance (what to include first, what to omit by default).
- Prefer one primary pack plus one adjacent-boundary pack. Explain the repository evidence before recommending broader context.
