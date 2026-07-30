# System Overview

- Status: current
- Related decisions: `docs/adr/ADR-0001-repository-structure.md`, `docs/adr/ADR-0003-host-model-and-transport-separation.md`, `docs/adr/ADR-0004-persistence-and-storage-separation.md`, `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md`, `docs/adr/ADR-0016-asset-kernel-terminology-and-architecture-baseline.md`, `docs/adr/ADR-0023-controlled-conversational-system-execution.md`, `docs/adr/ADR-0025-deployment-shaped-structured-persistence.md`
- Verification: `docs/architecture/architecture-verification.md`

- effective asset projections baseline: `docs/architecture/effective-asset-projections.md` defines workspace-scoped safe materialized/effective asset projections for planning-readiness (non-executing).

## Purpose of this repository

`ai-system-builder` is a fresh rebuild intended to replace earlier architectural sprawl with a simpler and more disciplined structure.

The goal is to support AI system building workflows with:

- clear separation of business logic from infrastructure,
- host flexibility (desktop first, server and hybrid later),
- explicit contracts at boundaries,
- and documentation strong enough to guide ongoing implementation.

## Repository shape

The repository is organized into apps, modules, and supporting folders:

```text
ai-system-builder/
├─ apps/
│  ├─ desktop/
│  ├─ server/
│  └─ thin-client/
├─ modules/
│  ├─ domain/
│  ├─ application/
│  ├─ contracts/
│  ├─ adapters/
│  │  ├─ persistence/
│  │  ├─ runtime/
│  │  ├─ transport/
│  │  ├─ storage/
│  │  ├─ observability/
│  │  └─ auth/
│  ├─ hosts/
│  │  ├─ desktop/
│  │  └─ server/
│  ├─ ui/
│  │  ├─ shared/
│  │  ├─ desktop/
│  │  └─ web/
│  └─ testing/
├─ docs/
├─ dev-tools/
├─ config/
├─ migrations/
└─ ...
```

## App package and run/build model

App packaging is intentionally mixed but explicit:

- `apps/desktop` remains root-driven through Electron Forge (desktop host bootstrap and packaging are managed from root scripts).
- `apps/server` and `apps/thin-client` are npm workspace packages with their own app-local scripts.
- Root scripts remain the canonical convenience surface (`dev:desktop`, `dev:server`, `dev:thin-client`, `build:server`, `build:thin-client`, `start:server`).

This keeps desktop workflow stable while making thin-client/server dependency install and script execution repeatable through one workspace install.

## High-level layers and boundaries

### Asset Kernel

The Asset Kernel is a central platform concept for user-composable systems. It defines assets as versioned, configurable, AI-readable, machine-composable building blocks that can represent structure, behavior, interface, data, instructions, resources, compositions, or logic containers, and can be assembled into features, systems, subsystems, and systems composed of subsystems. Canonical terminology and Asset Kernel contract baseline sequencing live in `docs/architecture/asset-kernel.md`; ADR-0016 refines the directional asset concept from ADR-0005.

The Asset Kernel does not rename or replace existing artifact, resource, runtime, host, or storage concepts. Resource-backed assets reference artifact/resource storage, asset runtime requirements reference shared runtime capability IDs, and transport/UI-specific asset models are not allowed. Current Asset Kernel contracts, application services, persistence adapters, read facades, resource-backed views, controlled mutations, pack semantics, and workspace scope are defined in `docs/architecture/asset-kernel.md`.

Current system foundation pack baseline Asset Kernel work adds pack-compatible system defaults without changing those boundaries. Asset authoring/customization and the accepted layered-derived customization boundary are documented in `docs/architecture/asset-authoring-customization-and-overrides.md`, ADR-0018, and ADR-0035. `system.foundation` is the canonical versioned, system-trusted default pack; its entries are full semantic `AssetDefinition` records, not renderer components or loose hardcoded built-ins, and foundation records are read as system defaults/built-ins only when trusted source metadata or installer-managed markers prove that ownership. A source label alone does not make user/custom/imported assets system defaults. System pack install/seeding is explicit/internal/idempotent and not host-startup behavior; user/custom same-ID/version conflicts fail install without overwrite. The basic resolver is pure and non-destructive; its full result is internal and must not be exposed directly through public API/IPC/preload/UI without read-model sanitization. Manifest serialization/fingerprinting is pure in-memory readiness for future import/export, but fingerprinting is not validation or import approval. Asset Library pack/source/category display remains read-only, and `workspace-pack` is distinct from workspace override unless override metadata exists. Public pack import/export/install/activation, override editing, marketplace/package registry, asset editor, visual composition/canvas authoring, workflow execution, runtime execution, and provider/network/storage side effects remain deferred.

### Core logic

- `modules/domain/`
  - Business/domain rules and invariants.
  - No dependency on transport, hosts, storage engines, framework details, or UI.
  - Current artifact domain slice is intentionally small and practical under
    `modules/domain/artifact/` (`ArtifactId`, `ArtifactBacking`, `Artifact`).

- `modules/application/`
  - Use-case orchestration, policies, ports, and DTO-level behavior.
  - Coordinates domain logic and boundary contracts.
  - Initial contract-backed ports are under `modules/application/ports` for
    runtime execution, persistence records, artifact storage, structured
    logging, and host context.
  - Application ports are a required boundary seam, not an optional convenience:
    - keep port families under `modules/application/ports/<family>/`,
    - keep port surfaces thin and role-revealing,
    - keep port requests/results aligned to contract families (not adapter-native shapes),
    - keep drift tests in `modules/application/ports/<family>/tests/` and cross-family seam checks in `modules/application/ports/tests/`.

- `modules/contracts/`
  - Explicit boundary contracts (API, IPC, runtime integration contracts, etc.).
  - Shared language for cross-module communication.
  - Import contracts through family-level entry points (`modules/contracts/<family>`) to keep boundaries explicit and refactor-safe.
  - Non-contract modules must not import from the root contracts entry (`modules/contracts`) or deep internal contract files.
  - Root-level contracts exports are namespace-only by family; do not rely on a flattened catch-all surface.
  - Includes shared result/error contracts so boundaries reuse one success/failure vocabulary.
  - Includes shared operation identity helpers so transport/runtime/persistence families use a consistent operation naming pattern.
  - Includes the initial asset contract family for core Asset Kernel identity, lifecycle, provenance, references, definitions, instances, minimal binding/composition shells, and validation issue shapes.
  - Includes typed configuration contracts for host, runtime, logging,
    persistence, and storage concerns.
  - Keeps `SystemConfig` as a shallow composition convenience only; concern-specific
    config families remain the source of typed rules and must not degrade into a
    generic settings bag.

### Configuration posture (current)

- Typed config contracts in `modules/contracts/config` are required for boundary-safe config shapes.
- Config loading and resolution are currently composition-root concerns (apps/hosts/adapters), not a required application port seam.
- Do not infer a required `modules/application/ports/config` seam unless architecture docs and code explicitly introduce it.

### Infrastructure and edges

- `modules/adapters/`
  - Concrete implementations of boundary concerns.
  - Includes persistence, runtime, transport, storage, observability, and auth adapters.
  - Infrastructure details belong here, not in domain/application.

- `modules/hosts/`
  - Host lifecycle and composition concerns.
  - Desktop host and server host composition stay distinct from transport mechanics.

- `modules/ui/`
  - Shared-first UI strategy:
    - reusable UI in `ui/shared/`,
    - thin platform-specific layers in `ui/desktop/` and `ui/web/`.

### App entry points

- `apps/desktop/`, `apps/server/`, `apps/thin-client/`
  - Entry points and packaging/deployment surfaces.
  - Not the home for core business logic.

## TypeScript-first posture

The native implementation path is Node.js with TypeScript.

- TypeScript is the dominant runtime for core architecture.
- Other runtimes (starting with Python) are adapter-driven extensions, not co-equal architecture centers.
- Runtime diversity is supported through contracts, not ad hoc coupling.

## Host model in practice

The architecture supports multiple host modes over time:

1. desktop-only,
2. server-only,
3. desktop-server hybrid.

Current implementation priority is **desktop-first**. Server and hybrid compatibility should be preserved by boundaries, but not forced through premature complexity.

## Transport role

Server/thin-client mode is also a remote execution authority for future resource-heavy work. Desktop-server hybrid direction should support per-feature execution placement, though implementation remains future work documented by ADR-0013.

Runtime roots and artifact storage roots are separate concerns and should remain independently configured per host.

Transport technologies are adapters, not application definitions.

- Express is the default server API transport adapter.
- Electron IPC is the desktop transport boundary.
- Desktop app implementation is intentionally split into Electron `main`, preload, renderer, and desktop host composition to keep lifecycle, bridge, UI, and wiring responsibilities separated.
- Desktop renderer should use small frontend-facing API clients/hooks rather than scattering direct raw preload global calls through UI components.
- API and IPC contracts are transport specializations that compose from shared transport request/response/error semantics.
- API contracts keep shared transport envelopes intact; HTTP-only fields (status, headers, framework request/response objects) remain adapter concerns.
- IPC contracts keep shared transport envelopes intact and add only operation-derived channel context.
- Transport operation identifiers follow the shared operation identity helper pattern (lowercase dotted segments) to reduce ad hoc naming drift.
- IPC channel identifiers must be derived from operation identity using `ipc.<operation>.<kind>` (`request`, `response`, `event`) to prevent channel/operation drift.
- Business rules must stay in domain/application layers, not in route handlers or IPC handlers.
- Desktop IPC remains the renderer boundary even when a feature executes remotely in the future.
- Desktop host composition may choose local adapters or configured-server remote client adapters behind IPC.
- See ADR-0013 for host-owned runtime execution and feature placement direction.

## Persistence and storage posture

- Persistence: structured durable records, targeting SQLite for local deployment
  and PostgreSQL for campus, corporate, and cloud server deployments. Desktop
  composition actively uses SQLite, and explicit managed server shapes actively
  use PostgreSQL after the fail-closed legacy import/cutover step.
- Storage adapters: a broad architectural category for non-relational durable/semi-durable content concerns with a thin shared foundation.
- Storage is family-oriented (not one flat abstraction): artifact-object storage and artifact-repo storage are peer first-class specialized families.
- Artifact-object storage centers on artifact keys, bytes, checksums, and artifact metadata.
- Repo-backed storage centers on provider/repo identity, revision/version semantics, remote visibility/access semantics, and provider-specific import/publication behavior.
- Shared storage foundation contracts keep family boundaries explicit: `StorageKind` (`artifact-object` | `artifact-repo`), `StorageProviderId`, thin `StorageBackingReference`, and `ArtifactStorageBinding` for internal-artifact linkage.
- Provider integrations should be composed as specialized artifact-repo adapters/providers, not flattened into a generic blob-only framing.
- Hugging Face is the first implemented artifact-repo provider adapter in this repository; treat it as one provider implementation, not as the family definition.
- Hugging Face repository browsing/import currently flows through provider-scoped contracts and use cases: namespace dataset browse, dataset file browse, and batch file import. Batch import owns repository/file orchestration in application/server/desktop host layers so UI clients do not coordinate one register request per file.
- Ingestion/staged artifact: canonical semantic model for inbound content (uploads, scrape outputs, selected generated outputs, and similar intake paths) above raw storage mechanics.

They are separate architectural concerns even if they share physical disk territory in some host deployments.

Image upload remains an implemented specialized intake path and should align to staged artifact descriptor semantics rather than defining a parallel semantic world.
The initial image vertical slice now includes both write and read direction:

- write/intake through artifact upload as specialized ingestion,
- read-side artifact browser behavior through image-backed `artifact.browse` (list metadata), `artifact.read` (detail metadata), and `artifact.content.read` (separate content retrieval).

Artifact browser posture:

- the artifact browser is the normalized system browser over internal artifacts across backing-store differences,
- it is not a filesystem browser,
- it is not equivalent to provider-native repository browsing surfaces.

## Packaging restraint

This repository intentionally avoids premature package explosion.

- A folder is not automatically a package.
- Package boundaries are introduced only when justified by independent build/dependency/isolation needs.
- Architecture boundaries are primary; package boundaries follow proven need.

## Contract drift safeguards

- Contract hardening is enforced by invariant tests in contract-family `tests` folders and by cross-family anti-drift tests under `modules/contracts/tests/`.
- These invariants protect transport specialization, operation/channel identity discipline, runtime-to-logging alignment, persistence-vs-storage separation, host/config boundary constraints, and public export/import discipline.
- Application-port hardening is enforced by family seam tests in `modules/application/ports/<family>/tests/` and minimal cross-family seam tests in `modules/application/ports/tests/`.

## Not yet finalized

The following are intentionally open and should not be over-specified yet:

- exact runtime execution protocols for external runtimes,
- final internal API/IPC schema conventions across all surfaces,
- concrete enforcement tooling (for example, lint rules) for every dependency rule.

Until formalized, contributors should follow the boundaries in this architecture set and document significant decisions in ADRs.

### Server-host artifact-repo slice (current)

Server composition now wires both storage families as peers:

- local filesystem artifact-object storage for upload/catalog/browser flows, and
- artifact-repo aggregate storage with Hugging Face as first provider adapter.

A minimal artifact-repo API slice is exposed (`artifact-repo.has`, `artifact-repo.store`, `artifact.publish`, `artifact.publish.verify`) through dedicated application use cases.

Thin-client artifact-browser publish flow should call `artifact.publish` as the primary orchestration route (artifact bytes -> provider store -> verify -> published binding write), while follow-up verification should call `artifact.publish.verify` (remote existence re-check without republish).

### Desktop-host artifact-repo slice (current)

Desktop composition now mirrors the same publish orchestration path used by server/thin-client:

- local filesystem artifact-object storage for upload/catalog/browser flows,
- artifact-repo aggregate storage with Hugging Face as first provider adapter,
- shared publish/verify use cases wired through Electron IPC and preload bridge (`artifact.publish`, `artifact.publish.verify`).

Desktop renderer artifact-browser publish/re-check UX should call the preload-backed bridge and shared hook logic, not raw IPC and not desktop-only business logic.

### Artifact repo registration slice (current)

- In addition to publish/re-check, the system now supports first-slice remote registration (`artifact.register.from-repo`) through shared application use-case wiring.
- Registration verifies remote existence and creates an internal catalog + `imported-source` binding so the artifact browser can treat the remote artifact as an internal artifact record.
- New registration writes now use system-owned internal artifact ids; provider/repository/path/revision remain backing metadata (not canonical artifact identity).
- Artifact id generation policy is now behind a small system-owned seam (`SystemArtifactIdFactory`) used by composition/use cases; `ArtifactId` remains the value object.
- This is a narrow registration/import slice; it is not a full provider repo browser or sync engine.

### Artifact import usefulness step (current)

- Imported artifacts without local bytes now support explicit localization (`artifact.localize.from-repo`) through shared application logic.
- Localization keeps artifact browser central: select artifact -> inspect imported-source backing + local availability -> localize/download when needed.
- Imported-source backing verification can be re-checked explicitly (`artifact.source.verify`) without changing artifact identity or collapsing source/published concepts.
- Artifact browser list/detail now surfaces minimal backing-state cues (`Remote only`, `Localized`, `Published`) while keeping artifacts as the core entity.
- This is an incremental usefulness step for the current image-focused slice, not full remote sync or provider-native browsing parity.

## Security architecture posture

Security is cross-cutting and layered rather than a monolithic module. HTTPS +
LAN pairing bearer tokens remain an implemented private-LAN mode. Managed
production uses OIDC plus explicit organization selection, active membership,
pooled organization isolation by default, and premium one-organization placement
over the same release. Transport security remains adapter-based and swappable,
while authorization policy is shared and enforced at transport,
application/resource, persistence, and storage boundaries. ADR-0015 and ADR-0029
are the canonical security and tenancy references.

## Workspace Model

The workspace model includes `modules/contracts/workspace` vocabulary for workspace identity, lifecycle status, future actor/member role metadata, storage-root descriptors, system-pack activation references, workspace records, creation commands, active-selection read models, and explicit workspace request context. Application repository ports, local file-backed persistence adapters, and workspace use cases support workspace creation, selection, activation-reference persistence, and safe diagnostics.

Workspace system-pack activation records reference system packs such as `system.foundation@1.0.0` by pack id/version only. They do not install, copy, embed, or mutate system pack definitions.

### Workspace-gated product surfaces

Workspace-scoped UI surfaces are unavailable without an active workspace. Systems, asset, artifact/data, model, image-generation, generated-output, and other workspace-owned pages must show a workspace-required call to action rather than empty global records when no workspace is active. Global-safe pages such as home, Settings, and security/software diagnostics may remain available when they do not expose workspace-owned resources.

Workspace creation may offer `system.foundation@1.0.0` activation by reference via the user-facing "Include System Foundation assets" choice. This does not expose the system pack installer, copy system pack definitions, add pack import/export/install UI, or bypass workspace effective-view/resource scoping.

## Workspace Activation Availability

Workspace activation use cases list, read, and narrowly toggle workspace system-pack activation references. System packs remain system-owned; workspace records only determine availability by reference. The known activation registry is limited to `system.foundation@1.0.0`, diagnostics are sanitized, and no pack-management surface, installer call, pack copy, collaboration, marketplace, workflow, runtime, provider, or network behavior is implied by activation records.

## Artifact Workspace Isolation

Artifact and upload isolation requires workspace pages and transports to send an explicit workspace id for artifact browse, read, and upload operations. Workspace A artifacts must not appear in Workspace B, and missing workspace context must fail safely instead of returning global artifacts.

### Workspace-aware desktop and thin-client surfaces

Desktop and thin-client users can see the active workspace in the shell and on their implemented workspace-scoped pages. The desktop Systems destination and the shared Assets, Artifacts/Data, Models, Images, and generated-output/data/model surfaces remain gated without an active workspace. Settings and safe security/software diagnostics remain globally accessible when they do not display workspace-owned records; thin-client System Builder parity is deferred.

The UI uses real workspace clients/transports for create/select/switch, never derives workspace ids from display names, and never creates a hidden default workspace. Creating a workspace may include System Foundation assets via a `system.foundation@1.0.0` activation reference. Workspace-scoped feature clients must include the active workspace id and must not fall back to global records. User-library/cross-workspace reuse, collaboration, invites, sync, and marketplace/pack-management behavior remain out of scope.

## Workspace Scope And User Library Relationship

Workspace is the normal boundary for user/project resources. A user can create, select, and switch workspaces through host-provided workspace repositories/use cases/transports; no workspace-scoped page should render feature content or call workspace-owned clients without an active workspace. Relevant workspace-scoped pages display the active workspace by display name, and global-safe pages may remain available only when they do not expose workspace-owned records.

System packs remain system-owned. Workspace creation can request `system.foundation@1.0.0` only as a workspace activation reference; system pack definitions/manifests are not copied into workspace records, no system foundation pack baseline installer is called during workspace creation, and hosts must not create hidden/default workspaces or seed/activate packs at startup.

Implemented workspace-owned records require explicit workspace context through contracts, clients, transports, use cases, ports, providers, and persistence; UI gating alone is not sufficient, and reads/mutations must not fall back to legacy global records. Artifacts/uploads use workspace-scoped storage keyspace; image assets, generated-output descriptors/finalization, dataset preparation outputs, model inventory records, and runtime task outputs are workspace-scoped where implemented. Global runtime readiness, installed-runtime/model diagnostics, and provider configuration diagnostics may remain global, but they must not masquerade as workspace-owned records. Resource-backed Asset Library views either require workspace context or remain safely deferred. Legacy global records are not auto-migrated or silently assigned.

User Library reuse is defined by **User Library and Cross-Workspace Asset Reuse**. It owns explicit promote/link/copy/import flows, provenance for promoted/linked/copied assets, resolver support for user-library linked/copied assets, and guarded direct workspace-to-workspace links only when explicitly scoped. User Library reuse must not allow accidental propagation without an explicit link policy.

Related architecture topics are defined by their own canonical docs and ADRs; this overview should not carry a hand-maintained phase/topic map.

## Asset Composition Planning

Asset Composition Planning is defined in `docs/architecture/asset-composition-planning.md` and ADR-0020. It consumes effective asset projections effective projection summaries as planning inputs and does not execute workflows/runtime behavior.

### Asset composition planning UI status

- General composition planning is exposed inside the **Assets** area as a `Plans` tab.
- The top-level **Systems** area owns future system-specific assembly and System Builder records while reusing these planning and Asset Kernel contracts.
- The asset composition planning UI is structured form/list planning (plans, assets in plan, connections, check plan), not visual canvas authoring.
- `valid` means **Ready for planning** only; it does not mean runtime-ready or execution-ready.
- Runtime-readiness binding and workflow/runtime/model execution remain separate responsibilities.
- API/IPC/preload/client exposure is the boundary used by UI operations; unsupported operations must render as unavailable in UI.

Effective asset projection infrastructure enriches the **Assets** experience; it is not a separate primary navigation destination in normal user flows.

## System Builder

System Builder is defined in `docs/architecture/system-builder.md` and ADR-0024. The workspace-scoped **Systems** destination is reserved for constructing systems from Asset Kernel definitions, instances, bindings, and compositions. The initial contract family and desktop preparation shell do not imply CRUD, persistence, transport, editing, runtime, or execution support.

Builder-application diagnostics, feature lifecycle state, Python controls, ComfyUI install/repair status, and resource utilization are **Software status** concerns under **Settings**. They must not be modeled as a composed system or stored on System Builder records.

## Runtime Readiness Binding

Runtime readiness binding is a non-executing capability-matching layer between asset composition planning and execution plan preparation. See `docs/architecture/runtime-readiness-binding.md` and ADR-0021.

## Execution Plan Preparation

Execution plan preparation is the non-executing planning layer between runtime readiness and later execution orchestration. See `docs/architecture/execution-plan-preparation.md` and ADR-0022 for boundaries and output semantics.

## Controlled Conversational Execution

Controlled conversational execution is the runnable conversational-system architecture over prepared plans and explicit approval. It remains part of the general composed-system architecture rather than an image-generation-specific path. See `docs/architecture/controlled-conversational-system-execution.md` and ADR-0023.

The conversational proof must originate from reusable conversational assets composed from referenced `system.foundation` primitives where relevant, then execute through controlled runtime session/run records.

- Systems owns Run & Test for conversational composed-system proof flows
  (execution-plan-derived session creation, approval, bounded transcript, and
  safe message submission through the shared desktop/thin presenter).
- Conversational read models use verified source evidence and application availability; API/IPC/preload/client session creation must not accept renderer/browser display identity claims.
- Server and desktop host composition provide the conversational service family. Cancel, retry, and streaming remain unsupported unless a real application/runtime path supports them.
