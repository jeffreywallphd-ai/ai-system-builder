> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Shared application styles

`application.css` is the canonical visual entrypoint for the desktop and thin-client React surfaces. It owns the cross-surface corporate palette, reset, typography, layout primitives, application shell, controls, badges, surfaces, tabs, home presentation, and reusable feature-surface rules.

Keep the import order token-first. Add a rule here only when both application surfaces use the pattern or when it is an intentionally shared `ui-*` primitive. Keep desktop-only runtime, dataset-preparation, and settings extensions in the desktop renderer style tree.

Do not recreate app-local copies of a shared stylesheet. Both app entrypoints should import `application.css`, and changes to shared rules should be verified in both builds and viewport shapes.

System Builder, its asset picker and composition preview suppress cosmetic
animations/transitions when reduced motion is requested, including shared controls
inside those surfaces. Status meaning remains available as text. The real-host
browse qualification checks computed motion, contrast, semantics and narrow reflow
on both desktop and thin client.
The main reading surface is opaque, so decorative backgrounds cannot obscure
text contrast or make its automated measurement indeterminate.

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

Home workspace controls stay within the copy column: selector/change controls
wrap, and workspace creation uses the following row. Long names and active
workspace controls must not overflow beneath the summary cards or block pointer
access. Verify the real Home-to-create journey with an existing workspace.

Unselected tabs retain a visible border so the complete tab set reads as interactive. Wide-screen navigation groups use semantic disclosure controls, and collapsing the global sidebar must allow the content container to use the reclaimed width. Colored type badges and action icons are shared primitives: use them alongside text, not as unlabeled substitutes.

Guided multi-step tasks use the shared `WorkflowSequence` and `WorkflowStep` components with the `ui-workflow` visual layer. Reuse that sequence for ordered conceptual stages, connecting rails, active-step emphasis, responsive field grids, and review/action surfaces. Feature components continue to own their fields, validation, state, and side effects; the shared workflow primitive owns presentation and accessible section structure only.

Form controls must use the shared primary blue-and-dark visual language.
`controls.css` removes browser-native fieldset, radio, checkbox, and file-button
chrome so operating-system colors cannot leak into product forms. Use
`ui-choice-group`, `ui-choice-list`, and `ui-choice` for selectable options,
`ui-file-input` for file selection, and an explicit `ui-button` class for
actions. Semantic warning colors remain reserved for warning state; they are
not a form-control theme.


Page dashboard details live inside the metric description so assistive technology
can associate them with its term. Keep their normal wrapping, small text and
normal weight explicit rather than inheriting the large numeric value styling.


Reduced-motion preference suppresses cosmetic transitions/animations throughout
shared shell descendants and their pseudo-elements; loading and status text
remain visible. At narrow viewport widths the header scrolls normally, so a
multirow workspace header cannot cover controls at native zoom. Wide headers
retain their sticky position.


Shell, metric, panel, tab-body and numbered workflow reading surfaces use opaque
solid dark backgrounds. Keep decorative rails, borders and shadows separate from
text backdrops so real contrast stays deterministic on both host renderers.

Selected navigation, tiny type badges and empty-state text also use solid dark
backings. Badge foreground and border retain the type color. Primary-button hover
uses a darker mix of the primary blue so white normal-size text retains contrast;
outline/destructive control semantics and shared focus rings remain distinct.

Glossary help buttons set an explicit unit line height: inherited body line
height can place their small glyph outside the button's opaque background.

The custom file chooser retains an opaque, correctly spaced label backing and
shows a focus ring when its native input receives keyboard focus.

Workflow numbers use outlined pills over opaque step cards. The dashed connector
paints behind those cards, preserving the steps' existing stacking order and
keeping it out of numeral backdrops. Text numbers retain normal-text contrast;
real host checks sample first, active and default number interiors in device pixels.

Asset card/detail headers wrap their title and source badge when space is tight.
Badges keep intrinsic width; long titles can break within the available width.
Actual wide,320px and native-zoom checks reject title/badge overlap or overflow.
