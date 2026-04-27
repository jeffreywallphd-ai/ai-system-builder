# Context Pack: Testing

- Pack name: `testing`

## Purpose

- Provide focused testing expectations that protect behavior and architecture without low-value test bloat.

## Use When

- Implementation tasks with meaningful behavior changes.
- Bug-fix tasks.
- Refactors that risk behavior drift.
- Adapter/host/runtime/transport changes needing targeted integration confidence.

## Do Not Use When

- Tasks that cannot affect runtime behavior (for example pure wording-only docs edits).
- Requests limited to architecture discussion with no code/test impact.

## Core Guidance

- Test meaningful behavior, not implementation trivia.
- Treat Node's built-in test runner (`node:test`) as the canonical default for non-browser tests.
- Use root `npm test` / `npm run test:non-browser` as the canonical non-browser execution path.
- Test domain logic directly with unit-level isolation.
- Test application use cases with controlled boundaries (ports/test doubles).
- Give adapters focused integration coverage for real boundary translation/behavior.
- Add targeted host/transport integration tests for wiring, composition, and delegation correctness.
- Add cross-family contract invariant tests (in `tests` folders) for major contract systems where drift risk is high.
  Focus these on boundary relationships such as transport/API/IPC specialization, runtime/logging alignment, and persistence/storage separation.
- Place contract invariants predictably: family tests in `modules/contracts/<family>/tests` and cross-family anti-drift tests in `modules/contracts/tests`.
- For application seam families with drift risk (for example logging ports), keep narrow anti-drift tests in `modules/application/ports/<family>/tests`.
- For application seams that drift across families, keep a minimal cross-family invariant layer in `modules/application/ports/tests`.
- Keep application-port anti-drift tests inside `tests` folders only; avoid ad hoc placement that hides seam guarantees.
- Add regression tests for bug fixes when practical in the layer where defect should be caught.
- Keep tests deterministic, CI-suitable, and non-flaky; avoid performative coverage-only tests.

## Key Constraints

- Do not use broad end-to-end suites as substitutes for layered testing.
- Avoid over-mocking internal details; mock boundaries deliberately.
- If regression coverage is not added for a bug fix, document clear rationale.

## Canonical Source Docs

- `docs/standards/testing-standards.md` — repository-wide testing strategy and anti-patterns.
- `docs/standards/naming-standards.md` — test file naming and behavior-oriented naming guidance.
- `docs/standards/coding-standards.md` — boundary-safe design that drives test layering.
- `docs/architecture/module-dependency-rules.md` — layer boundaries that testing should reinforce.

## Common Over-Inclusions to Avoid

- Pulling detailed host/runtime packs when not needed for current test scope.
- Requiring exhaustive integration coverage for simple domain-only changes.
- Asserting framework internals instead of observable behavior.

## Prompt Assembly Notes

- Typical set: `index` + `testing`.
- Add one scope-specific pack (`runtime`, `desktop-host`, `server-host`, or `architecture`) based on impacted boundaries.
