# Context Pack: Testing

- Pack name: `testing`

## Purpose

- Provide focused testing expectations that protect behavior and architecture without low-value test bloat.

## Use When

- Implementation tasks with meaningful behavior changes.
- Bug fixes and regressions.
- Refactors that risk behavior drift.
- Adapter, host, runtime, transport, persistence, storage, or UI-client boundary changes.

## Do Not Use When

- Wording-only docs edits.
- Architecture discussion with no implementation or test impact.

## Core Guidance

- Test observable behavior and boundary contracts, not implementation trivia.
- Use Node's built-in test runner (`node:test`) as the default for non-browser tests.
- Use `npm test` for standard unit and interaction feedback and
  `npm run test:e2e` for integration and end-to-end coverage.
- Use `npm run test:ai` or `npm run test:all` only for AI-related work or an
  explicit request. Use `npm run test:standardande2e` for combined non-AI coverage.
- Classify `*.integration.test.*` and `*.e2e.test.*` as E2E. Mark only tests
  that load or run AI components with `// @test-suite ai`; the AI marker wins.
  `// @test-duration long` remains a legacy E2E marker.
- During roadmap work, run focused chunk tests and increment-relevant checks;
  reserve combined standard and end-to-end coverage until every increment is
  implemented, and add the AI suite only for AI-related roadmaps.
- Test domain logic directly and application use cases through controlled ports/test doubles.
- Give adapters focused integration coverage for real translation and boundary behavior.
- Add host/transport integration tests for wiring, composition, delegation, and safe error mapping.
- Keep tests deterministic, CI-suitable, and non-flaky.
- Add regression tests for bug fixes when practical in the layer where the defect should be caught.
- If regression coverage is not added, document the reason.

## Placement Rules

- Contract family tests belong in `modules/contracts/<family>/tests`.
- Cross-family contract invariants belong in `modules/contracts/tests`.
- Application port family tests belong in `modules/application/ports/<family>/tests`.
- Cross-family application seam invariants belong in `modules/application/ports/tests`.
- Application service/use-case tests belong near the owning service/use-case family.
- UI shared mapper/component tests belong near the shared UI package; host-specific client/page tests stay host-specific.

## High-Value Coverage Areas

- Operation identity and transport/API/IPC specialization invariants.
- Persistence/storage separation, storage-key/path containment, and workspace scoping.
- Runtime readiness no-start/no-install/no-repair reads and Runtime Task Registry lifecycle behavior.
- Resource-backed Asset Registry providers: descriptor-only reads, bounded diagnostics, unsupported seams, deterministic ordering, duplicate handling, and no scans/byte reads/provider/runtime calls.
- Asset mutation workflows: guard-first ordering, approval/capability checks, duplicate/idempotency handling, sanitized failures, and no side effects on guard failure.
- System Foundation and asset-pack behavior: valid manifests/entries, safe metadata, explicit/internal install, pure resolver behavior, and no public import/export/install leaks.
- Workspace behavior: safe IDs, active selection as preference/context, `system.foundation@1.0.0` reference activation, workspace A/B isolation, no hidden/default workspace fallback.
- Desktop/thin-client workspace UI: page gating, no feature-client calls without active workspace, display name labels, create/select/switch controls, and refetch on workspace switch.
- Public API/IPC/preload/UI payloads: no raw paths, storage roots, tokens, env values, command lines, stacks, bytes/base64, prompts, workflow payloads, or provider-native raw payloads.

## Key Constraints

- Do not use broad end-to-end suites as substitutes for layered testing.
- Do not infer controlled-environment usability, accessibility, provider,
  ingestion-scale, or representative-hardware qualification from automated suites.
- Avoid over-mocking internals; mock explicit boundaries deliberately.
- Do not add production behavior solely to make a test easier.
- Stabilization tests should not introduce deferred features such as mutation, provider browse/download, workflow execution, marketplace behavior, collaboration, or automatic migration.

## Canonical Source Docs

- `docs/standards/testing-standards.md` - repository-wide testing strategy and anti-patterns.
- `docs/standards/naming-standards.md` - behavior-oriented test naming.
- `docs/standards/coding-standards.md` - boundary-safe implementation that drives test layering.
- `docs/architecture/module-dependency-rules.md` - dependency boundaries that tests should reinforce.

## Common Over-Inclusions To Avoid

- Pulling detailed host/runtime packs when not needed for the current test scope.
- Requiring exhaustive integration coverage for simple domain-only changes.
- Asserting framework internals instead of observable behavior.
- Keeping phase-by-phase historical test instructions in prompt context.

## Prompt Assembly Notes

- Typical set: `index` + `testing`.
- Add one or two scope-specific packs based on impacted boundaries.
- For bug fixes, include `debugging-error-handling` and the feature/host/runtime/storage pack where the bug lives.
