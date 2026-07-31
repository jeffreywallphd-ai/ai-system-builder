# Testing Standards

- Status: accepted
- Verification: `npm run test:standardande2e`; use `npm run test:all` for
  AI-related changes

## Purpose

Tests in `ai-system-builder` protect meaningful behavior and architectural intent.

They are not written to satisfy vanity coverage metrics or performative CI checks.

## Canonical non-browser runner

- `node:test` is the canonical default runner for non-browser tests.
- Use `node:assert/strict`-backed assertions for non-browser test coverage.
- The canonical runner supplies its transpiled test files to Node's programmatic
  `run()` API with `isolation: "none"`; do not pre-import the same files and then
  invoke `run()`, which can double-register execution under Node 24.
- Vitest-owned renderer tests are selected by their explicit Vitest import and run
  separately from Node-owned tests.
- Canonical repo commands:
  - `npm test` / `npm run test:standard` (standard unit and interaction coverage)
  - `npm run test:e2e` (integration and end-to-end coverage)
  - `npm run test:ai` (opt-in standard or E2E tests that load or run AI components)
  - `npm run test:standardande2e` (combined standard and end-to-end coverage)
  - `npm run test:all` (combined standard, end-to-end, and AI coverage)
  - `npm run test:dataset-preparation:e2e` (opt-in physical dataset creation
    matrix, only for Dataset Preparation changes or an explicit request)
  - `npm run test:non-browser` / `npm run test:vitest` (runner-specific coverage)

The standard suite is the default feedback loop. The E2E suite contains every
`*.integration.test.*` and `*.e2e.test.*` file plus unusually slow legacy files
marked with `// @test-duration long`. A JavaScript or TypeScript test belongs to
the AI suite only when it has `// @test-suite ai`; that marker overrides its
filename. The controlled Python AI list is explicit in
`run-python-ai-tests.mjs`. Do not mark ordinary slow builds, typechecks, database
tests, or browser flows as AI. Each runner writes a JSON report under
`artifacts/test-reports/` with the slowest files and tests.

`test:ai` and `test:all` are reserved for AI-related changes or explicit
requests. Default CI runs the standard and E2E commands separately and does not
download or run AI models. Controlled AI tests may require locally provisioned
assets and must skip truthfully when those assets are absent. Packaged desktop and
other controlled-environment qualifications remain named commands outside
`test:all` and cannot be inferred from automated runs.
The Dataset Preparation creation matrix is also a named exception outside
`test:all`: it covers every supported task/material-division combination, uses
only one or two bounded sources, and passes only after reopening a non-empty
physical Parquet dataset with the expected task fields and source association.
Keep model output deterministic at this boundary; live large-model quality and
hardware remain controlled qualifications rather than 39 repeated inference runs.

## Testing strategy by layer

## 1) Domain tests (unit-first)

Domain logic must be tested directly and in isolation.

Focus on:

- invariants,
- business rules,
- state transitions,
- value object/entity behavior.

Domain tests should not require infrastructure frameworks, database clients, or transport setup.

## 2) Application tests (use-case focused)

Application use cases should be tested with controlled boundaries.

Focus on:

- orchestration behavior,
- port interactions,
- success/failure path handling,
- policy decisions and error mapping at use-case level.

Use test doubles for ports where appropriate; do not replace use-case tests with adapter-heavy integration flows.

## 3) Adapter tests (focused integration)

Adapters require focused integration tests against their real boundary behavior.

Examples:

- persistence adapters with Postgres integration coverage,
- storage adapters with real filesystem/blob behavior (or faithful local substitutes),
- transport adapters with request/response translation verification,
- runtime adapters with protocol and error translation checks.

Keep integration scope tight and purpose-driven.

## 4) Host and transport boundary tests

Hosts and transport boundaries should receive targeted integration tests for:

- composition correctness,
- startup/shutdown behavior,
- boundary wiring correctness,
- critical route/IPC to use-case delegation paths.

Do not treat end-to-end host tests as substitutes for domain/application testing.

## 5) UI tests

UI tests should validate behavior that matters:

- user-visible state transitions,
- contract-driven interactions,
- shared UI behavior reused across surfaces.

Prefer focused component/integration tests over brittle snapshot-only approaches.

## Required behavior coverage

At minimum, tests should cover:

- core business rules and invariants,
- major use-case success and failure paths,
- boundary translation behavior (transport/runtime/persistence/storage),
- previously observed defect paths (regressions),
- architecture-significant behavior called out in ADRs/architecture docs.

## Contract family invariant tests

For shared contract families, add or maintain invariant tests that protect canonical family rules.

For major contract systems, add cross-family invariant tests in `tests` folders that
exercise the intended relationships between families and fail when those relationships drift.

Placement rule:

- family invariants live in `modules/contracts/<family>/tests/`,
- cross-family anti-drift invariants live in `modules/contracts/tests/`.

Minimum invariant expectations include:

- transport/API/IPC remain specialization-aligned (shared transport envelope semantics, no parallel contract systems),
- operation identity normalization stays helper-driven and transport-neutral across families,
- IPC channel derivation remains operation-bound (`ipc.<operation>.<kind>`) rather than ad hoc,
- runtime diagnostics remain a specialization of shared logging diagnostics and map directly to structured logs,
- persistence record references and record-targeted operations remain aligned,
- storage identity remains key-based and path-agnostic,
- persistence/storage remain mechanically distinct (record operations vs artifact-key operations),
- family barrels export only family-owned contract surfaces.
- non-contract modules stay on family-level contract imports (`modules/contracts/<family>`) and avoid root/deep contract import drift.

These tests belong near the contract families and should fail fast when drift is introduced.

## Application ports anti-drift tests

For application boundary seams with elevated drift risk (for example logging), add
focused anti-drift tests in the corresponding family `tests` folder.

Placement rule:

- application port seam tests live in `modules/application/ports/<family>/tests/`.
- do not place application-port anti-drift tests outside `tests` folders within the ports tree.

Keep these tests narrow and behavior/shape focused (port surface, shared contract
alignment, and seam invariants), not adapter implementation detail tests.

For cross-family application seam drift risk, add a small invariant layer in:

- `modules/application/ports/tests/`.

Cross-family application ports invariants should protect high-value seam relationships
(for example persistence-vs-storage separation, logging-vs-runtime seam separation,
and contracts-family import discipline) without becoming broad integration suites.

## Regression test rule

When fixing a bug, add a regression test when practical in the layer where the defect should have been caught.

If no regression test is added, include explicit rationale in the PR.

## Test naming and structure

- Use explicit behavior-oriented test names.
- Keep naming consistent with repository naming standards.
- Recommended suffixes:
  - `*.unit.test.ts`
  - `*.integration.test.ts`
  - `*.ui.test.tsx`
  - `*.e2e.test.tsx`

Use suffixes to describe test scope, not merely duration. Add
`// @test-duration long` only when measured runtime shows a unit or interaction
file does not belong in the fast feedback loop.

Describe expected behavior and context in test titles; avoid vague names.

## Mocking discipline

Use mocks/stubs/fakes deliberately.

Rules:

- mock at architectural boundaries, not internal implementation details,
- do not over-mock domain behavior that can be tested directly,
- avoid brittle tests that assert private call sequences without behavioral value,
- use representative fixture data tied to domain language.

## Determinism and flake avoidance

Tests must be deterministic and CI-suitable.

Requirements:

- control time/randomness with explicit seams,
- isolate filesystem/network/process side effects,
- ensure test order independence,
- enforce reliable setup/teardown for shared resources,
- avoid hidden external dependencies.

Flaky tests are treated as defects and must be fixed or quarantined with a tracked follow-up.

## CI suitability

Test suites should be structured for predictable CI execution:

- fast feedback for unit tests,
- scoped integration runs for boundary confidence,
- clear failure output that points to behavior regressions,
- no reliance on local-only developer state.

## Performance and accessibility qualification

Keep deterministic budget-schema and result-validation tests in ordinary CI.
Run timing probes only in named controlled environments with fixed workloads and
retain sanitized p95 evidence; do not make variable developer hardware a unit
test gate. Automated accessibility assertions protect semantics and regressions,
but release qualification also requires documented keyboard, screen-reader,
zoom/reflow, contrast, focus, and status-announcement review on each supported
surface. See
[Asset and System Support Qualification](../operations/asset-system-support-qualification.md).

## Anti-patterns to avoid

- Coverage-only tests with no behavioral assertion value.
- Snapshot churn that obscures real regressions.
- Tests that mirror implementation line-by-line instead of behavior.
- Massive end-to-end suites used as a replacement for layered tests.
- Asserting framework internals instead of system behavior.

## Practical review checklist

Before merging:

- Are important business and boundary behaviors actually protected?
- Do tests reflect architecture boundaries rather than collapsing them?
- Is new behavior covered at the appropriate layer?
- Is bug-fix regression coverage included when practical?
- Are tests deterministic and CI-reliable?

If any answer is “no”, test quality is insufficient.
