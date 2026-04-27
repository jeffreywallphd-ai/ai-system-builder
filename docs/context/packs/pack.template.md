# Context Pack Template

> Use packs for reusable, AI-oriented context assembly modules (for example: repository overview, architecture, runtime, desktop host, server host, docs standards).
>
> Packs are concise routing aids. They summarize and point to canonical docs; they do not replace canonical docs.
>
> **Authoring rule:** remove irrelevant sections. Keep packs short and reusable.

## Pack Title

- Pack name:

## Purpose

- What this pack helps an implementer/agent do faster and more accurately.

## Use When

- Specific situations where this pack materially improves execution.

## Do Not Use When

- Situations where this pack adds noise or prompt bloat.
- Work types better served by a narrower context set.

## Core Guidance

- 3–7 high-signal guidance bullets.
- Keep actionable and boundary-aware.

## Key Constraints

- Non-negotiable architectural/standards constraints relevant to this pack.
- Explicit exclusions to prevent overreach.

## Canonical Source Docs

- `docs/adr/...`
- `docs/architecture/...`
- `docs/standards/...`

For each source, include a one-line relevance note.

## Common Over-Inclusions to Avoid

- Large background sections not needed for task execution.
- Unrelated host/runtime/adapter detail.
- Copying canonical docs into prompt payloads.

## Prompt Assembly Notes

- Recommended companion packs/docs.
- Typical ordering when assembling prompts.
- Minimum-sufficient assembly guidance (what to include first, what to omit by default).
