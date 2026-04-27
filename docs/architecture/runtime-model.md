# Runtime Model

## Runtime posture

`ai-system-builder` is **TypeScript-first**.

- Node.js + TypeScript is the native/default runtime path.
- Core architecture (domain, application, contracts, host composition) is designed around this default.

This is a deliberate constraint to keep early implementation coherent and maintainable.

## Why support multiple runtimes at all

Some capabilities are best sourced from non-Node ecosystems (for example, Python-based tools or libraries).

The architecture therefore allows runtime plurality, but in a controlled way:

- external runtimes are integrated through explicit runtime contracts,
- external runtime execution sits in adapter space,
- core use cases remain in application/domain.

## Python position

Python is the first expected external runtime integration path.

Important boundary statement:

- Python is an adapter concern, **not** a co-equal architectural center.
- The system should work with zero Python dependencies for core behavior not requiring runtime adapters.

## Runtime layer responsibilities

Runtime adapters (under `modules/adapters/runtime/`) may own:

- process/session orchestration for external runtime execution,
- request/response translation to runtime contracts,
- error mapping, timeout/retry behavior at the boundary,
- runtime environment checks and adapter-level observability.

Runtime adapters should not own:

- business policy decisions,
- cross-use-case orchestration that belongs in application,
- domain invariants.

## Contract-first runtime integration

Runtime interactions must be described by explicit contracts (via `modules/contracts/`), such as:

- invocation payload shapes,
- expected result envelopes,
- error categories and normalization expectations.

Current baseline runtime contract family:

- `modules/contracts/runtime/runtime-target.ts` for runtime kind/target selection.
- `modules/contracts/runtime/runtime-execution-request.ts` for request envelope and execution options.
- `modules/contracts/runtime/runtime-execution-result.ts` and `runtime-execution-error.ts` for shared success/failure envelopes.
- `modules/contracts/runtime/runtime-execution-event.ts` and `runtime-execution-diagnostic.ts` for optional progress/output/diagnostic streaming.
- `modules/application/ports/runtime/runtime-execution.port.ts` as the application-facing runtime execution seam.

Runtime diagnostic normalization rule:

- `RuntimeExecutionDiagnostic` is a runtime specialization of shared structured logging vocabulary.
- Runtime diagnostics use the shared level/verbosity/outcome/error semantics from `modules/contracts/logging`.
- Runtime diagnostic event names use the `runtime.*` namespace and can be mechanically mapped to `StructuredLogEvent` without ad hoc field translation.

Runtime family normalization rules:

- Runtime operation names must use shared operation identity formatting (`lowercase.dot.segments`) via runtime/shared helpers, not ad hoc string conventions.
- Runtime diagnostics must be additive to logging contracts (for example `executionId` and `stage`) and must not redefine level/verbosity/error semantics.
- Runtime contract exports must stay family-local (`modules/contracts/runtime/index.ts`) and avoid re-exporting non-runtime families.
- Runtime contract tests must protect operation identity normalization and diagnostic-to-structured-log mapping behavior.
- Application runtime orchestration should depend on runtime and logging ports as separate seams; do not collapse runtime execution and logging concerns into one port surface.

This prevents feature teams from creating one-off runtime integration styles per feature.

## What is not finalized yet

The following runtime details are intentionally **not yet standardized**:

- exact wire protocol format across all runtime adapters,
- final process model (for example, long-lived worker vs. per-invocation process in each scenario),
- universal runtime capability discovery/version negotiation mechanism,
- final developer ergonomics for local/runtime adapter tooling.

Contributors should avoid hard-coding assumptions as if these are settled. Use contracts and isolate adapter logic so evolution remains low-cost.

## Practical guidance for contributors

When adding runtime-related functionality:

1. Define/extend a runtime contract first.
2. Implement runtime specifics in `modules/adapters/runtime/`.
3. Keep application use cases runtime-agnostic (depend on ports/contracts).
4. Keep domain unaware of runtime mechanics.
5. Record significant runtime decisions in ADRs when they affect long-term architecture.
