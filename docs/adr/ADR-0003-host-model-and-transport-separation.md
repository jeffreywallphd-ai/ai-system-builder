# ADR-0003: Host Model and Transport Separation

- Status: accepted
- Date: 2026-04-14
- Deciders: ai-system-builder maintainers
- Related: docs/adr/ADR-0001-repository-structure.md, docs/architecture/host-model.md

## Context

`ai-system-builder` is expected to support desktop, server, and later hybrid operating modes. The rebuild goal is to preserve this flexibility without reintroducing architecture sprawl.

A common failure mode in similar systems is allowing transport technology to become the de facto architecture:

- Express route/controller structure starts carrying business logic,
- Electron IPC handlers become a miscellaneous service layer,
- host lifecycle concerns get mixed with request/message translation.

If this boundary is not explicit early, desktop and server implementations drift into parallel architectures that are expensive to reconcile.

## Decision

`ai-system-builder` treats **host concerns** and **transport concerns** as separate responsibilities.

- Desktop and server are host models.
- Express HTTP and Electron IPC are transport adapters.
- Application core remains host-agnostic and transport-agnostic.
- Hosts own lifecycle, startup composition, and environment-specific wiring.
- Transport adapters translate transport mechanisms into application contracts.
- Hybrid operation is a later mode and must not force premature complexity into early implementation.
- Shared transport request/response/error envelopes under `modules/contracts/transport` are the transport contract base.
- API and IPC contracts are strict transport specializations: they must reuse shared transport operation and success/failure semantics rather than creating parallel contract families.
- Operation identifiers are shared identities (`lowercase.dot.segments`) created/normalized through shared operation helpers.
- IPC channel values are operation-derived (`ipc.<operation>.<kind>`) where `<kind>` is constrained to `request`, `response`, or `event`.
- Host context contracts remain intentionally small and framework-free; only host identity and lightweight JSON-serializable boundary metadata are allowed across inner boundaries.

Additional position:

- `apps/thin-client/` is a thin surface over the server host, not a full-parity environment by default.

## Alternatives Considered

### 1) Express-centered architecture

Rejected.

Treating Express as the application architecture would couple use-case design to one transport and weaken host portability.

### 2) Electron IPC as a service layer for core behavior

Rejected.

Using IPC handlers and preload glue as a business-logic layer would entangle desktop transport concerns with core application policy.

### 3) Collapsing host and transport into a single folder/model

Rejected.

Merging concerns obscures ownership boundaries and increases the risk that lifecycle, infrastructure, and business logic are mixed.

## Consequences

### Positive

- Application logic remains reusable across desktop and server host models.
- Host flexibility is preserved for desktop-only, server-only, and later hybrid operation.
- Transport adapters can evolve (or be replaced) with less impact on core use cases.
- Boundary discipline reduces drift into parallel architectures.
- Operation/channel naming drift is constrained by shared helpers and channel derivation rules.

### Negative

- Initial composition code may feel more verbose because responsibilities are explicit.
- Teams must resist shortcutting core logic into route/IPC handlers for speed.
- Hybrid-specific behaviors will require deliberate follow-up design instead of implicit early coupling.

## Follow-up Documentation or Implementation Needs

- Keep `docs/architecture/host-model.md` aligned with this ADR as host composition patterns are implemented.
- Keep transport specialization and operation/channel naming rules aligned across ADR, architecture docs, standards docs, and context packs.
- Keep contract public-surface discipline explicit: root contracts exports are family namespaces only, and non-contract modules consume contracts through family barrels.
- Add guidance for composition root placement in `apps/desktop/` and `apps/server/` to prevent logic leakage into transport handlers.
- Create a future ADR for hybrid synchronization/coordination once implementation planning begins.
