# Coding Standards

## Purpose

These standards enforce maintainable implementation and architectural discipline for the repository rebuild.

Core expectation: code should be obvious, layered, typed, and intentionally structured.

## Boundary and dependency discipline

All code must follow the dependency rules in `docs/architecture/module-dependency-rules.md`.

Required behavior:

- Keep domain and application free from infrastructure and framework details.
- Keep application orchestration on explicit port seams under `modules/application/ports/**`; do not treat ports as optional convenience wrappers.
- Keep transport mechanisms (Express, Electron IPC, etc.) inside adapter boundaries.
- Keep API and IPC contract families as strict specializations of shared transport contracts; do not recreate parallel transport envelopes.
- Keep contract imports predictable: non-contract modules import only from `modules/contracts/<family>`; do not import root `modules/contracts` or deep internal contract files.
- Keep application port families thin, role-revealing, and contract-aligned; avoid generic service-style catch-all ports.
- Keep host lifecycle/composition separate from transport translation.
- Keep host context contracts small, framework-free, and limited to host identity plus lightweight boundary metadata.
- Keep persistence and storage concerns separate.
- Keep config contracts typed and concern-specific; grouped envelopes are composition conveniences, not generic settings bags.

Do not bypass architecture for convenience, even temporarily.

## Clarity over cleverness

Prefer explicit, readable code over compact or clever patterns.

- Minimize hidden control flow.
- Favor straightforward data transformations.
- Keep side effects visible at boundaries.

If a reader needs deep context to understand a function, simplify it.

Make sure that all code files are commented using best practices in code commenting.

## Abstraction restraint

This repository explicitly avoids speculative abstraction.

Allowed abstraction:

- when multiple real call sites already need it,
- when required by architecture boundaries (ports/contracts/adapters),
- when it reduces duplication without hiding behavior.

Discouraged:

- extension points for hypothetical future providers,
- generalized plugin registries without active need,
- “generic framework” code before concrete repeated use exists.

## TypeScript standards

- Use strict typing by default.
- Prefer explicit domain/application types over untyped object passing.
- Avoid casual `any`; use `unknown` plus narrowing when type is truly dynamic.
- Keep runtime contracts explicit at boundaries.
- Model error/result shapes intentionally where boundary translation occurs.

Type assertions (`as`) require justification by known boundary facts; do not use assertions to silence type uncertainty.

## File and function focus

- Keep files focused on one primary responsibility.
- Keep functions focused on one coherent behavior.
- Split large files by boundary role, not arbitrary line count.

Avoid “main” or “bootstrap” files that mix:

- composition wiring,
- application logic,
- transport translation,
- infrastructure setup,
- and operational diagnostics.

Composition roots are expected, but they must not become catch-all logic containers.

## Error handling at boundaries

Handle errors explicitly where boundaries are crossed:

- transport entry/exit,
- runtime adapter invocation,
- persistence/storage adapter operations,
- host startup/shutdown composition.

Requirements:

- preserve useful context,
- map low-level failures to stable application/contract error categories,
- avoid swallowing errors or returning ambiguous fallback values.

Domain/application logic should express expected failure modes explicitly, not through infrastructure exception leakage.

## Dependency and third-party library discipline

Before adding a dependency:

- confirm a concrete current need,
- prefer established, minimal libraries,
- keep library-specific usage inside adapter/infrastructure layers where possible,
- avoid introducing framework gravity into core layers.

Do not add libraries to avoid writing small amounts of clear code.

## Configuration and secrets

- Configuration must come from explicit config surfaces (`config/`, environment wiring, host composition).
- Do not hardcode environment-specific values.
- Do not commit secrets, tokens, credentials, or private keys.
- Validate required configuration at startup boundaries.
- Keep config contracts typed and concern-specific; do not collapse unrelated
  concerns into a generic options/settings bag.
- Keep grouped config envelopes as composition conveniences only; concern-level
  contracts remain the canonical place for validation and naming rules.

Application/domain logic should depend on typed configuration inputs, not direct `process.env` reads scattered across layers.

## Comment standards

Comments must add information the code alone cannot communicate.

Good comment use:

- boundary rationale,
- non-obvious invariants,
- protocol or mapping constraints,
- references to ADR decisions where relevant.

Avoid comments that restate code or describe obvious syntax behavior.

When behavior changes, update or delete stale comments in the same change.

## Anti-patterns to avoid

- Catch-all helper dumping grounds.
- Infrastructure objects passed deep into domain/application.
- Route/IPC handlers containing business policy.
- Runtime adapters deciding business rules.
- Ad hoc operation/channel string assembly that bypasses shared identity helpers.
- UI directly binding to persistence/storage internals.
- Unnecessary factories/registries/container indirection with no architectural payoff.

## Practical review checklist

Before merging:

- Are boundaries still legible in code structure and imports?
- Is any abstraction present only for hypothetical future needs?
- Are boundary errors diagnosable and mapped intentionally?
- Are files/functions focused and role-specific?
- Does configuration/secrets handling remain explicit and safe?

If any answer is “no”, refactor before merge.
