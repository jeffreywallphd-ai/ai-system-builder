# ADR Index

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This directory stores Architecture Decision Records (ADRs) for `ai-system-builder`.

## Purpose

ADRs capture architectural intentions and decisions so humans and AI agents can implement consistently.

## Rules

- Keep ADRs short and specific.
- Record decisions before implementation when practical.
- Update ADRs as implementation choices become final.
- Keep superseded ADRs; mark them and reference replacements.

## File Naming

Use `ADR-XXXX-short-title.md` with zero-padded numbers.

## Status Values

Use one of: `proposed`, `accepted`, `superseded`, `deprecated`.

## Workflow

1. Check `decision-readiness.md` to determine whether an accepted decision already governs the work.
2. Create a new ADR from `template.md` when an architecturally significant choice remains open or changes an accepted decision.
3. Link related ADRs and docs/context packs when relevant.
4. Keep decision, consequences, readiness, and current code aligned.

## Inventory Rule

Treat the ADR files in this directory as the inventory source. Do not maintain a partial hand-written ADR list unless it is generated or checked as part of documentation review.

ADRs may preserve decision history, but they should not become phase diaries, prompt transcripts, or later scope trackers. Historical context belongs in rationale only when it explains the decision.
