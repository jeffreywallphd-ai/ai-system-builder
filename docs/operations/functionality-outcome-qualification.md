# Functionality outcome qualification

- Status: implementation procedure; controlled qualification pending
- Owner: `functionality-optimization`, increment 4
- Requirements: `functionality-qualification-crosswalk.json`
- Verification: focused qualification tests and current overall control-plane work

Run `node dev-tools/scripts/qualification/check-functionality-qualification.mjs
--write` from the repository root. It reads canonical owner state and actual
source, verifies complete controlled-criterion coverage and writes ignored
`docs/tmp/functionality-qualification-assessment.json`. A successful assessment
can report pending qualification; it never approves or completes a roadmap.
Missing inputs, changed source, unsafe references and owner drift fail closed.
Keep the review site's roadmap criteria pending until their actual evidence is
available. Source and owner-state digests bind a report to its observed inputs;
regenerate it after source or owner changes. Historical passes need current
source and named environment qualification and are not silently transferred.

## Available evidence and separate owners

Local browse journeys cover packaged desktop and thin-client authoring with
synthetic records; observer and lifecycle fixtures cover their stated failure
conditions. The Context comparison records actual isolated native memory/timing
with deterministic embeddings. These are useful local evidence and do not qualify
representative hardware, model quality, participants or manual accessibility.
The crosswalk lists existing harnesses for each owner; model/provider harnesses
remain opt-in. Do not download a model or use credentials through this assessor.

Asset experience, Data Management and optional constrained JSON retain their
original approvals and pending criteria. Security remediation retains its own
blocked file-effect qualification and independent work. The active-source Run &
Test proposal retains its approval gate. This procedure grants none of those
owners new authority. OCR remains unavailable; hardware availability alone
cannot satisfy the advanced-capability criterion.

## User task study

No participants are currently available. Prepare synthetic inputs and assign
each critical journey to at least five representative nondeveloper participants:

| Journey | Task and observable finish | Measurements |
| --- | --- | --- |
| Data | Acquire synthetic source, review a flagged row, save a prepared dataset and find the saved item | Unassisted completion, authority confusion, data loss, elapsed time, ease |
| Assets | Customize a permitted asset, inspect the changed values, publish through the supported workflow and find the result | Correct scope/provenance, unassisted completion, errors, ease |
| Systems | Compose a supported system, resolve validation, build/publish and use its supported runtime path | Correct validation and approval handling, completion, errors, ease |
| Context | Create/select a synthetic Context package, retrieve a labeled answer and inspect exact citations | Relevant result, correct citation identity, completion, ease |
| Models | Select an authorized installed/downloaded model, prepare/train through an available local profile and find the resulting model | Truthful progress/cancel/retry, result identity, completion, ease |

Never use the unapproved active-source proposal to make a task executable. Record
an unavailable step and its owner when a supported environment is absent. Use
distinct task IDs and no participant names, recordings, prompts or outputs in
repository evidence. Record counts, facilitator interventions, failures and
retries rather than only successful attempts. The approved target is at least
4 of 5 unassisted successes for every critical task, zero critical data loss or
authority confusion, and median ease at least 5/7. A small study does not establish
population success. A participant run that was not performed remains pending.

## Accessibility profiles

Manual qualification needs named OS, packaged desktop build/browser, viewport,
zoom, input method and actual screen reader/version for both desktop and thin
client. Exercise each task keyboard-only, opening and closing dialogs, validation
errors, loading/terminal status, workspace changes and focus return. Check
320 CSS-pixel reflow, contrast, non-color status and reduced motion. Record each
exception and reproduction using synthetic data. Automated semantic/axe checks
are supporting evidence; they do not substitute for screen-reader or keyboard
operators. Critical unresolved exceptions prevent qualification. These manual
profiles are currently unavailable.

## Model and resource cohorts

Use only separately authorized, already-installed fixed models. Declare model
revision, task/corpus/held-out digest, seed, schema, metric and statistical
tolerance before comparisons. Use existing nine-task training and preparation
matrices where supported, with separately recorded CPU, accelerator,
constrained-memory and constrained/unchecked JSON cohorts. Keep cold and warm
results separate; record RAM/VRAM measurement method, hardware, dependency
versions, elapsed time, invalid output, failures, retries and cleanup.

Report accepted examples or accepted task outcomes per minute, not raw tokens
alone. Retain every attempt. A candidate needs no statistically material quality
regression under the predeclared task metric/tolerance and at least 20 percent
better accepted-output throughput, or demonstrated compliance with the approved
resource budget. Do not choose a tolerance after seeing results. Compare only
matching cohorts; unavailable or skipped runs stay pending. Deterministic Context
conformance and Python fixtures are not installed-model quality evidence.

## Whole-host task qualification

This procedure is pending for both a packaged desktop host and a managed server
with thin client. Record source/build, OS, runtime/dependency versions, transport,
installed model revision, device, fixture digest and the physical worker identity
in private operator evidence; retain only sanitized identity digests and counts
in repository evidence. Use a disposable workspace and synthetic inputs. Never
terminate unrelated processes or use a real user's data to inject failure.

For each supported download, training, image and Context family, run a successful
task, leave its feature page while active, reopen it and verify exact task/result
identity. Repeat with workspace navigation, transport disconnect/reconnect,
explicit cancellation, an owned disposable worker failure and graceful host
shutdown. Mark unsupported cancellation/families explicitly unavailable; do not
admit currently denied route families merely to run this procedure. Record all
attempts, task-status times, output finalizations and resource release times.
Verify stale workspace responses cannot update the destination, terminal outputs
finalize once, retries preserve authority and resources are released without an
open page. Measure healthy-local progress and terminal visibility p95 against the
approved 2 second target; distinguish transport outages from that denominator.
Check actual worker exit, staging removal, subscriptions and power leases after
each terminal/failure/shutdown case. Unreleased resources or ambiguous ownership
fail the run; cancellation acknowledgment alone is insufficient.

Owned-task reconciler, host shutdown and runtime supervisor tests are supporting
failure-path fixtures. The Python training E2E runner exercises training only;
none alone qualifies whole-host observation, physical cleanup or every family.

## Installed Context embedding qualification

This procedure is pending. Use a fixed authorized, already-installed embedding
model/revision and a digest-identified synthetic corpus with predeclared query
and relevant-citation labels. Declare chunking, dimensions, top-k, seeds, cold
and warm cohorts, repeat count, precision and measurement method before running.
Prepare separate unchanged-baseline and candidate packages through the real
generation/application path with the same corpus/model settings. Do not use the
deterministic synthetic embeddings or tiny random-model test as quality proof.

On each named CPU, accelerator and constrained-memory profile, execute the held-out
queries through the supported Context operation. Record retrieval recall@5,
exact citation identities, failures, retries, p95 latency and isolated incremental
peak RSS, including package/model load and cleanup. The approved targets are
recall@5 at least 0.90, absolute recall degradation at most 0.02, unchanged exact
search/citation correctness, at least 25 percent lower incremental peak RSS on
10000/100000 chunk fixtures and no more than 5 percent p95 latency regression.
Keep workload dimensions and cold/warm results explicit. Preserve a rejected
fixture that exceeds an existing resource limit; never enlarge a limit to get a
pass. Denied/corrupt/wrong-workspace packages and cancellation must still fail
safely. Keep model/package digests and aggregate metrics, not private text,
vectors, paths or outputs, in evidence. Unavailable profiles remain pending.

`run_context_efficiency_qualification.py` supplies the bounded deterministic
allocation comparison; Context tests supply conformance and failure coverage.
They support this procedure but do not measure installed-model retrieval quality.

## Release decision

After all implementation chunks are recorded, run the configured aggregate suite
through a serial `overall` work item, applicable repository/build gates and real
separate-invocation review. Preserve failed attempts and triage failures; a skip
is not a pass. Link the exact current receipt and owner evidence before recording
local completion. Every controlled criterion must pass before final roadmap
completion. While participants, manual profiles, provider credentials or physical
model environments are unavailable, release qualification remains pending.

Rollback withdraws an unqualified candidate and preserves evidence and stronger
security controls. Never restore weaker authority or declare an unavailable check
passed to meet a schedule.

The first implementation aggregate attempt is retained as failed. Focused repairs
addressed shared Node globals, platform-sensitive fixtures, stale expected family
exports, relocated test-root resolution and a Python startup diagnostic race.
The subsequent reviewed aggregate passed (standard Node3201/Vitest431 and E2E
Node92/Vitest3 passed, with four Node skips; Python AI command exited zero).
Both receipt identities and failed-attempt history remain in
`docs/functionality-optimization-review.json`. Later security edits make this
historical evidence, requiring a fresh final candidate run. Registry transmission
was authorized and the audit executed. Official dependency/toolchain updates leave
zero runtime affected entries and seven high-severity affected toolchain package
entries through the original braces supplier. The user retained that supplier and
directed tooling qualification remain pending; the unchanged zero-advisory gate
still fails. All15controlled criteria remain pending and controlled environments
remain unavailable. The latest final-source aggregate/review belongs to the
control-plane overall work; no fork, waiver or qualification pass is implied. Never subtract an unexecuted child, erase a failed attempt
or report a skipped/unsupported check as success.

A later final-source attempt retained six headless artifact action-fixture
failures (standard Node3282passed/2skipped; Vitest427passed/6failed; E2E Node92
and Vitest3passed). Invalid synthetic image bytes now explicitly use unavailable
binary-read fallback; all17exact artifact tests and independent fixture review
passed with action/delete safeguards preserved. The original attempt remains in
the JSON history. Find current final aggregate evidence through the newest
control-plane work bound to this roadmap and `overall`; a hardcoded work id or
historical pass cannot establish current qualification. The original-supplier
dependency gate still fails and all15controlled criteria remain pending.
