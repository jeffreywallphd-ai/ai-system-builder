# Context Pack: Runtime Readiness Binding

- Pack name: `runtime-readiness-binding`

## Purpose

- Route prompts that define or implement runtime readiness binding behavior.
- Keep readiness capability/binding work non-executing and composition-plan dependent.

## Use When

- Runtime readiness checks over validated composition plans.
- Runtime capability inventory, requirements, provider availability, model/storage/service availability.
- Binding candidates, capability gaps, blockers, diagnostics, and execution-plan output metadata.

## Canonical docs/files to inspect

- `docs/architecture/runtime-readiness-binding.md`
- `docs/adr/ADR-0021-runtime-readiness-binding.md`
- `docs/architecture/asset-composition-planning.md`
- `docs/adr/ADR-0020-asset-composition-planning.md`
- `docs/architecture/effective-asset-projections.md`
- `docs/adr/ADR-0019-effective-asset-projections.md`
- Runtime/adapter architecture docs and safe runtime adapter seams when present.

## Core constraints

- Runtime readiness binding is non-executing readiness only.
- Depend on validated asset composition plans.
- Use safe runtime inventory abstractions only.
- Surface explicit blockers/diagnostics for missing, unavailable, unsupported, stale, invalid, or unvalidated requirements.
- Do not expose secrets/tokens/raw env/raw paths/bytes/base64/provider payloads/signed URLs.

## Anti-drift rules

- Never label runtime readiness as executable/ready-to-run/running/completed.
- Never bypass validated composition plan requirements.
- Never invoke providers/models/runtimes in readiness checks.
- Never install dependencies or download models in readiness checks.
- Keep readiness status/blocker vocabulary stable and conservative.

## Relationship to Planning Inputs and Runtime Adapters

- Runtime readiness primarily consumes validated composition plan outputs.
- Effective projection summaries are secondary freshness context only when surfaced safely by composition read models.
- Runtime adapters/hosts provide safe inventory summaries through application seams; no execution methods are called.

## Transport Status

- API, IPC, preload, and client transport exposure is intended to remain thin and workspace-explicit.
- Operation families should be semantically aligned across API/IPC/preload/desktop-client/thin-client surfaces.
- Deferred or unavailable operations must be represented consistently and safely.
- Visible runtime setup/readiness UI is implemented inside Assets / Plans, with no separate top-level Runtime Readiness page.
- Runtime/provider/workflow/model execution remains out of scope for readiness transport exposure.

## Non-goals

- Workflow/runtime/model/ComfyUI execution.
- Provider invocation.
- Runtime installation, model download, credential creation, secret storage.
- Shell commands, environment mutation, workflow JSON generation, executable payload generation.
- Pack import/export, marketplace, collaboration permissions, live cross-workspace sync.

## Execution Plan Output

Runtime readiness binding outputs readiness-binding metadata for execution plan preparation/materialization planning. Execution remains deferred unless a later canonical execution boundary explicitly enables it.
