> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Shared application styles

`application.css` is the canonical visual entrypoint for the desktop and thin-client React surfaces. It owns the cross-surface corporate palette, reset, typography, layout primitives, application shell, controls, badges, surfaces, tabs, home presentation, and reusable feature-surface rules.

Keep the import order token-first. Add a rule here only when both application surfaces use the pattern or when it is an intentionally shared `ui-*` primitive. Keep desktop-only runtime, dataset-preparation, and settings extensions in the desktop renderer style tree.

Do not recreate app-local copies of a shared stylesheet. Both app entrypoints should import `application.css`, and changes to shared rules should be verified in both builds and viewport shapes.

Page headers and the Home workspace card use the shared `page-dashboard`
surface instead of decorative artwork. Keep metric cards responsive,
text-labeled, and based on authoritative scoped reads. Page dashboards stay in
the right header column, including Home beside its workspace controls. Metric
cards use one fixed width based on the longest label rather than stretching to
fill the column, and Home keeps its four metrics in an explicit two-by-two
grid. Do not reintroduce
The summaries are hidden at small-screen widths so primary page controls retain
the viewport. Do not reintroduce shell-level or Home hero images as a substitute
for current workspace state.

Unselected tabs retain a visible border so the complete tab set reads as interactive. Wide-screen navigation groups use semantic disclosure controls, and collapsing the global sidebar must allow the content container to use the reclaimed width. Colored type badges and action icons are shared primitives: use them alongside text, not as unlabeled substitutes.

Guided multi-step tasks use the shared `WorkflowSequence` and `WorkflowStep` components with the `ui-workflow` visual layer. Reuse that sequence for ordered conceptual stages, connecting rails, active-step emphasis, responsive field grids, and review/action surfaces. Feature components continue to own their fields, validation, state, and side effects; the shared workflow primitive owns presentation and accessible section structure only.

Form controls must use the shared primary blue-and-dark visual language.
`controls.css` removes browser-native fieldset, radio, checkbox, and file-button
chrome so operating-system colors cannot leak into product forms. Use
`ui-choice-group`, `ui-choice-list`, and `ui-choice` for selectable options,
`ui-file-input` for file selection, and an explicit `ui-button` class for
actions. Semantic warning colors remain reserved for warning state; they are
not a form-control theme.
