# Prompt Routing

Use this guide to select **minimum-sufficient** context packs. Start with `index.pack.md`, then add only packs that materially affect the requested work.

## Baseline

- Always include `docs/context/packs/index.pack.md`.
- Read `docs/README.md` before assembling task context.
- Use `docs/context/pack-catalog.json` for machine-readable task/path signals and applicable checks.
- Default to no more than two additional packs: one primary concern and one adjacent boundary.
- Add another pack only after repository search proves that boundary is materially affected; for broad work, stage context and implementation by boundary instead of preloading everything.
- Packs are routing aids and compact summaries; canonical ADRs, architecture docs, and standards win on conflict.
- Before editing, apply `docs/standards/security-by-design-standards.md` and record `not-security-relevant` with a concrete rationale or `security-relevant` with the affected assets, trust boundaries, abuse/failure cases, controls, and evidence. This screen does not count against the additional-pack limit.

## Pack Selection Table

| If the task materially involves...                                                                                         | Add this pack                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| repository layout, package placement, dependency direction                                                                 | `docs/context/packs/repository-overview.pack.md`                                                                     |
| cross-layer architecture or boundary decisions                                                                             | `docs/context/packs/architecture.pack.md`                                                                            |
| Asset Kernel vocabulary, Asset Registry/Library, system packs, resource-backed asset views                                 | `docs/context/packs/asset-kernel.pack.md`                                                                            |
| user library, promote/link/copy/import reuse, cross-workspace provenance/propagation                                       | `docs/context/packs/user-library.pack.md`                                                                            |
| custom asset creation, authored drafts, revisions, overrides, layered definition/source customization, promotion readiness | `docs/context/packs/asset-authoring.pack.md`                                                                         |
| effective/materialized projections, projection readiness, blockers, diagnostics                                            | `docs/context/packs/effective-asset-projections.pack.md`                                                             |
| asset composition plans, compatibility, dependencies, planning blockers                                                    | `docs/context/packs/asset-composition-planning.pack.md`                                                              |
| composed systems, System Builder records, Systems navigation, software-status placement                                    | `docs/context/packs/system-builder.pack.md`                                                                          |
| runtime readiness, capability matching, runtime resources, execution-output readiness                                      | `docs/context/packs/runtime-readiness-binding.pack.md`                                                               |
| execution plans, dry-run/preflight, planned steps/inputs/outputs, safety gates                                             | `docs/context/packs/execution-plan-preparation.pack.md`                                                              |
| conversational runnable systems, sessions, turns, runs, text-generation adapters                                           | `docs/context/packs/controlled-conversational-system-execution.pack.md`                                              |
| runtime adapters, runtime contracts, runtime execution flow                                                                | `docs/context/packs/runtime.pack.md`                                                                                 |
| runtime task registry lifecycle, progress, cancellation, retention                                                         | `docs/context/packs/runtime-task-registry.pack.md`                                                                   |
| runtime installers, auto-install, install state, ComfyUI/Git installs                                                      | `docs/context/packs/runtime-installer.pack.md`                                                                       |
| image generation, ComfyUI sidecar, image assets/generated outputs                                                          | `docs/context/packs/image-generation.pack.md`                                                                        |
| Electron host lifecycle, IPC/preload boundaries, desktop composition                                                       | `docs/context/packs/desktop-host.pack.md`                                                                            |
| Electron IPC contracts, operation-derived channels, preload invoke boundaries                                              | `docs/context/packs/ipc-electron.pack.md`                                                                            |
| renderer feature/page/component work, renderer clients, UI state                                                           | `docs/context/packs/desktop-implementation.pack.md`                                                                  |
| renderer CSS/style architecture, shared style layers, tokens                                                               | `docs/context/packs/desktop-styling.pack.md`                                                                         |
| server lifecycle, Express APIs, thin-client coupling, API route handlers                                                   | `docs/context/packs/server-host.pack.md`                                                                             |
| persistence/storage, artifacts/uploads, storage keys, AppData/server roots, model/artifact storage                         | `docs/context/packs/persistence-storage.pack.md`                                                                     |
| authn/authz, OIDC, organization tenancy/placement, route policy, HTTPS/TLS, tokens, credentials, audit, sanitization, public API/IPC, uploads, untrusted parsing, outbound network, executable inputs, sensitive data, AI context, or supply-chain boundaries | `docs/context/packs/security.pack.md` + the single owning host/runtime/storage/feature pack; add persistence-storage when data isolation changes |
| structured logging, diagnostic events, verbosity, safe failure reporting                                                   | `docs/context/packs/logging.pack.md`                                                                                 |
| documentation governance, agent change planning, decision readiness, change impact, canonical-vs-context updates           | `docs/context/packs/docs-standards.pack.md`                                                                          |
| test strategy, regression coverage, test placement                                                                         | `docs/context/packs/testing.pack.md`                                                                                 |
| debugging, failures, stack traces, hangs, timeouts, broken UI/API/runtime behavior                                         | `docs/context/packs/debugging-error-handling.pack.md`                                                                |

## Common Pack Chains

- Debugging: `index` + `debugging-error-handling` + the single pack owning the first failing seam.
- Image generation defect: `index` + `image-generation`; add only one of `runtime`, `runtime-task-registry`, `runtime-installer`, `persistence-storage`, or the affected host after localization.
- Asset Library/Registry: `index` + `asset-kernel` + the affected UI, transport/host, persistence, or security pack.
- Workspace-scoped persistence: `index` + the owning feature pack + `persistence-storage`; load security or a host pack only when that boundary also changes.
- User Library: `index` + `user-library` + either `asset-kernel` for semantics or `persistence-storage` for repository behavior.
- Asset authoring: `index` + `asset-authoring` + either `asset-kernel`,
  `user-library`, `effective-asset-projections`, or `security` based on the
  adjacent behavior; use `security` for Asset Studio source overlays or
  materialization.
- Projection/composition/readiness/planning: select the one owning layer plus one immediate neighbor; move forward through the chain in separate reasoning stages.
- System Builder: `index` + `system-builder`; add `asset-kernel` or `asset-composition-planning` for data semantics, or `desktop-implementation` for Systems/Settings UI placement.
- Controlled conversational execution: `index` + `controlled-conversational-system-execution`; add the execution-plan or runtime pack only when that exact boundary changes.
- Security: `index` + `security` + the one public host/client/feature boundary being changed.
- Implicit security boundary: when an otherwise ordinary feature changes authority, isolation, public payloads, untrusted input, storage, runtime/provider I/O, diagnostics, dependencies, migration, or rollback, route it as `index` + `security` + the owning boundary pack even if the request never says “security.”
- Desktop renderer styling: `index` + `desktop-styling` + `desktop-implementation`.

## Canonical Escalation Rules

Read and update canonical docs when the task:

- changes architecture, repository structure, standards, or documented behavior,
- changes dependency direction, host/transport/runtime responsibility, persistence/storage responsibility, security policy, or workspace scope,
- changes Asset Kernel semantics, pack/source semantics, mutation behavior, resolver behavior, or public transport/UI exposure,
- changes a trust boundary, authority decision, sensitive data flow, executable input, dependency/release input, safe diagnostic, migration, recovery, or rollback posture,
- exposes a context-pack summary that is incomplete, stale, or ambiguous.

Before architecture-sensitive implementation, consult `docs/adr/decision-readiness.md`. Proposed or decision-required areas must return to decision work instead of being implemented from inference.

## Boundary Split Rules

- Do not combine API/server-host, IPC/preload/desktop-host, and desktop/thin-client parity implementation into one prompt unless the user explicitly asks for a cross-boundary implementation.
- Do not add host/API/IPC/UI exposure while working on contracts/application services unless the prompt explicitly includes that surface.
- Do not include runtime/provider/storage packs for read-only UI tasks unless those boundaries are directly touched.
- Do not include all phase packs for asset work; include the narrow chain that matches the task.

## Stop Condition

- If required canonical guidance is missing, unclear, or conflicting, update or request clarification for the canonical docs rather than inventing policy silently.
- If the security impact cannot be dispositioned, or a material identity, tenancy, secret, sandbox, public exposure, encryption, retention, audit, or residual-risk choice is unresolved, stop at the decision gate rather than assuming a permissive policy.
