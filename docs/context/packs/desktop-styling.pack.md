# Context Pack: Desktop Styling

- Pack name: `desktop-styling`

## Purpose

- Keep desktop and thin-client renderer styling disciplined, layered, token-first, and visually aligned.
- Preserve the corporate navy-and-blue dark palette while preventing cross-surface duplication and CSS sprawl.

## Use When

- Adding or refactoring CSS in `apps/desktop/src/renderer/**`.
- Changing shared visual rules consumed by both `apps/desktop` and `apps/thin-client`.
- Creating shared renderer layout/component style primitives.
- Reviewing where new renderer styles should live.

## Do Not Use When

- Tasks with no renderer styling impact.
- Server/host/runtime work that does not change desktop or thin-client CSS structure.

## Core Guidance

- Treat renderer styling as token-first; use `modules/ui/shared/styles/tokens.css` before introducing direct values.
- Preserve the corporate dark palette baseline unless an intentional design decision explicitly changes it.
- Keep style layering order: tokens → reset → typography → shared layout → shared components → feature/page-local styles.
- Keep `modules/ui/shared/styles/application.css` as the ordered shared layer entrypoint.
- Keep both app-local `styles/app.css` files small; they import the shared entrypoint and platform-only extensions.
- Keep shared styles in `modules/ui/shared/styles/layout/*` and `modules/ui/shared/styles/components/*`.
- Keep feature/page styles near their application owner only when the rule cannot be reused by the other surface.
- Keep namespaced and consistent class names (`ui-*` for shared renderer styles; feature-specific naming inside owned scopes).
- Keep app-local route and feature availability unchanged when refactoring the shared shell; matching presentation does not imply matching capabilities.
- Keep wide-screen sidebar collapse behavior and its local visual preference aligned across desktop and thin-client shells; narrow viewports continue to use the compact menu.
- Keep the shared notification bell immediately before Settings. Its dropdown
  and five-second toast viewport remain fixed below the sticky top bar, use
  shared `ui-notification-*` styles, preserve focus/Escape/outside-click
  behavior, and honor reduced motion.
- Route terminal page and tab outcomes through the shared notification center
  with a safe source and workspace scope. Do not duplicate those outcomes in
  feature content. Keep field validation, loading/empty state, blocking or
  retryable diagnostics, and active progress controls inline and classify every
  new alert/status surface in the notification migration inventory.
- Keep ordinary draft editing quiet. Use a compact dirty-state affordance
  instead of edit-by-edit notices or automatic reminders to save; show save
  guidance only after a save attempt or when the user's next requested action
  is genuinely blocked by unsaved work.
- Keep routine successful reads quiet when visible content already confirms
  success, including initial loads, refreshes, searches, and detail selection.
  Keep empty results contextual and inline, and do not duplicate durable task
  activity with a separate queued message.
- Keep wide-screen navigation sections as semantic, independently collapsible disclosure groups. Global collapse must let the page content consume the reclaimed width without changing route availability.
- Reuse shared action icons, feature-panel headings, bordered tab states, and colored artifact type badges. Keep visible text and source metadata alongside visual designators.
- Reuse `WorkflowSequence` and `WorkflowStep` for ordered, multi-stage task surfaces. Keep each feature's behavior and state local while sharing numbered cards, connecting rails, field grids, and review/action presentation.
- Keep decorative page illustrations shared, text-free, responsive, and hidden from assistive technology. Do not encode state or feature behavior in artwork.

## Key Constraints

- Do not grow a giant global stylesheet.
- Do not place page-specific rules in either top-level app stylesheet.
- Do not duplicate shared component patterns across multiple feature/page style files.
- Do not restore parallel desktop and thin-client copies of tokens, shell, controls, panels, tabs, home, or shared feature-surface styles.
- Do not add style files with no current usage.
- Do not introduce a new one-off visual pattern for each component when existing shared patterns fit.

## Canonical Source Docs

- `docs/adr/ADR-0007-desktop-renderer-styling-foundation-and-layering.md` — accepted renderer styling baseline, cross-surface ownership, and layering decision.
- `docs/adr/ADR-0006-desktop-implementation-boundaries-and-renderer-structure.md` — renderer ownership boundaries and composition model.
- `docs/context/prompt-routing.md` — minimum-sufficient pack selection and assembly rules.
- `docs/standards/coding-standards.md` — implementation restraint and anti-overbuild discipline.
- `docs/standards/naming-standards.md` — naming consistency expectations.

## Common Over-Inclusions to Avoid

- Loading broad server/runtime packs for renderer-only CSS tasks.
- Copying old app-wide style systems wholesale into either renderer.
- Expanding styling docs into component catalogs or speculative design-system policy.

## Prompt Assembly Notes

- Typical styling set: `index` → `desktop-implementation` → `desktop-styling`.
- Add `docs-standards` when the task introduces or changes styling ADRs or context packs.
- Add `testing` for shared shell, responsive navigation, or shared entrypoint changes because both application surfaces are affected.
- Keep prompts minimum-sufficient: include only touched styling layers and relevant canonical references.
