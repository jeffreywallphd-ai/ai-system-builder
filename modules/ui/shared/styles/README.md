> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Shared application styles

`application.css` is the canonical visual entrypoint for the desktop and thin-client React surfaces. It owns the cross-surface corporate palette, reset, typography, layout primitives, application shell, controls, badges, surfaces, tabs, home presentation, and reusable feature-surface rules.

Keep the import order token-first. Add a rule here only when both application surfaces use the pattern or when it is an intentionally shared `ui-*` primitive. Keep desktop-only runtime, dataset-preparation, and settings extensions in the desktop renderer style tree.

Do not recreate app-local copies of a shared stylesheet. Both app entrypoints should import `application.css`, and changes to shared rules should be verified in both builds and viewport shapes.

Shared decorative artwork belongs in `modules/ui/shared/assets/illustrations/` as responsive, text-free SVG or transparent PNG assets. Shell and Home illustrations must remain `aria-hidden`, must not carry feature meaning, and must never become a substitute for labels, state, or data. Full-page loading surfaces use `ui-page-loading-surface` so the shell keeps page artwork hidden until page content is ready. Color variants should reuse the shared visual vocabulary so desktop and thin-client pages do not drift.

Unselected tabs retain a visible border so the complete tab set reads as interactive. Wide-screen navigation groups use semantic disclosure controls, and collapsing the global sidebar must allow the content container to use the reclaimed width. Colored type badges and action icons are shared primitives: use them alongside text, not as unlabeled substitutes.

Guided multi-step tasks use the shared `WorkflowSequence` and `WorkflowStep` components with the `ui-workflow` visual layer. Reuse that sequence for ordered conceptual stages, connecting rails, active-step emphasis, responsive field grids, and review/action surfaces. Feature components continue to own their fields, validation, state, and side effects; the shared workflow primitive owns presentation and accessible section structure only.

Form controls must use the shared primary blue-and-dark visual language.
`controls.css` removes browser-native fieldset, radio, checkbox, and file-button
chrome so operating-system colors cannot leak into product forms. Use
`ui-choice-group`, `ui-choice-list`, and `ui-choice` for selectable options,
`ui-file-input` for file selection, and an explicit `ui-button` class for
actions. Semantic warning colors remain reserved for warning state; they are
not a form-control theme.
