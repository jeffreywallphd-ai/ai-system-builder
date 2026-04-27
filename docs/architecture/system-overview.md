# System Overview

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

## Persistence and storage posture

- Persistence: structured durable records (default adapter target: Postgres).
- Storage adapters: a broad architectural category for non-relational durable/semi-durable content concerns with a thin shared foundation.
- Storage is family-oriented (not one flat abstraction): artifact-object storage and artifact-repo storage are peer first-class specialized families.
- Artifact-object storage centers on artifact keys, bytes, checksums, and artifact metadata.
- Repo-backed storage centers on provider/repo identity, revision/version semantics, remote visibility/access semantics, and provider-specific import/publication behavior.
- Shared storage foundation contracts keep family boundaries explicit: `StorageKind` (`artifact-object` | `artifact-repo`), `StorageProviderId`, thin `StorageBackingReference`, and `ArtifactStorageBinding` for internal-artifact linkage.
- Provider integrations should be composed as specialized artifact-repo adapters/providers, not flattened into a generic blob-only framing.
- Hugging Face is the first implemented artifact-repo provider adapter in this repository; treat it as one provider implementation, not as the family definition.
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
