# Context Pack: Architecture

- Pack name: `architecture`

## Purpose

- Provide a compact, high-signal summary of repository architectural rules and boundary discipline.

## Use When

- Designing or modifying cross-layer behavior.
- Creating/moving modules where dependency direction matters.
- Reviewing architecture-sensitive refactors.

## Do Not Use When

- Narrow content-only doc edits with no architecture impact.
- Small local changes that do not cross boundaries.

## Core Guidance

- Maintain clean architecture direction: inner layers (domain/application) must not depend on outer infrastructure/host/UI layers.
- Treat `modules/application/ports` as required application seams between orchestration and adapters.
- Keep contracts explicit at boundaries; avoid embedding boundary semantics in ad hoc types.
- Prefer `modules/contracts/<family>` imports and avoid deep contract file paths so family boundaries remain the public extension surface.
- Keep non-contract modules off root `modules/contracts` imports; consume contract APIs through explicit family barrels.
- Keep application ports thin, role-revealing, and contract-family aligned; avoid generic service-dump ports.
- Treat API and IPC contract families as true transport specializations: compose from shared transport semantics and add only narrow transport-specific fields.
- Keep operation identity consistent across transport/runtime/persistence via shared helper patterns (lowercase dotted operation names).
- Keep operation identity transport-neutral; avoid embedding transport namespace into operation names.
- Keep IPC channels derived from operation identity (`ipc.<operation>.<kind>`) so channel and operation cannot drift independently.
- Use `modules/contracts/host` for thin host-aware context metadata instead of
  passing framework-native objects inward.
- Keep host contracts intentionally small and framework-free; keep config contracts typed and concern-specific.
- Treat hosts (desktop/server) and transport (IPC/HTTP) as separate concerns.
- Preserve shared-first UI: reusable components in shared UI, thin platform-specific layers.
- Follow TypeScript-first runtime posture; external runtimes are adapter extensions, not architecture centers.
- Keep persistence (structured durable records) distinct from storage (artifact/file/blob concerns).
- Model inbound content with ingestion/staged-artifact semantics above storage mechanics so upload/scrape/generated intake paths do not fork parallel vocabularies.
- Prefer disciplined simplicity: avoid premature frameworks, plugin systems, and package explosion.

## Key Constraints

- Business logic belongs in domain/application, not route handlers, IPC handlers, or host bootstrap code.
- Transport/framework specifics must stay in adapters.
- Application code should depend on ports/contracts and must not import concrete adapters directly.
- Before changing boundaries, dependency rules, cross-layer responsibilities, or architectural ownership, read the referenced canonical architecture docs and ADRs directly.
- This pack supports implementation, but does not replace canonical architectural guidance.
- Changes to architectural boundaries require canonical doc updates and often ADR updates.

## Canonical Source Docs

- `docs/architecture/README.md` — architecture document usage model and review heuristics.
- `docs/architecture/system-overview.md` — overall system shape and boundary intent.
- `docs/architecture/module-dependency-rules.md` — explicit allowed/disallowed dependencies.
- `docs/architecture/runtime-model.md` — runtime boundary model.
- `docs/architecture/host-model.md` — host responsibilities and staging posture.
- `docs/architecture/persistence-and-storage.md` — persistence/storage separation model.
- `docs/adr/ADR-0002-typescript-first-runtime-model.md` — TypeScript-first decision.
- `docs/adr/ADR-0003-host-model-and-transport-separation.md` — host vs transport decision.
- `docs/adr/ADR-0004-persistence-and-storage-separation.md` — persistence/storage decision.
- `docs/adr/ADR-0008-ingestion-and-staged-artifact-semantic-model.md` — ingestion/staged-artifact semantic direction.

## Common Over-Inclusions to Avoid

- Pulling host-specific pack content when no host concerns are touched.
- Repeating entire architecture docs in prompts instead of referencing them.
- Adding speculative future hybrid/plugin design constraints not yet decided.

## Prompt Assembly Notes

- Typical set: `index` → `repository-overview` (optional) → `architecture`.
- Add one specialized pack (`runtime`, `desktop-host`, `server-host`, `logging`, `testing`, `persistence-storage`) based on concrete task scope.
