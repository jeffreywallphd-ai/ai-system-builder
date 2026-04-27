# Context Pack: Runtime Model

- Pack name: `runtime`

## Purpose

- Guide runtime-related implementation while preserving the repository’s TypeScript-first, adapter-driven model.

## Use When

- Implementing runtime execution flow or runtime contracts.
- Integrating Python/runtime adapters.
- Designing runtime boundary error/timing/translation behavior.

## Do Not Use When

- Tasks that do not touch runtime execution or runtime contracts.
- Pure UI, documentation-only, or host wiring changes with no runtime impact.

## Core Guidance

- Node.js + TypeScript is the default runtime path for core architecture.
- Use one orchestration model centered in application/domain design.
- Use one runtime contract model for boundary consistency.
- Support multiple runtimes through adapters (`modules/adapters/runtime/`), not feature-by-feature patterns.
- Keep shared runtime vocabulary in `modules/contracts/runtime/` and keep adapter protocol specifics out of core contracts.
- Keep runtime diagnostics as a strict specialization of shared logging vocabulary (not a parallel runtime-only diagnostics schema).
- Keep runtime operation identity helper-driven (`lowercase.dot.segments`) to prevent per-adapter naming drift.
- Keep runtime diagnostic mapping to `StructuredLogEvent` mechanical and stable across adapters.
- Keep runtime-specific mechanics out of domain/application logic.
- Treat Python as an adapter path, not a co-equal architecture center.
- Define or update runtime contracts before adding runtime-specific behavior.

## Key Constraints

- No runtime-specific leakage into core use-case or domain design.
- Avoid ad hoc per-feature protocols and speculative runtime plugin frameworks.
- Runtime protocol details that are not finalized must remain isolated and easy to evolve.
- Maintain runtime contract invariant tests for operation identity and runtime/logging diagnostic alignment.

## Canonical Source Docs

- `docs/adr/ADR-0002-typescript-first-runtime-model.md` — core runtime decision and alternatives rejected.
- `docs/architecture/runtime-model.md` — runtime responsibilities, boundaries, and open areas.
- `docs/architecture/module-dependency-rules.md` — dependency constraints for adapter integration.
- `docs/standards/coding-standards.md` — boundary-safe implementation requirements.
- `docs/standards/testing-standards.md` — testing approach for runtime adapters and boundaries.

## Common Over-Inclusions to Avoid

- Full host model details when runtime work is host-agnostic.
- Transport adapter specifics unless runtime invocation crosses transport boundaries.
- Unnecessary architecture background unrelated to runtime execution.

## Prompt Assembly Notes

- Typical set: `index` + `runtime`.
- Add `architecture` for cross-layer decisions.
- Add `logging` for diagnosability-heavy runtime work and `testing` for bug fixes/refactors.
