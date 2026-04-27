# Logging Standards

## Purpose

Logging in `ai-system-builder` is a diagnostics capability, not a console side effect.

Required outcome: meaningful failures, slowdowns, and boundary issues must be diagnosable from logs without guesswork.

## Core rules

- Use structured logging (machine-parseable key/value fields), not ad hoc free-text logging.
- Use a common logging contract across modules instead of mixed styles.
- Application orchestration emits logs through `modules/application/ports/logging` (`LoggingPort`) rather than calling adapter/logger libraries directly.
- Log boundary events and significant transitions, not every internal line.
- Include enough context to correlate events across host, transport, application, runtime, and persistence boundaries.

## Logging levels and configurable verbosity

The system must support configurable verbosity without code changes.

Minimum supported operational modes:

1. **Minimal production-oriented logging**
   - critical lifecycle milestones, warnings, errors, and key outcome events.
2. **Normal operational logging**
   - standard request/use-case flow events and boundary summaries.
3. **Verbose diagnostic logging**
   - additional context and stage-level timing for troubleshooting.
4. **Highly detailed trace/debug logging**
   - fine-grained step details for incident analysis and difficult debugging.

Rules:

- verbosity is controlled by environment/configuration,
- higher verbosity adds context and sub-step detail,
- redaction/privacy standards apply at all levels,
- production defaults should favor signal over volume.

## Shared logging contract vocabulary

Shared contract types for logging live in `modules/contracts/logging`.
Typed logging configuration shape (`LoggingConfig`) lives in
`modules/contracts/config` and reuses the shared verbosity vocabulary.

Canonical identifiers for contracts:

- `LogLevel`: `trace`, `debug`, `info`, `warn`, `error`, `fatal`.
- `LogVerbosity`: `minimal`, `normal`, `verbose`, `trace`.
- `StructuredLogEvent`: stable envelope fields for `event`, `message`, `component`, correlation context (`correlationId`, `requestId`), and optional diagnostics (`host`, `operation`, `useCase`, `outcome`, `data`, `durationMs`, `error`).
- `StructuredLogDiagnosticFields`: reusable subset of `StructuredLogEvent` used by specialized diagnostic contracts.

Runtime-specific relationship rule:

- `RuntimeExecutionDiagnostic` (in `modules/contracts/runtime`) must specialize `StructuredLogDiagnosticFields` instead of duplicating an independent runtime-only vocabulary.
- Runtime diagnostic events must use the `runtime.*` namespace and remain directly mappable to `StructuredLogEvent`.
- Runtime-specific fields should be additive and minimal (for example execution/stage context), not alternate level/verbosity/error semantics.
- Runtime diagnostic mapping should stay mechanical (`mapRuntimeDiagnosticToStructuredLogEvent`) with no per-adapter field remapping conventions.
- If runtime diagnostics need new shared semantics, evolve `modules/contracts/logging` first rather than forking runtime-only equivalents.

Contract and adapter implementations should keep these field names and identifiers stable so logs remain comparable across hosts, transports, and runtime/persistence/storage boundaries.

## Minimum useful fields for important logs

For startup, boundary, and failure logs, include at minimum where applicable:

- `timestamp`
- `level`
- `message`
- `event` (stable event name)
- `host` (desktop/server)
- `module` or `component`
- `operation` or `useCase`
- `correlationId` / request identifier
- `durationMs` for completed timed operations
- `outcome` (`success`, `failure`, `timeout`, etc.)
- error fields on failure (`errorType`, `errorCode`, `errorMessage`)

Field naming should remain consistent across adapters and hosts.

## Required boundary logging coverage

At minimum, emit structured logs for:

- host startup/shutdown and composition stages,
- transport entry and transport exit,
- major use-case execution start/end,
- runtime adapter invocation and result mapping,
- persistence operations affecting key business flows,
- storage operations for critical artifact lifecycles,
- retries, timeouts, circuit-breaker/open states (if implemented),
- configuration validation failures at startup.

Absence of logs at these boundaries is a standards violation.

## Timing and long-running operation standards

One giant timing log for a long operation is not acceptable.

For any long-running flow (for example, startup or runtime execution), log meaningful stages with individual durations, such as:

- config load,
- dependency composition,
- adapter initialization,
- migration check,
- transport binding,
- readiness completion.

Rules:

- include total duration and sub-step durations,
- ensure stage names are stable and comparable between runs,
- increase stage detail under higher verbosity levels.

## Error logging standards

When failures occur, logs must support triage without re-running under a debugger.

Requirements:

- log failure event at the boundary where it is observed,
- include normalized error category plus underlying cause context,
- include correlation/request identifiers,
- include timing when relevant (timeouts, retries, slow failures),
- avoid duplicate error spam across layers (log once per boundary with clear ownership).

Do not swallow errors or emit context-free messages like `operation failed`.

## Privacy, secrets, and redaction

Never log:

- secrets, tokens, API keys, credentials,
- raw personal or sensitive payloads unless explicitly approved and redacted,
- full request/response bodies by default in production-oriented modes.

Required behavior:

- redact sensitive fields before serialization,
- apply the same redaction rules across all verbosity levels,
- ensure debug/trace mode does not bypass privacy controls.

## Signal-to-noise standards

Avoid both extremes:

- too little logging (undebuggable systems),
- excessive logging (important signals buried in noise and cost explosion).

Guidelines:

- emit logs for decisions, state transitions, boundary crossings, and anomalies,
- do not log repetitive internal loops unless diagnosing specific incidents,
- prefer summary logs with identifiers over unstructured payload dumps,
- use debug/trace verbosity for temporary deep detail rather than raising default volume.

## Review checklist

Before merging logging changes:

- Can a failure be localized to a boundary quickly from logs?
- Can long operations be broken down by stage timing?
- Is verbosity adjustable by config/env without code edits?
- Are structured fields consistent and machine-usable?
- Are secrets/sensitive fields redacted at every level?

If any answer is “no”, logging implementation is incomplete.
