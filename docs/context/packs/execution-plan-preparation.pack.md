# Context Pack: Execution Plan Preparation

- Pack name: `execution-plan-preparation`
- Scope: execution plan preparation architecture and related doc work.

## Purpose

Define and protect the non-executing execution-plan-preparation layer that turns runtime-readiness-backed composition context into safe execution plan candidates/previews shown inside Assets / Plans / Setup.

## Use When

Include this pack when tasks materially involve:

- execution plan preparation,
- execution plan candidates/previews,
- planned steps/dependencies,
- planned inputs/outputs,
- safety gates/preflight/dry-run planning,
- execution blockers/diagnostics,
- controlled execution output boundaries.

## Canonical docs/files to inspect

- `docs/architecture/execution-plan-preparation.md`
- `docs/adr/ADR-0022-execution-plan-preparation.md`
- `docs/context/packs/runtime-readiness-binding.pack.md` (when readiness binding dependencies are involved)
- `docs/context/packs/asset-composition-planning.pack.md` (when source composition references are involved)
- `docs/context/packs/effective-asset-projections.pack.md` (when projection freshness/staleness affects planning)

## Core constraints

- Planning layer only; no execution.
- Workspace-scoped ownership.
- Depend on safe runtime readiness binding metadata.
- Use safe adapter/provider references only (no raw credentials/env/paths/payloads).
- Produce inspectable, conservative status/blocker/diagnostic outputs.

## Anti-drift rules

- Do not label execution plan preparation as runnable/executed/completed.
- Keep `ready-for-review` explicitly non-executing.
- Keep preflight/dry-run semantics metadata-only.
- Do not add provider/runtime invocation behavior to execution plan docs/contracts unless canonical execution boundaries change.
- Keep plan records sanitized (no commands, workflow execution JSON, provider payloads, secrets, raw paths, base64/blobs, signed URLs).

## Relationship to Planning Inputs and Runtime Adapters

- Effective projections: do not reconstruct projection internals.
- Asset composition planning: composition plan is an upstream reference surface.
- Runtime readiness binding: readiness binding is the required prerequisite seam.
- Runtime adapters: referenced by safe adapter identity only; invocation remains outside execution plan preparation.

## Non-goals

No runtime/provider/workflow/model execution, no executable payload generation, no dependency install/model download, no credential/secret creation/storage, no shell/env mutation, no job lifecycle/progress/cancellation/runtime logs, no pack import/export, no marketplace/collaboration/live sync, no source-record mutation.

## Controlled Execution Output Boundary

Execution plan preparation exposes prepared execution plan metadata to controlled execution orchestration and runtime/provider invocation boundaries.

## Conversational Execution Routing

When tasks derive runnable conversational execution behavior from execution plans, include this pack **and** `docs/context/packs/controlled-conversational-system-execution.pack.md`.

Execution plan preparation remains non-executing; `ready-for-review` does not invoke runtime behavior.

Conversational runs must come from asset-derived conversational system composition (reusable/foundation-referenced), not runtime-record-only constructs.
