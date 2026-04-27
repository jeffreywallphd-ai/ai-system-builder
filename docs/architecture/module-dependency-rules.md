# Module Dependency Rules

This document defines practical dependency rules for `ai-system-builder`.

The objective is simple: keep core logic independent, keep boundaries explicit, and stop accidental coupling early.

## Dependency direction (default)

Preferred dependency flow is **outside-in at runtime, inside-out for source dependencies**:

- outer layers (apps/hosts/adapters/UI) may depend inward on contracts/application/domain,
- inner layers (domain/application) must not depend outward on infrastructure/host/UI specifics.

## Allowed and disallowed dependencies

## 1) Domain (`modules/domain`)

**Allowed**

- Internal domain modules.
- Shared, framework-neutral utilities that do not pull infrastructure concerns.

**Not allowed**

- `modules/adapters/**`
- `modules/hosts/**`
- `modules/ui/**`
- `apps/**`
- Transport or framework APIs (Express, Electron IPC, DB clients, etc.).

**Rule**: Domain is the most protected layer.

## 2) Application (`modules/application`)

**Allowed**

- `modules/domain/**`
- `modules/contracts/<family>` (for boundary shapes through explicit family surfaces)
- Application-local ports/policies/DTOs.

**Not allowed**

- Concrete adapter implementations (`modules/adapters/**`)
- Host lifecycle logic (`modules/hosts/**`)
- UI modules (`modules/ui/**`)
- App entry point code (`apps/**`)
- Root `modules/contracts` imports or deep contract internal-file imports.
- Application orchestration paths that bypass `modules/application/ports/**` and bind directly to adapter-native inputs/outputs.
- Application orchestration paths that bypass the logging port seam (`modules/application/ports/logging`) and call adapter-native logger APIs directly.

**Rule**: Application defines orchestration and required ports; it does not select infrastructure.
Application ports are required seams and should stay thin, role-revealing, and contract-aligned.
Configuration loading/resolution remains a composition-root responsibility today; typed config contracts do not by themselves imply a required application config port seam yet.

## 3) Contracts (`modules/contracts`)

**Allowed**

- Contract-local types and schema helpers that remain boundary-oriented.

**Not allowed**

- Domain business logic.
- Concrete adapter/framework dependencies.

**Rule**: Contracts are stable cross-boundary language, not implementation containers.
Contract families must compose, not fork:

- Treat `modules/contracts/transport` as the shared transport envelope and operation base.
- Keep API and IPC contracts as specializations over that shared base.
- Keep operation identity and IPC channel derivation helper-driven rather than ad hoc string assembly.
- Import contract symbols via family barrels (`modules/contracts/<family>`) rather than deep file paths to internal contract files.
- Do not depend on flattened catch-all root contract exports; family boundaries are the stable public surface.
- For non-contract modules, root `modules/contracts` imports are disallowed; import a specific family barrel directly.

## 4) Adapters (`modules/adapters`)

**Allowed**

- `modules/contracts/**`
- `modules/application/**` ports/interfaces/use-case entry contracts.
- `modules/domain/**` types only when needed and not causing inward leakage.
- External libraries needed for concrete integration (DB drivers, Express wiring, runtime bridge clients, etc.).

**Not allowed**

- Reaching into app entry points for core logic.
- Owning business rules that belong in application/domain.

**Rule**: Adapters implement details at boundaries; they should depend inward, not the reverse.

## 5) Hosts (`modules/hosts`)

**Allowed**

- `modules/application/**`
- `modules/contracts/**`
- `modules/adapters/**`
- Host framework APIs (Electron host lifecycle, server process lifecycle, etc.).

**Not allowed**

- Embedding core business rules directly in host startup/lifecycle code.

**Rule**: Hosts compose and run the system for a target environment. They are not transport adapters and not business-logic layers.

## 6) UI (`modules/ui`)

**Allowed**

- `modules/contracts/**` and UI-facing application interfaces.
- `modules/ui/shared/**` reused by platform-specific UI layers.

**Not allowed**

- Direct dependency on persistence/storage/transport adapter internals.
- Business logic that should live in application/domain.

**Rule**: UI consumes exposed use-case interfaces/contracts; it should not bypass boundaries into infrastructure.

## 7) Apps (`apps/*`)

**Allowed**

- Host composition and wiring imports.
- Build/runtime bootstrap code.

**Not allowed**

- Becoming the main container for core logic.

**Rule**: Apps are entry points and packaging surfaces, not architecture centers.
Apps own framework runtime/bootstrap creation (for example `express()` and top-level middleware), while hosts compose dependencies and register transport routes/handlers through thin ports.

## Anti-rules (common failure patterns)

Avoid these patterns even if they "work":

- Route or IPC handlers containing business decision trees.
- Application orchestration code importing adapters directly instead of depending on application ports.
- Application orchestration code writing logs through adapter-native logger APIs instead of the logging port seam.
- Ports that become generic service dumps rather than focused boundary seams.
- API/IPC contract files recreating independent success/failure envelopes instead of specializing shared transport contracts.
- Ad hoc operation or IPC channel strings that bypass shared normalization/derivation helpers.
- Domain importing an ORM model, DB client, or host API.
- UI calling DB or file APIs directly.
- App-level scripts becoming permanent orchestration layers.
- Creating new packages/folders to solve local complexity before simplifying boundaries.

## Enforcement status

Some automated rule enforcement may be added later (lint/import rules/build checks), but full tooling is **not yet finalized**.

Current baseline enforcement already includes contract-surface and anti-drift invariant tests under `modules/contracts/**/tests` and `modules/contracts/tests`.
Treat this document as mandatory review criteria in addition to those tests.

## Lightweight review checklist

Before merging, confirm:

- Does domain remain infrastructure-free?
- Does application depend only on inward layers and contracts?
- Are adapters implementing ports instead of defining use cases?
- Are hosts focused on composition/lifecycle only?
- Is UI staying out of infrastructure internals?
- Are apps only bootstrapping/composing?

If any answer is "no", refactor before adding more code on top.
