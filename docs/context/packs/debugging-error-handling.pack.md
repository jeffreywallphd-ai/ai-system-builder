# Context Pack: Debugging & Error Handling

- Pack name: `debugging-error-handling`

## Purpose

- Provide a lifecycle-first debugging model that fixes execution behavior, not just surfaced error text.
- Keep debugging changes aligned with architecture boundaries and timeline-focused regression testing.

## Use When

- Prompts ask to debug, diagnose, or fix failures (errors, exceptions, hangs, timeouts, broken flows).
- Investigating lifecycle issues across request transport, runtime/background execution, progress monitoring, cancellation, or async state.
- Fixing defects where the timeline (not only final state) determines correctness.

## Do Not Use When

- Tasks are purely feature implementation with no failure investigation.
- Pure docs/naming/formatting tasks unrelated to runtime behavior or failure handling.

## Core Guidance

- Do not patch symptoms first; trace the full end-to-end execution path before editing.
- Identify the expected invariant before proposing a fix.
- Classify failure precisely before changing behavior:
  - user input validation failure
  - domain/application validation failure
  - transport/request failure
  - adapter/provider failure
  - background task failure
  - progress/status monitor failure
  - cancellation/stop flow
  - stale async state
  - missing runtime task correlation or unsupported task listing
- Treat long-running work carefully:
  - for desktop long-running tasks, combine async task lifecycle (start/poll/cancel) with Electron power-suspension blocking instead of relying on long-held transport requests
  - transport failure does not necessarily mean task failure
  - background task can continue after request disconnect
  - `finally` teardown can incorrectly kill active progress monitoring
  - polling/subscriptions should survive recoverable disconnects
  - readiness-guard-rejected starts should surface unavailable responses and should not tell callers to poll nonexistent tasks
  - unknown task status/cancel reads should be explicit not-found/unknown outcomes, should use `recordType: "not-found"` when no valid task family is known, should not start runtimes, and should not fake an invalid `TaskType` when the task family is unknown
- Fix lifecycle behavior first; do not stop at improving error wording.
- Preserve architecture boundaries while debugging:
  - UI handles UI state and progress display
  - preload/IPC remain proxy/transport boundaries
  - use cases enforce application rules
  - adapters translate provider/runtime details
  - provider-level failures should become sanitized structured readiness/status objects where the application service can isolate them; raw provider exception text must stay out of readiness snapshots/statuses
  - guarded runtime-backed starts should fail as structured unavailable responses rather than generic internals when readiness reports the required feature capability is not ready
  - unexpected transport handler failures and task-list delegate failures should return sanitized, generic messages/metadata rather than raw exception text
  - runtime workers execute tasks
- Add tests for execution timelines and state transitions, not only final outputs.

## Pre-Edit Debugging Checklist

- What failed?
- Where was the error produced?
- Was the underlying task still running?
- Is this a terminal error or recoverable transport failure?
- What state should remain alive?
- What cleanup/teardown should not run?
- What invariant must hold?
- Which tests prove the timeline?

## Reusable Debugging Prompt Template

> Before changing code, trace the full execution timeline across all relevant layers.
>
> Identify:
> 1. the expected invariant
> 2. the actual observed failure
> 3. the source of the error
> 4. whether the underlying task is still active
> 5. whether the error is terminal or recoverable
> 6. which cleanup/teardown paths may be wrong
> 7. the smallest fix that preserves the invariant
>
> Do not only change the displayed error message.
> Fix the lifecycle behavior.
>
> If a request fails with `fetch failed` but the runtime task continues, treat the request transport as disconnected, not the task as failed. Keep progress monitoring active until runtime status confirms completion, failure, or cancellation.

## Canonical Source Docs

- `docs/standards/coding-standards.md` — boundary-safe failure handling discipline.
- `docs/standards/testing-standards.md` — regression strategy for timeline-sensitive bug fixes.
- `docs/architecture/host-model.md` — lifecycle responsibilities across host/transport boundaries.
- `docs/architecture/runtime-model.md` — runtime execution flow and adapter boundary expectations.

## Common Over-Inclusions to Avoid

- Loading all architecture docs for a narrow defect localized to one boundary.
- Applying runtime-specific assumptions to pure validation failures.
- Treating transport disconnects as guaranteed task termination.

## Prompt Assembly Notes

- Typical set: `index` + `debugging-error-handling`.
- Add `runtime` for runtime/worker/background-task failure paths.
- Add `desktop-host` or `server-host` for transport, IPC/preload, or host lifecycle failure paths.
- Add `desktop-implementation` for renderer/UI progress-state issues.
- Add `testing` when proposing/implementing regression coverage.
