# Prompt Routing

Use this guide to select **minimum-sufficient** context packs for prompts.

## Baseline (Always Include)

- `docs/context/packs/index.pack.md` is the authoritative baseline pack.
- Include it in all automated prompt assembly.

## Add Packs by Task Concern

| If the task materially involves... | Add this pack |
| --- | --- |
| repo layout, module placement, dependency direction at a repo level | `docs/context/packs/repository-overview.pack.md` |
| cross-layer architecture or boundary decisions | `docs/context/packs/architecture.pack.md` |
| runtime adapters, runtime contract shape, runtime execution flow | `docs/context/packs/runtime.pack.md` |
| Electron/desktop host lifecycle, IPC/preload boundaries, desktop composition | `docs/context/packs/desktop-host.pack.md` |
| desktop renderer structure, page/feature/component boundaries, renderer API-client usage | `docs/context/packs/desktop-implementation.pack.md` |
| desktop renderer CSS/style architecture, shared style layering, token-first styling decisions | `docs/context/packs/desktop-styling.pack.md` |
| server host lifecycle, Express transport boundaries, thin web client coupling | `docs/context/packs/server-host.pack.md` |
| persistence vs storage responsibilities, ingestion/staged-artifact semantics for uploads/scrape/generated intake paths, artifact browser/read/view contracts (list/detail/content separation), shared storage foundation contracts (`StorageKind`, `StorageProviderId`, `StorageBackingReference`), artifact-object storage contracts, artifact-repo storage contracts/provider concerns (including Hugging Face dataset/model repo integration direction), AppData/server roots, metadata-vs-file boundaries | `docs/context/packs/persistence-storage.pack.md` |
| documentation updates, canonical-vs-context discipline, doc governance | `docs/context/packs/docs-standards.pack.md` |
| structured logging behavior, diagnosability, log field/level discipline | `docs/context/packs/logging.pack.md` |
| test strategy, regression coverage, layered testing expectations | `docs/context/packs/testing.pack.md` |

## Selection Rules

- Start with `index.pack.md`, then add only packs materially relevant to the task.
- Do not include packs “just in case.”
- Select packs based on the task’s actual architectural and implementation concerns.
- Pack inclusion does not remove the requirement to read/update canonical docs when task scope requires it.

## Escalate to Canonical Docs When

- The task changes architecture, repository structure, standards, or documented behavior.
- The task changes boundaries, dependency direction, host/transport/runtime responsibilities, or persistence/storage responsibilities.
- The task creates or changes canonical rules; update canonical docs in the same work item.
- A pack summary appears incomplete or ambiguous for the requested change.

Packs are summaries and routing aids, not substitutes for canonical sources.

## Stop Condition

- If required canonical guidance is missing, unclear, or conflicting, do not invent policy silently; treat the task as requiring canonical clarification/update in the same work item.
