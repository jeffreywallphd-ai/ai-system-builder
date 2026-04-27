# ADR-0002: TypeScript-First Runtime Model

- Status: accepted
- Date: 2026-04-14
- Deciders: ai-system-builder maintainers
- Related: docs/adr/ADR-0001-repository-structure.md, docs/architecture/runtime-model.md

## Context

The rebuild of `ai-system-builder` is intentionally constrained to avoid the multi-center architecture drift seen in earlier iterations. The repository already establishes Node.js/TypeScript as the primary implementation direction, while still leaving room for external runtime capabilities where they provide real value.

The risk to avoid is creating multiple semi-independent execution models too early (for example, one for Node, one for Python, and additional feature-specific variants). That pattern increases cognitive load, weakens boundary discipline, and makes use-case orchestration harder to reason about.

At the same time, fully rejecting non-Node runtimes would unnecessarily block integrations with ecosystems that may be justified for specific capabilities.

## Decision

`ai-system-builder` adopts a **TypeScript-first runtime model** with controlled runtime plurality:

- Node.js + TypeScript is the dominant implementation language and default runtime path.
- The core orchestration model is singular and centered in application/domain design, not split by runtime.
- Runtime plurality is supported through explicit runtime contracts and adapter implementations.
- Python and other non-Node runtimes are allowed as runtime adapters, not as co-equal architectural centers.
- Runtime-specific behavior must remain in adapter boundaries and must not leak into application or domain design.
- Runtime operation identity must use shared operation identity helpers (`lowercase.dot.segments`) to prevent per-adapter naming drift.
- Runtime diagnostics must remain a specialization of shared logging diagnostics (`StructuredLogDiagnosticFields`) and be mechanically mappable to `StructuredLogEvent`.
- Runtime diagnostic event names must stay in the `runtime.*` namespace; alternative runtime-only diagnostic vocabularies are out of bounds.
- All additional runtimes should have appropriate .gitignore rules

Preferred implementation model:

- one orchestration model,
- one runtime contract model,
- multiple runtime adapters.

## Alternatives Considered

### 1) Co-equal TypeScript and Python architecture centers

Rejected.

This would create duplicated architectural gravity (separate conventions, orchestration styles, and implementation centers) too early in the rebuild, making the codebase harder to evolve coherently.

### 2) Feature-by-feature ad hoc runtime integrations

Rejected.

Allowing each feature to choose its own runtime integration style would produce inconsistent boundary contracts and long-term maintenance friction.

### 3) Early generalized runtime plugin framework

Rejected.

A broad plugin system at this stage would be premature abstraction. The rebuild explicitly favors constrained and explicit adapters over speculative extensibility.

## Consequences

### Positive

- Reduced cognitive load for contributors by keeping one dominant implementation path.
- More coherent orchestration and use-case design across the system.
- Runtime integrations stay possible without redefining core architecture.
- Future runtime expansion can happen through contracts and adapters rather than by reshaping core layers.
- Runtime diagnostics and structured logs stay aligned across host/transport/runtime boundaries.

### Negative

- Teams integrating non-Node runtimes must conform to contracts instead of using direct/runtime-native shortcuts.
- Some early adapter friction is expected while runtime contracts mature.
- Contributors may perceive slower short-term delivery for runtime-specific features due to boundary constraints.

## Follow-up Documentation or Implementation Needs

- Keep `docs/architecture/runtime-model.md` aligned with this ADR as runtime contracts evolve.
- Keep runtime/logging normalization rules in `docs/standards/logging-standards.md` aligned with runtime contract evolution.
- Add implementation guidance for runtime adapter testing under `modules/testing/` when the first external runtime adapter is introduced.
- Maintain runtime contract invariant tests that protect operation identity and runtime-to-logging diagnostic mapping.
- Record a follow-up ADR if runtime protocol details become stable enough to standardize (for example, process/session lifecycle and protocol envelope conventions).

Note: exact runtime protocol details are intentionally still emerging and are not fixed by this ADR.
