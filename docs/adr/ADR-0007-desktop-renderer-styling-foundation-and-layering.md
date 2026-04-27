# ADR-0007: Desktop Renderer Styling Foundation and Layering

- Status: accepted
- Date: 2026-04-15
- Deciders: ai-system-builder maintainers
- Related: docs/adr/ADR-0006-desktop-implementation-boundaries-and-renderer-structure.md, docs/context/packs/desktop-implementation.pack.md, apps/desktop/src/renderer/styles/tokens.css

## Context

The desktop rebuild now has page/feature/component structure but no durable styling foundation.

Without a recorded styling direction, early renderer CSS tends to drift into known growth failures:

- global stylesheet accumulation that mixes app shell and page/feature-specific concerns,
- inconsistent naming and ad hoc visual patterns,
- duplicated style rules across features,
- unstable color usage from direct hex values rather than reusable tokens.

The previous app already established a usable dark visual palette. The rebuild needs a foundation that preserves this palette while resetting structure, ownership, and layering discipline.

## Decision

Desktop renderer styling is token-first and layered.

### Stable styling baseline

- Preserve the previous app's core dark color palette as the baseline by carrying core values into renderer token definitions.
- Keep shared design primitives in tokens (color, typography, spacing, radius, motion, z-index, layout, control sizing).

### Required layer order

1. tokens
2. reset
3. typography
4. shared layout
5. shared components
6. feature/page-local styles only when justified by ownership

### Ownership and scope rules

- The top-level renderer style entrypoint must remain small and layer-oriented.
- Shared reusable styles belong in shared layout/component style files.
- Feature/page-specific styles belong with their owning feature/page when needed.
- Naming must remain namespaced and consistent to avoid collisions and unclear ownership.

### System posture

- This foundation supports reuse and consistency now.
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

- Styling ownership is clearer across app shell, shared components, and feature/page surfaces.
- Color usage remains consistent through token reuse and preserved dark palette values.
- Review and maintenance improve because layer intent and file purpose are explicit.
- The rebuild can grow incrementally without turning `app.css` into a dumping ground.

### Negative

- Teams must apply layering and ownership discipline rather than adding quick global rules.
- Some future refactors may be needed when shared patterns emerge from early local styles.
- A separate design-system decision may still be needed later if component complexity expands substantially.

### Follow-up

- Keep styling guidance in desktop context packs aligned with this ADR.
- Add feature/page-local styles only when ownership is clear and shared extraction is justified.
- Revisit design-system scope only when repeated shared patterns materially exceed this foundation.
