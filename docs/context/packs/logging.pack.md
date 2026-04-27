# Context Pack: Logging

- Pack name: `logging`

## Purpose

- Provide concise operational logging guidance for diagnosable startup, runtime, and boundary behavior.

## Use When

- Startup/boot sequence implementation.
- Runtime execution and adapter diagnostics work.
- Transport/host/infrastructure changes where failures or latency must be diagnosable.
- Improving observability and incident triage quality.

## Do Not Use When

- Tasks with no logging behavior impact.
- Pure naming/refactor/doc tasks unrelated to runtime diagnostics.

## Core Guidance

- Use structured logs with stable fields; avoid ad hoc console text.
- Keep application orchestration logging behind `modules/application/ports/logging` (`LoggingPort`) rather than direct logger-library calls.
- Log meaningful boundary events and transitions (host, transport, runtime, persistence/storage boundaries).
- Ensure startup and critical runtime flows are diagnosable without debugger-only context.
- Break long operations into meaningful logged stages with per-stage and total duration.
- Make log levels/verbosity configurable via environment/configuration, without code edits.
- Use `modules/contracts/config` (`LoggingConfig`) for typed verbosity configuration shapes.
- Require runtime diagnostics (`modules/contracts/runtime`) to derive from shared structured logging semantics and map mechanically to `StructuredLogEvent`.
- Keep runtime diagnostics in the `runtime.*` namespace and avoid alternate runtime-only event vocabularies.
- Higher verbosity should increase detail while preserving structure, consistency, and redaction.
- Avoid both log spam and low-signal logs; prioritize decision points, state transitions, anomalies, and outcomes.

## Key Constraints

- Never log secrets/credentials/tokens or unredacted sensitive payloads.
- Do not duplicate the same error excessively across layers; log once per boundary with ownership.
- Logging changes should preserve stable event/field naming for correlation and operations.

## Canonical Source Docs

- `docs/standards/logging-standards.md` — canonical structured logging expectations and coverage requirements.
- `docs/standards/coding-standards.md` — boundary-aware error handling and operational safety.
- `docs/architecture/host-model.md` — startup/lifecycle boundary context for hosts.
- `docs/architecture/runtime-model.md` — runtime adapter boundary and error mapping context.

## Common Over-Inclusions to Avoid

- Logging-library implementation internals when task is about policy/coverage.
- Pulling full architecture packs unless boundaries are changing.
- Verbose payload dumps instead of structured summaries with identifiers.

## Prompt Assembly Notes

- Typical set: `index` + `logging`.
- Add `runtime`, `desktop-host`, or `server-host` for boundary-specific diagnostics.
- Add `testing` when adding regression coverage for logging-critical failures.
