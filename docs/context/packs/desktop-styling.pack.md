# Context Pack: Desktop Styling

- Pack name: `desktop-styling`

## Purpose

- Keep desktop renderer styling work disciplined, layered, and token-first.
- Preserve the established dark palette baseline while preventing CSS sprawl.

## Use When

- Adding or refactoring CSS in `apps/desktop/src/renderer/**`.
- Creating shared renderer layout/component style primitives.
- Reviewing where new renderer styles should live.

## Do Not Use When

- Tasks with no renderer styling impact.
- Server/host/runtime work that does not change desktop CSS structure.

## Core Guidance

- Treat renderer styling as token-first; use `apps/desktop/src/renderer/styles/tokens.css` before introducing direct values.
- Preserve the core dark palette baseline unless an intentional design decision explicitly changes it.
- Keep style layering order: tokens → reset → typography → shared layout → shared components → feature/page-local styles.
- Keep `styles/app.css` small as the layer entrypoint; do not place page-specific styles there.
- Keep shared styles in `styles/layout/*` and `styles/components/*`.
- Keep feature/page styles near their owners (feature/page folders) when shared extraction is not yet justified.
- Keep namespaced and consistent class names (`ui-*` for shared renderer styles; feature-specific naming inside owned scopes).

## Key Constraints

- Do not grow a giant global stylesheet.
- Do not place page-specific rules in top-level app stylesheet.
- Do not duplicate shared component patterns across multiple feature/page style files.
- Do not add style files with no current usage.
- Do not introduce a new one-off visual pattern for each component when existing shared patterns fit.

## Canonical Source Docs

- `docs/adr/ADR-0007-desktop-renderer-styling-foundation-and-layering.md` — accepted renderer styling baseline and layering decision.
- `docs/adr/ADR-0006-desktop-implementation-boundaries-and-renderer-structure.md` — renderer ownership boundaries and composition model.
- `docs/context/prompt-routing.md` — minimum-sufficient pack selection and assembly rules.
- `docs/standards/coding-standards.md` — implementation restraint and anti-overbuild discipline.
- `docs/standards/naming-standards.md` — naming consistency expectations.

## Common Over-Inclusions to Avoid

- Loading broad server/runtime packs for renderer-only CSS tasks.
- Copying old app-wide style systems wholesale into rebuild renderer styles.
- Expanding styling docs into component catalogs or speculative design-system policy.

## Prompt Assembly Notes

- Typical styling set: `index` → `desktop-implementation` → `desktop-styling`.
- Add `docs-standards` when the task introduces/changes styling ADRs or context packs.
- Add `testing` only when CSS changes require new/updated automated UI assertions.
- Keep prompts minimum-sufficient: include only touched styling layers and relevant canonical references.
