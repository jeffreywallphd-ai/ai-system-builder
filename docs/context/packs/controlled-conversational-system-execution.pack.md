# Context Pack: Controlled Conversational System Execution

- Pack name: `controlled-conversational-system-execution`

## Purpose

Define and protect controlled execution orchestration for the first runnable composed-system slice: conversational system execution.

## Use When

- Conversational system execution architecture.
- Chatbot-style run/test surface design for composed systems.
- Conversation sessions, turns, messages/responses.
- Execution runs/attempts/events/results.
- Runtime approval/start/cancel/retry lifecycle.
- Text-generation runtime invocation boundaries.

## Canonical files to inspect

- `docs/architecture/asset-kernel.md`
- `docs/architecture/user-library-and-cross-workspace-reuse.md`
- `docs/architecture/asset-authoring-customization-and-overrides.md`
- `docs/architecture/effective-asset-projections.md`
- `docs/architecture/controlled-conversational-system-execution.md`
- `docs/adr/ADR-0023-controlled-conversational-system-execution.md`
- `docs/architecture/execution-plan-preparation.md`
- `docs/architecture/runtime-readiness-binding.md`
- `docs/architecture/asset-composition-planning.md`

## Core constraints

- Execution plan preparation remains non-executing.
- No invocation without explicit approval.
- Do not treat chatbot behavior as the universal runnable-system model.

## First runnable slice

- First runnable proof is conversational text-generation execution for composed systems.
- Image-generation/ComfyUI is deferred to later dedicated slices.

## Relationship to Execution Plan Preparation

- Derive start eligibility from reviewed execution plan + runtime readiness validity + explicit approval.
- Do not mutate execution plan records for execution progress.

## Session/turn/run distinctions

- Conversation session = persistent user interaction context.
- Conversation turn = one user message + assistant response lifecycle.
- Execution run = controlled invocation for one turn.
- Execution attempt = one attempt within a run.

## Explicit approval boundary

Use explicit user action (`Test this system` / `Start chat`) before runtime invocation; approval stales/invalidates when source plan/readiness changes.

For a published visual release, explicit lifecycle **Start** is a distinct
session-scoped approval after exact release, model, deployment, runtime-instance,
readiness, and host-capability revalidation. It is not renderer authority.

## Runtime adapter boundary

Use narrow invocation/cancellation/progress/result ports. The first supported adapter path is the Python conversational text-generation runtime adapter, selected through the conversational adapter catalog and guarded by runtime health/capability checks.

## Safe message/result/diagnostic constraints

- No raw provider payloads in general execution records.
- No raw runtime request/response exposure in diagnostics.
- Conversation message/assistant-response contract records are defined; persistence adapter availability must be verified against the host composition in scope.
- Published conversation and system-owned records use only the exact active
  runtime-instance database session; the platform control plane retains opaque
  placement/lifecycle references rather than transcript data.

## Anti-drift rules

- Keep composed-system chain intact: assets -> composition -> readiness -> plan preview -> approved conversational execution session -> turn invocation.
- Unsupported plans must be blocked/deferred safely, not coerced.

## Transport prompt split rule

Keep these transport responsibilities separately scoped and reviewed:

1. API/server-host exposure.
2. IPC/preload/desktop-host exposure.
3. Desktop/thin-client client/parity exposure.

## Deferred capabilities

Tools/function-calling, retrieval/RAG, memory, multimodal IO, image generation/ComfyUI execution, arbitrary workflow execution, background/distributed execution, and streaming are deferred.

## Boundary rules

- Conversational source/read summaries must rely on verified source evidence, not composition-plan ids, labels, summaries, runtime capability strings, or caller-provided display claims.
- Session creation across API, IPC/preload, and clients carries only workspace scope and reviewed execution-plan identity. `systemLabel`, `systemSummary`, raw source claims, prompt materialization, runtime/model/provider overrides, and protected context are not accepted at the external boundary.
- Current action availability comes from application eligibility/approval/readiness/runtime/host state. Provenance text alone must not enable submission.
- A conversation runtime reference must carry the normalized exact model-record
  identity frozen by the approved release. Activation/start revalidate the
  current workspace record and revision digest; the Python adapter resolves it
  again and submits only the authority-owned runtime model id. Missing, stale,
  cross-workspace, or incompatible records block before turn persistence or
  worker submission.
- Stop preserves and closes the isolated data plane. Compatible migration is
  explicit and stopped-state only; clones allocate a new database and uninstall
  retains data pending a separately confirmed deletion.
- Desktop published interaction uses a dedicated sandboxed window and minimal
  read/submit preload. Main derives authority from the exact registered main
  frame; Stop closes the session/window, and a user window close invokes Stop
  for the exact release and started revision without double-stopping an explicit
  lifecycle close. Restart reopens the retained conversation from the same
  runtime-instance database.
- Transcript is the intentional full visible-content read surface. Operational read models, activity, capability summaries, cancel/retry results, diagnostics, and errors stay content-safe.
- Desktop and server hosts may expose only capabilities they actually compose. Cancel, retry, and streaming remain unsupported/deferred unless an application/runtime path genuinely supports them.
- Systems Run & Test uses the shared desktop/thin presenter, real execution-plan
  identity, application-projected actions, bounded accessible transcript
  rendering, and truthful host capability states.

## Conversational Source Invariant

- Preserve asset-kernel, `system.foundation`, user-library importability, asset-authoring overrides, effective projections, composition planning, runtime readiness, and execution-plan preparation while implementing conversational execution work.
- Conversational starter-system/run-surface changes must include asset/foundation/composition packs, not only execution packs.
- Runtime conversation/execution records are not reusable assets; reusable conversational assets must remain importable/customizable and lineage-linked to foundation primitives.

## Current Adapter Status

Application-facing conversational invocation seams exist for protected context preparation, adapter catalog selection, runtime guard checks, single-turn orchestration, and the supported Python text-generation runtime adapter path. Approval/session eligibility, reviewed execution-plan identity, runtime readiness, and asset-derived source boundaries remain mandatory prerequisites.

The protected context request carries the approved execution-plan, composition-plan, readiness-binding, approval, session, workspace, and runtime-reference associations. Conversation-session approval validity is checked before catalog selection; runtime guard evaluation precedes context materialization; exact-shape and association validation precedes invocation. Materialized instructions, turn text, history, generation settings, and adapter request/response details remain transient and must not be copied into ordinary operational records or diagnostics.

- The first user-facing Systems **Run & Test** surface for composed
  conversational systems uses the same safe desktop/thin-client conversation
  clients and preserves approval/readiness/execution-plan boundaries.
- `reference.controlled-chatbot@1.0.0` is a closed Asset Kernel composition;
  release approval does not activate it or bypass reviewed plan, readiness, and
  session approval requirements. It contains one typed persisted-only
  composer/history interaction, no example transcript, and no default model.
- No fake response generator is allowed in production host composition. Hosts may expose only capabilities they actually compose; cancel, retry, and streaming stay unsupported unless implemented end to end.
- The Python adapter resolves the approved model record to one runtime model id.
  A cold first turn validates and loads only that complete host-cached snapshot;
  it does not require a previous feature to have loaded the model and never
  downloads during conversation execution. The adapter and worker share the
  bounded short-task deadline, while failures remain path- and payload-free.
- A selected LoRA adapter also requires its exact same-workspace full base-model
  record. The worker receives only both model ids and an optional opaque
  generated revision, validates local containment and the adapter-declared base
  association, and attaches the exact adapter with PEFT. Ambiguous, missing, or
  mismatched associations block before generation; warm reuse matches revision.
