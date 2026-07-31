# ADR-0007: Desktop Renderer Styling Foundation and Layering

- Status: accepted
- Date: 2026-04-15
- Deciders: ai-system-builder maintainers
- Related: docs/adr/ADR-0006-desktop-implementation-boundaries-and-renderer-structure.md, docs/context/packs/desktop-implementation.pack.md, modules/ui/shared/styles/tokens.css

## Context

The desktop and thin-client surfaces share page, feature, and component concepts. Maintaining separate copies of their tokens, layout primitives, shell rules, and feature styling caused visual drift and made identical corrections necessary in more than one location.

Without a recorded styling direction, early renderer CSS tends to drift into known growth failures:

- global stylesheet accumulation that mixes app shell and page/feature-specific concerns,
- inconsistent naming and ad hoc visual patterns,
- duplicated style rules across features,
- unstable color usage from direct hex values rather than reusable tokens.

The application requires a durable corporate dark visual foundation that preserves the established visual direction while making shared ownership and layering explicit across both React surfaces.

## Decision

Desktop and thin-client renderer styling is token-first, layered, and shared by default.

### Stable styling baseline

- Use the corporate navy-and-blue dark palette in the shared token definitions as the cross-surface baseline.
- Keep shared design primitives in tokens (color, typography, spacing, radius, motion, z-index, layout, control sizing).

### Required layer order

1. tokens
2. reset
3. typography
4. shared layout
5. shared components
6. feature/page-local styles only when justified by ownership

### Ownership and scope rules

- `modules/ui/shared/styles/application.css` is the canonical ordered entrypoint for cross-surface tokens, reset, typography, layout, shell, controls, surfaces, tabs, and feature patterns used by both applications.
- Each application style entrypoint must remain small: it imports the shared entrypoint and only app-specific extensions that have real platform ownership.
- Shared reusable styles belong under `modules/ui/shared/styles/layout/` or `modules/ui/shared/styles/components/`.
- Platform-specific feature/page styles remain with the owning application only when the other surface cannot use them.
- Naming must remain namespaced and consistent to avoid collisions and unclear ownership.

### Shell and iconography

- Desktop and thin-client use the same corporate shell structure: persistent sidebar navigation on wide viewports, compact menu navigation on narrow viewports, and a shared workspace selector treatment.
- The wide sidebar exposes the same persisted collapse/expand preference in both hosts. Collapsing changes presentation only and preserves navigation labels through accessible names and hover titles.
- Wide-sidebar navigation sections are independent semantic disclosure controls. Their persisted visual state does not remove routes, and a collapsed global sidebar gives the reclaimed width to the active page.
- Navigation changes presentation only; page availability, routing, data access, and feature behavior remain owned by each application.
- Reusable application iconography is code-native, accessible, and exported by `modules/ui/shared`; do not add duplicated inline navigation SVGs to app-local shells.
- The shared shell owns cross-page transient feedback. It places one notification
  control before Settings and presents bounded five-second toasts plus a fixed
  history dropdown below the sticky top bar. Feature surfaces publish terminal
  outcomes once through the shared notification API; they retain inline
  validation, loading/empty states, blocking and retry diagnostics, and active
  progress controls that require local context.
- Common actions, feature-panel headings, and artifact type designators reuse shared components. Icons and colored badges supplement visible text and metadata; they do not replace accessible labels or domain data.
- Decorative workspace and feature-header art is shared, text-free SVG or optimized raster artwork under `modules/ui/shared/assets/illustrations/`. It remains hidden from assistive technology and cannot communicate application state or replace semantic content. Semantic page-level routing may select distinct artwork for major feature areas, but both React hosts must consume the same shared assets and placement rules.

### Guided workflows

- Ordered, multi-stage tasks reuse the shared `WorkflowSequence` and `WorkflowStep` components and `ui-workflow` styles for numbered sections, connecting rails, active-step emphasis, and responsive field groups.
- Feature owners retain all behavior, state, validation, and side effects. The workflow primitive standardizes presentation and accessible section structure without moving domain logic into the shared UI layer.
- Dataset Preparation, Image Generation, and model training use this shared structure so equivalent interaction patterns remain visually aligned instead of accumulating feature-local copies.

### System posture

- This foundation supports cross-surface reuse and consistency now.
- It intentionally does not define a full design system or component catalog at this stage.

## Alternatives Considered

### 1) Keep a single growing global stylesheet for speed

Rejected.

This optimizes short-term edits but recreates style sprawl, weak ownership boundaries, and harder reviewability.

### 2) Build a full design-system package immediately

Rejected.

Current scope is a desktop foundation task. A full design-system rollout is premature and would add abstraction and maintenance cost before stable demand.

### 3) Copy the previous app stylesheet hierarchy wholesale

Rejected.

The rebuild should preserve the core palette and disciplined layering, but avoid inheriting old surface-specific complexity and unused rules.

### 4) Establish a minimal token-first layered foundation now

Accepted.

This preserves visual continuity and gives clear growth rules without overbuilding.

## Consequences

### Positive

- Styling ownership is clearer across both app shells, shared components, and platform-specific feature/page surfaces.
- Color usage remains consistent through token reuse and preserved dark palette values.
- Desktop and thin-client visual changes can be made once and verified on both deployment surfaces.
- Review and maintenance improve because layer intent and file purpose are explicit.
- The rebuild can grow incrementally without turning `app.css` into a dumping ground.

### Negative

- Teams must apply layering and ownership discipline rather than adding quick global rules.
- Shared-rule changes have a wider regression radius and therefore require verification in both desktop and thin-client surfaces.
- A separate design-system decision may still be needed later if component complexity expands substantially.

### Follow-up

- Keep styling guidance in desktop context packs aligned with this ADR.
- Add platform-local styles only when ownership is clear and cross-surface reuse does not apply.
- Keep source-level tests that assert both app entrypoints import the shared foundation and that shell navigation retains responsive behavior.
- Revisit design-system scope only when repeated shared patterns materially exceed this foundation.
