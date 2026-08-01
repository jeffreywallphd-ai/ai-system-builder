# Controlled Conversational System Execution

- Status: current
- Related decisions: `docs/adr/ADR-0023-controlled-conversational-system-execution.md`, `docs/adr/ADR-0039-dedicated-system-runtime-data-plane.md`
- Verification: `docs/architecture/architecture-verification.md`

## Purpose

Controlled conversational execution defines the first runnable composed-system execution slice while preserving the existing composition-first architecture.

Architecture thesis: controlled execution orchestration can run a user-configured conversational AI system only after a reviewed execution plan, valid runtime readiness, and explicit approval. User-message turns invoke a supported text-generation runtime through a narrow runtime adapter boundary, with lifecycle, progress, safe diagnostics, assistant response results, cancellation/retry policy, and provenance recorded without making chatbot behavior the universal definition of runnable systems.

Invariant: the first conversational-system execution slice must exercise the general composed-system execution architecture. It must not make a chat page, prompt string, one local model, one API provider, or one runtime implementation the domain model for runnable systems.

## Product direction

- Users compose customized runnable systems from assets, workspace-effective customizations, composition plans, runtime readiness bindings, and execution-plan previews.
- The first executable proof is conversational (chat-style test/run), not image-generation-first.
- Conversational execution demonstrates customization, repeated interaction, session state, controlled invocation, response persistence needs, and an extensible path toward tools/retrieval/memory.
- Image generation remains a later runnable-system slice.
- ComfyUI is not the first conversational adapter unless a later image-generation decision explicitly selects it.

## Execution plan prerequisite

Controlled conversational execution depends on execution plan preparation as a stable, non-executing planning layer.

Controlled conversational execution may rely on execution plan preparation providing:

- workspace-scoped execution plan records;
- execution plan previews in Assets / Plans / Setup;
- source composition plan and runtime readiness binding references;
- planned steps/inputs/outputs/dependencies;
- safe adapter/setup references;
- safety gates, blockers, diagnostics, resource estimates, provenance;
- `ready-for-review` status that is explicitly non-executing.

If execution plan preparation has unresolved material defects, controlled conversational work should not proceed beyond architecture/docs clarification until those defects are corrected.

## Core concepts and vocabulary

- **Controlled execution orchestration**: explicit, policy-checked execution lifecycle for runnable systems.
- **Runnable conversational system**: a composed system whose supported execution behavior is turn-based text generation.
- **Conversational system definition**: safe references/configuration that define conversational behavior for a composed system.
- **Execution session**: approved execution context tied to reviewed plan/readiness inputs.
- **Conversation session**: user-visible persistent chat context for a configured composed system.
- **Conversation turn**: one user message and corresponding assistant-response generation lifecycle.
- **User message**: user input submitted for a turn.
- **Assistant response**: generated assistant output associated with the turn result.
- **Execution run**: controlled operational invocation producing one turn result.
- **Execution attempt**: one attempt within a run (supports retry/failure/cancellation tracking).
- **Execution event**: safe lifecycle/progress/audit event during orchestration.
- **Execution result**: safe recorded output reference for a run/turn.
- **Execution approval**: explicit user/system authorization boundary required before invocation.
- **Approval gate**: policy checkpoint validating approval scope validity.
- **Start eligibility**: validation that plan/readiness/approval/support constraints permit invocation.
- **Runtime invocation port**: application-facing boundary used to request supported runtime execution.
- **Text-generation runtime adapter**: adapter implementing supported text-generation invocation behind the runtime port.
- **Supported runtime adapter**: adapter explicitly approved for this execution slice.
- **Turn invocation**: run creation + invocation flow for a submitted turn.
- **Response generation**: controlled production of assistant response result.
- **Progress event**: safe state/progress signal during invocation.
- **Cancellation request**: explicit request to stop an in-flight run/attempt.
- **Retry request**: explicit request to start a new attempt under safe policy.
- **Failure classification**: normalized safe failure type with no raw provider payloads.
- **Result reference**: stable safe pointer to assistant response/result record.
- **Conversation history reference**: stable safe pointer to session turn history.
- **Safe diagnostic**: bounded redacted diagnostic data.
- **Audit/provenance event**: immutable event describing lifecycle/provenance transitions.
- **Runtime unavailable**, **runtime not ready**, **execution unsupported**, **execution blocked**, **execution stale**, **execution deferred for unsupported systems**: safe execution-state outcomes.

## System relationship

Controlled conversational execution is not a separate chatbot app. Runnable conversational execution remains downstream from composed-system architecture:

```text
assets/customizations
  -> workspace-effective assets
  -> composition plan
  -> runtime readiness binding
  -> execution plan preview
  -> approved conversation execution session
  -> controlled turn invocation
  -> assistant response/result reference
```

A conversational system may include safe configuration such as display label, instruction reference, supported text-generation capability label, generation settings, greeting, and expected IO role semantics. Final prompt/materialization boundaries must stay behind explicit contracts and protected context handling.

The closed `reference.controlled-chatbot@1.0.0` System Builder template proves
this relationship with exact-version reusable shell, conversation, model,
context, instruction, generation, policy, audit, inference, fallback, and state
assets. The instruction configuration is marked protected and is not copied to
public build, approval, operational-diagnostic, or session-summary surfaces.

## Conceptual model

### Conversational System Execution Session

Conceptually includes: execution session id, conversation session id, workspace id, source execution plan id, source composition plan id, source runtime readiness binding id, supported adapter reference, status, approval status/reference, display label, conversation history reference, turn summaries, blockers, diagnostics, provenance, and timestamps.

### Conversation Turn

Conceptually includes: turn id, conversation session id, execution run id, optional attempt ids, user-message reference/content boundary, assistant-response result reference, turn status, capability reference, progress/event summary, blockers, diagnostics, and timestamps.

### Execution Run

Conceptually includes: run id, workspace id, source execution plan id, conversation session id, turn id, run status, approval reference, runtime adapter reference, attempt summaries, progress/event summaries, result references, failure/cancellation/retry info, blockers, diagnostics, provenance, and timestamps.

### Execution Attempt

Conceptually includes: attempt id, run id, attempt number, attempt status, supported adapter reference, timing/progress summary, result reference, failure classification, cancellation state, provenance, and timestamps.

### Execution Result

Conceptually includes: result id, run id, turn id, result kind (initially assistant response), safe response display reference/content boundary, optional future artifact reference, completion status, diagnostics, and timestamps.

All controlled conversational execution records avoid credentials, secrets, raw env values, raw paths, command lines, stack traces, raw provider responses, signed URLs, bytes/base64, unbounded logs, executable payloads, and generic workflow JSON.

## Conversation session vs run distinction

- Conversation session: persistent interactive context.
- Conversation turn: one user-message/assistant-response interaction.
- Execution run: controlled invocation for that turn.
- Execution attempt: one attempt to complete a run.

Default model: one conversation session has many turns; each assistant-generating turn creates one execution run with one or more attempts.

## Runtime data placement

An installed published system has one opaque runtime-instance identity and a
dedicated physical database. Conversation sessions, turns, messages, assistant
responses, operation records, and release-bound system data use repositories
composed from that exact runtime session. Platform deployment/release/audit
records remain in the control plane. Neither renderer nor conversation input can
select a file, database, role, connection string, or another runtime instance.

Stop closes the data session without erasing the transcript. Compatible release
migration is explicit and stopped-state only; clone installation allocates a new
database. Uninstall retains data until a separate confirmed deletion operation.

## Published desktop runtime session

For a published visual system, the user's explicit lifecycle **Start** action is
the session-scoped approval to interact with the exact approved release. Start
revalidates the immutable release, release-bound model revision, active runtime
instance, deployment state, and host capability before it prepares the sidecar
and opens or focuses a dedicated Electron window. The renderer cannot supply or
replace any of those identities.

The lifecycle read model performs the same fail-closed readiness screen before
offering Start or Activate. A legacy immutable release with no exact model and
interaction binding is explained as requiring a corrected, newly published
build; a missing legacy runtime allocation requires explicit reinstall only
when the release itself is otherwise valid. Neither case is repaired by
silently mutating release evidence or inventing model authority.

The runtime window uses its own sandboxed, nonpersistent partition and a minimal
preload that exposes only bounded transcript reads and message submission. Main
accepts only the exact live main frame registered to that runtime session, then
uses application conversation services composed over the instance database.
Navigation, popup creation, permission requests, Node integration, arbitrary
IPC, and renderer-selected launch targets are denied. A preparation or window
failure is sanitized and compensates by stopping the runtime.

Stop closes the window and its application conversation session before closing
runtime database handles. Restart reopens the same retained conversation. The
builder's preview remains inert, and the published runtime never falls back to
the former in-page modal.
Closing the dedicated published-system window is also an authoritative Stop
signal for that exact release and started revision. Main removes the window and
conversation session first, then invokes the host lifecycle Stop callback; a
programmatic close caused by Stop does not invoke Stop a second time. While a
published release is running, its lifecycle card periodically re-reads the
authoritative projection so this host-originated transition replaces the stale
running presentation without requiring a manual refresh.

## Approval and eligibility boundary

Execution plan preparation remains preview-only and non-executing.

Initial approval flow:

1. User reviews the execution plan preview.
2. User selects **Test this system** / **Start chat**.
3. System creates a conversation execution session tied to the reviewed plan.
4. User confirms or initiates under valid runtime/setup conditions.
5. Each sent message creates a controlled turn/run invocation.

Initial policy: approval is valid for the active conversation session only while source execution plan and runtime readiness binding remain unchanged and valid. Any stale/changed inputs invalidate approval and block new invocations pending re-review.

This reviewed-plan flow applies to builder testing. Published lifecycle execution
uses the separate exact-release Start session above; it does not convert a
published release into ambient or renderer-controlled authority.

## Initial statuses

- Conversation session: `draft`, `awaiting-approval`, `approved`, `active`, `blocked`, `stale`, `invalid`, `closed`, `archived`.
- Conversation turn: `draft`, `submitted`, `generating`, `succeeded`, `failed`, `cancel-requested`, `cancelled`, `retryable`, `blocked`, `stale`, `invalid`.
- Execution run: `draft`, `awaiting-approval`, `approved`, `queued`, `running`, `succeeded`, `failed`, `cancel-requested`, `cancelled`, `retryable`, `blocked`, `stale`, `invalid`, `archived`.
- Attempt: `pending`, `started`, `progressing`, `succeeded`, `failed`, `cancel-requested`, `cancelled`, `timed-out`.

`approved` permits later invocation but is not invocation. `queued` means accepted for invocation. `running` begins only when adapter execution starts. `succeeded` requires safe result reference. `cancel-requested` is not guaranteed cancellation completion. `retryable` requires safe policy. `stale` blocks invocation until revalidation.

## First supported runnable slice

The first supported slice is a conversational text-generation system with a valid execution plan, valid runtime readiness binding, an exact release-bound workspace model record, safe configuration references, user text input, assistant text response result, and conversation association.

Not in the initial slice: tools, retrieval, external actions, image/audio IO, arbitrary workflow graph execution.

Unsupported plans must resolve to safe unsupported/blocked/deferred outcomes.

## Runtime adapter boundary

Use narrow invocation/cancellation/progress/result ports behind application-facing runtime seams:

- `TextGenerationInvocationPort`
- `ConversationTurnInvocationPort`
- `ExecutionCancellationPort`
- `ExecutionProgressSinkPort`
- `ExecutionResultSinkPort`

The implemented first adapter path is the Python conversational text-generation runtime adapter. Server and desktop host composition wire a conversational adapter catalog, runtime guard, and invocation port into the shared conversation execution services. The adapter supports runtime references for the Python sidecar with `text-generation` capability, invokes the Python worker `conversation-text-generation` task, and returns a bounded assistant text result through the controlled turn orchestration path.

The selected model originates on the composed message-composer instance, is
resolved by the workspace model authority during validation and build, and is
frozen into the approved release with a model-revision digest. Activation and
start revalidate that exact record. The invocation runtime reference carries
only its normalized model-record identity; the Python adapter resolves it again
and sends only the authority-owned runtime `modelId` to the worker. A missing,
malformed, stale, incompatible, or cross-workspace record blocks before worker
submission and does not persist an accepted turn.

The worker resolves that exact model identifier only through its host-owned
local Hugging Face cache. A first turn after runtime startup validates the
complete local snapshot and loads it on demand; it never requires unrelated
Dataset Preparation activity to have left the model in process memory and does
not acquire a missing model from the network. Warm turns reuse only an exact
loaded-model match. Conversation polling uses the worker's bounded short-task
deadline so initial model construction cannot outlive the application caller.
When the approved record is a LoRA adapter, the adapter also re-resolves its
exact associated full base-model record in the same workspace and sends the
worker only both authority-owned model ids plus an opaque generated revision
when available. The worker validates the complete local base snapshot, confines
the adapter snapshot to its cache repository, verifies the adapter configuration
names that same base model or the exact already-resolved legacy local reference,
and attaches the reviewed PEFT adapter. The legacy comparison is worker-local
and does not admit or transmit a caller-selected path. Missing,
ambiguous, mismatched, or escaped associations fail closed before generation;
host paths never cross the runtime request boundary.

This adapter path is a supported implementation of the first conversational slice, not a general runtime execution permission. It still requires reviewed execution-plan identity, source verification, approval validity, runtime readiness/runtime guard success, and host submit support before a turn may run. The adapter does not currently advertise progress or cancellation capability; cancel, retry, and streaming remain unsupported unless an application/runtime path genuinely supports them.

## Message/content and diagnostics boundary

- Do not persist raw provider payloads in general execution records.
- Do not expose raw runtime request/response payloads in diagnostics.
- User/assistant text exposure belongs to transcript/result surfaces, not generic operational summaries.
- User-authored instruction text should be referenced from authored assets/protected configuration, not duplicated in audit logs or generic run metadata.

## Relationship to upstream architecture

- Primary dependency: execution plan preparation.
- Eligibility verification: runtime readiness binding validity.
- Optional user-facing context: safe asset composition planning summary metadata.
- No mutation of effective asset projection, composition planning, runtime readiness, or execution plan records as an execution side effect.
- Changed composition/readiness/plan inputs stale or invalidate approval per policy.

## UI direction

Systems owns execution-plan selection and whole-system Run & Test. The shared
desktop/thin presenter lists actual execution-plan summaries, creates sessions
with the selected execution-plan id, projects application-owned action and
availability state, and never treats a composition-plan id or display label as
execution authority.

The conversational run workspace provides conversation history, composer,
assistant response area, safe diagnostics, approval state, and explicit
association to the selected execution plan. Its visible transcript is bounded
and exposed as an ordered live `role="log"`; message input is length-bounded.
The controlled reference composition starts with an empty history and one typed
`persisted-only` composer-to-history interaction, so only stored user and
assistant messages appear in the transcript.
Cancel and retry controls appear only when both the application read model and
host client advertise the operation.

Nothing runs until the user starts a conversation, explicitly approves the
session, and sends a message through the controlled invocation path.

## Transport split rule

Keep these transport responsibilities separately scoped and reviewed:

1. API/server-host exposure.
2. IPC/preload/desktop-host exposure.
3. Desktop/thin-client client wrappers and parity.

These must be routed and reviewed separately.

## Non-goals

Controlled conversational execution does not make chatbot behavior the universal runnable-system model and does not authorize workflow/image/ComfyUI execution, tools/retrieval/memory/multimodal/background/distributed execution, raw provider payload exposure, credential exposure, or mutation of upstream composition/readiness/planning records.

## Asset-first architecture

### Layer A - Reusable conversational asset family

The first runnable conversational proof starts from reusable/importable conversational assets composed from referenced `system.foundation` primitives where applicable.

### Layer B - Controlled runtime instances

Conversation sessions, turns, messages, assistant responses, execution runs, attempts, events, approvals, cancellation requests, retry requests, and results are created only when the composed system is used at runtime. These runtime records are not reusable/importable composition assets.

### Corrected pipeline

```text
system.foundation primitives
  -> reusable conversational composite assets
  -> import/customize in workspace
  -> compose a chatbot system
  -> runtime readiness binding
  -> execution plan preview
  -> approved conversation session
  -> controlled turn execution
  -> assistant response/result records
```

### No-copy semantics

- `system.foundation` definitions remain canonical.
- Reuse establishes references, dependencies, and lineage instead of copied foundation records.
- Importing/using/composing conversational starter assets must not copy foundation records into workspace-authored storage merely through use.
- Workspace-authored records are created only by deliberate customization/override behavior.
- Derived conversational assets are reusable composites and are not reclassified as primitive defaults unless built-in pack metadata explicitly preserves derived lineage.

Runtime records are operational records only and are never reusable asset substitutes.

## Boundary repair status

- Session/source summaries derive reusable/customized conversational-system claims from structured verified source evidence. A composition-plan id, label, summary, runtime capability string, or renderer/browser-provided text is not proof of conversational origin.
- Conversation session creation accepts reviewed execution-plan identity and workspace scope only. Display/source identity is derived from verified source records rather than caller-provided `systemLabel` or `systemSummary` claims.
- Session read models project submission/action availability from current application eligibility: session status, approval validity, source validity, runtime-readiness/runtime-reference state, host submit support, and active-turn constraints. Provenance text alone is not execution readiness.
- Transcript reads and completed submit results are the deliberate visible-content surfaces. Session summaries, action availability, activity, approval/cancel/retry, diagnostics, and errors remain operational and must not copy full transcript text or protected runtime/provider context.
- API, IPC, preload, desktop-client, and thin-client surfaces use typed safe DTOs for conversational operations. Cancel and retry remain unsupported/deferred unless application behavior can actually perform them. Streaming remains deferred.
- Real server and desktop hosts compose the conversational service family. Both expose session/read/approval boundaries; turn submission is wired only through the controlled application/orchestration/runtime-adapter path and must still pass approval/source/readiness/runtime guards. No production fake response generator is allowed.
- Desktop and thin-client Systems surfaces share one Run & Test presenter. It
  uses real execution-plan identity, bounded accessible transcript rendering,
  safe nested transport-envelope normalization, and truthful unsupported
  capability copy; the former UI correctness gap is closed.

## Protected invocation context

The application invocation seam carries an explicit approved source chain: workspace, conversation session, reviewed execution plan, composition plan, runtime-readiness binding, execution approval, and runtime-reference identities. Conversation-session approval validity re-verifies those records before adapter selection; the identity bundle is association context, not independent proof or a persisted replacement for source records.

Materialized system instructions, visible turn content, bounded history, and supported generation settings may cross only the protected context port and remain transient in memory. The context validator requires exact provider-neutral structure and matching source/runtime associations, rejects unexpected payload fields and high-confidence raw secret/executable dumps, and runs before the invocation adapter. Operational run, event, approval, provenance, diagnostic, and session-summary records must not receive this protected context or raw adapter request/response data.
