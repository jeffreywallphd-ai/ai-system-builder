# ADR-0023: Controlled Conversational System Execution

- Status: accepted
- Date: 2026-05-22

## Context

Execution plan preparation established a non-executing preview layer. The next runnable composed-system slice is conversational execution (chat-style interaction), chosen as the first proof while preserving general runnable-system architecture and avoiding a chat-only domain model.

## Decision

1. Controlled conversational execution uses a user-configured conversational system as the first runnable-system proof.
2. Controlled conversational execution preserves the general composed-system execution architecture and keeps chatbot execution as one slice, not the universal model.
3. Execution plan preparation remains non-executing; `ready-for-review` is not invocation.
4. Controlled conversational execution requires explicit approval before runtime invocation.
5. Controlled conversational execution models conversation sessions, turns, execution runs, attempts, events, and results as separate concepts.
6. Default mapping is one assistant-generating turn to one controlled execution run lifecycle, with one or more attempts.
7. The first supported adapter path is text-generation oriented through the Python conversational runtime adapter; ComfyUI/image-generation is deferred to a later slice.
8. Tools, retrieval, memory, multimodal behavior, and arbitrary workflow execution are deferred.
9. Transport exposure should be split across API/server-host, IPC/preload/desktop-host, and desktop/thin-client wrapper parity work.
10. A published visual release may use explicit lifecycle **Start** as its
    session-scoped interaction approval only after the application revalidates
    the exact immutable release, model revision, runtime instance, deployment,
    readiness, and host capability. Renderer or preload input is association
    context only and cannot grant that authority.

## Decision summary

Controlled conversational execution introduces controlled execution orchestration for the first runnable composed-system vertical slice: a user-configured conversational AI system. Reviewed execution plans may lead to explicitly approved conversation sessions whose turns invoke supported text-generation capabilities through a narrow runtime adapter boundary. Conversation, run, attempt, result, progress, cancellation, retry, and provenance concepts are modeled separately so the chatbot slice proves general runnable-system architecture rather than defining all future systems as chat applications.

## Consequences

- Enables the first end-to-end runnable experience while preserving prior composition/readiness/planning boundaries.
- Creates explicit approval/lifecycle boundaries for safe invocation.
- Establishes status vocabulary and lifecycle auditing foundations for later runtime slices.
- Requires careful message-content privacy/persistence boundary decisions.

## Explicit non-goals

This decision does not authorize raw provider payload exposure, local model loading outside runtime adapters, a universal chat-first domain model, streaming, cancellation/retry runtime behavior unless application/runtime support exists, tools/retrieval/memory/multimodal behavior, workflow execution, ComfyUI/image-generation execution, or mutation of upstream effective projection, composition planning, runtime readiness, or execution plan records.

## Relationship to execution plan preparation

Controlled conversational execution depends on reviewed execution plans and related readiness/composition references, but does not mutate execution-plan records to represent execution progress. Progress belongs to controlled conversational execution session/turn/run records.

## Implemented adapter decision

The accepted first adapter implementation is the Python conversational text-generation path. Host composition supplies a conversational adapter catalog, runtime guard, and invocation port to the shared conversation execution services. The runtime guard requires the Python sidecar to be healthy and to expose the conversational text-generation capability; turn submission remains blocked by approval, source, readiness, runtime, and host-capability checks before invocation.

The adapter records no progress or cancellation support in its catalog entry. Cancel, retry, and streaming behavior remain unsupported unless a later application/runtime path can actually perform them.

The controlled chatbot uses an application-authorized, release-bound model
record rather than a default or caller-supplied model string. The exact model
revision digest and typed persisted-history interaction are immutable build-lock
evidence. Activation, start, and invocation re-resolve the workspace model and
fail closed on missing, stale, incompatible, or cross-workspace state. Only the
adapter-owned runtime model identifier crosses to the Python worker; provider
details, credentials, and paths do not enter renderer or diagnostic contracts.

## Published desktop interaction

Desktop published interaction runs in a dedicated sandboxed Electron window,
not the builder preview or an in-page modal. Its preload is limited to bounded
transcript reads and message submission; main binds the exact live main frame to
one application-owned lifecycle session. Stop ends that session and closes the
window while retaining the transcript in the runtime instance's isolated data
plane. Restart must revalidate authority and reopen the retained conversation.

## Later runnable-system slice implications

The controlled conversational orchestration model must later support additional system types such as image generation, data transformation, document QA, retrieval-augmented systems, tool-using assistants, API-connected systems, multimodal interaction, and potential scheduled/distributed execution.

## Asset-first decisions

1. The first runnable proof is **reusable conversational asset-family composition + controlled execution**, not a hard-coded chatbot feature.
2. Conversational assets must compose from referenced `system.foundation` primitives where applicable.
3. `system.foundation` remains limited to generic primitives; chatbot-specific composites are derived reusable assets or explicitly distinguished in the shipped built-in mechanism.
4. Foundation usage preserves reference/lineage semantics and must not duplicate foundation records into workspace authored storage merely through import/use.
5. A starter conversational composite/template must be importable into other compositions.
6. Imported conversational assets must remain customizable through existing asset authoring/override/effective-projection mechanisms.
7. Conversation/execution records are runtime operational records and are not importable reusable assets.
8. Contract/persistence work for runtime records remains valid only as runtime-record support for systems built through the reusable asset layer.

## Asset-first acceptance details

- The asset-first proof is part of the accepted architecture, not a temporary note.
- Foundation composition and no-copy semantics are required architecture constraints.
- The starter conversational system must be importable/customizable through existing asset authoring/override/effective-projection behavior.
- Runtime records are operational and are not reusable asset definitions.
- Later execution use cases must originate from execution plans derived from composed conversational assets.

## Protected invocation boundary

The application orchestration boundary requires an approved asset-derived source association that binds workspace, session, reviewed execution plan, composition plan, readiness binding, execution approval, and runtime reference. Conversation-session approval validity runs before adapter selection; runtime guard checks run before protected context preparation; exact-shape and source/runtime association validation runs before invocation.

Materialized instruction, message/history, and supported generation-setting content is transient application memory. It is not an execution-run metadata format, an approval/provenance/diagnostic payload, or a provider request/response persistence contract. Adapter discovery and guard failures are reduced to safe application statuses, and provider-specific configuration remains adapter-owned.
