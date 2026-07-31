# ADR-0013: Host-Owned Runtime Execution and Feature Placement

- Status: accepted
- Date: 2026-05-03
- Deciders: maintainers
- Related: ADR-0003, ADR-0012

## Context

This repository supports three app surfaces: desktop (`apps/desktop`), server (`apps/server`), and thin-client (`apps/thin-client`). Runtime-heavy capabilities (image generation, model management, training, and other Python-backed work) may need to execute on different machines depending on available resources and operating mode.

Desktop machines will not always have enough GPU/CPU/RAM for runtime-heavy execution. The architecture therefore needs a future-safe way for desktop to delegate selected features to a configured server without breaking the renderer/preload/IPC boundary.

Server/thin-client image-generation work also exposed the need to keep runtime roots separate from artifact storage roots and to prevent accidental desktop/server runtime sharing.

## Decision

- Hosts are execution authorities.
- Runtime instances are owned by the executing host.
- A host may provide a bounded activation seam to an explicit, state-changing
  execution guard so an eligible local runtime can start before readiness is
  re-checked. Readiness and status reads never invoke that seam.
- Desktop and server runtime roots/processes/state are independent by default.
- Per-feature execution placement is the intended future extension point.
- Desktop renderer continues to use preload/IPC.
- Desktop host composition may later route each feature to local adapters or remote HTTP client adapters.
- Thin-client always calls server APIs and does not own runtimes.
- Runtime roots must be distinct from artifact storage roots.
- Generated outputs belong to the executing host's artifact storage unless explicitly localized/imported elsewhere.

## What should be shared

- domain contracts and invariants
- application use cases and ports
- contract families
- operation identity conventions
- runtime task lifecycle semantics
- transport-neutral runtime readiness vocabulary for host-owned capability availability
- transport envelopes
- reusable adapter implementations where appropriate
- documentation, standards, and ADR rules

## What should not be shared by default

- ComfyUI install roots
- Python managed environments
- runtime process ownership
- raw runtime health/status/log state before host composition maps it into shared readiness snapshots
- runtime temp folders and sidecar output folders
- local filesystem paths, process environment, secrets, and tokens in readiness/transport payloads
- host-local artifact storage roots
- host-local model caches/registries unless deliberately configured
- host token/config files unless explicitly configured through a safe config seam
- filesystem paths across UI/transport contracts

## Consequences

### Positive

- Supports future per-feature local/remote routing.
- Keeps renderer code stable.
- Prevents server and desktop runtime-state collisions.
- Preserves clean architecture boundaries.
- Makes server runtimes usable for underpowered desktop devices.

### Tradeoffs

- Requires more explicit host composition.
- Requires remote client adapters in later implementation phases.
- Requires clear artifact ownership/localization semantics for remote execution.
- Requires better diagnostics/config for runtime roots.

## Non-goals

- This ADR does not implement remote desktop execution.
- This ADR does not implement global sync.
- This ADR does not require feature parity between desktop and thin-client.
- This ADR does not require sharing runtime folders between hosts.
- This ADR does not define final auth/multi-user policy.

## Follow-up implementation needs

- Add execution-target config later.
- Add desktop host execution routers/facades later.
- Add remote HTTP client adapters for feature ports later.
- Add artifact localization/import flow for remote-generated assets if needed.
- Add runtime-root config helpers and tests.
- Compose application runtime readiness providers from installer/supervisor/task state at host boundaries, then expose snapshots through desktop/server transports in later work.
- Update context packs when feature routing work begins.

## Security boundary cross-reference

ADR-0015 defines security architecture boundaries across host, transport, storage, and runtime concerns.
