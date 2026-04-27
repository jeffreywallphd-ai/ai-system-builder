# ADR-0005: Builder Core, Platform Capabilities, and User-Composable Assets

- Status: proposed
- Date: 2026-04-15
- Deciders: ai-system-builder maintainers
- Related: docs/adr/ADR-0001-repository-structure.md, docs/adr/ADR-0002-typescript-first-runtime-model.md, docs/adr/ADR-0003-host-model-and-transport-separation.md, docs/adr/ADR-0004-persistence-and-storage-separation.md, docs/architecture/system-overview.md, docs/architecture/module-dependency-rules.md, docs/architecture/runtime-model.md, docs/architecture/host-model.md, docs/architecture/persistence-and-storage.md, modules/contracts/README.md

## Context

The rebuild direction for `ai-system-builder` is explicitly trying to avoid repeating the architectural sprawl and coupling patterns from earlier iterations, including shell-centered orchestration gravity.

An emerging risk is allowing builder-internal product use cases (for example, product management workflows, builder lifecycle operations, and internal orchestration paths) to become the direct behavior layer for systems users create with the platform. That would blur ownership boundaries and couple user-system behavior to unstable product internals.

At the same time, the project needs meaningful reuse. Current contracts and application-port seams already indicate a direction where cross-cutting capabilities are exposed through explicit contracts and ports, while concrete adapters stay outside application orchestration.

This ADR captures an early-stage architecture direction for separating three concerns:

1. builder-core internal use cases
2. reusable platform capabilities
3. user-authored system behavior and composition assets

This is a boundary-model decision, not a claim that these layers are fully implemented. Detailed capability APIs, execution semantics, and asset taxonomy boundaries are still evolving.

## Decision

`ai-system-builder` will separate builder-core use cases, reusable platform capabilities, and user-authored behavior composition.

### 1) Builder-core use cases remain internal

Builder-core application use cases are for operating the product itself. They are not the reusable behavior model for user-built systems and should not be exposed as the direct logic layer that user systems execute.

### 2) Reuse happens through platform capabilities

Cross-cutting reusable capabilities should be exposed through explicit capability surfaces (contracts, ports, services, and adapters as they become concrete). Both builder-core logic and user-authored system logic may depend on those capability surfaces.

Examples of capability areas include, but are not limited to:

- contracts families and operation identity conventions
- application port seams and adapter-facing capability interfaces
- runtime execution services
- persistence and storage services
- host/transport boundary services and execution support

These capabilities are the intended reuse boundary; builder-internal workflows are not.

### 3) User systems compose through Assets on shared substrate

Use **Asset** as the umbrella composition noun for reusable managed units in user-built systems, while preserving role clarity.

- “Asset” is the shared composition umbrella.
- Role-specific categories may include (non-final): data asset, tool asset, behavior asset, workflow asset, integration asset, UI asset, and system asset.
- Exact taxonomy is intentionally not finalized yet.
- The key early decision is a shared asset/composition substrate with distinguishable role-specific behavior.

### 4) This ADR is directional and intentionally non-final

This ADR sets architecture direction and boundary intent only. It does not finalize:

- complete capability API shapes,
- final asset taxonomy,
- full execution semantics for user-authored behavior,
- concrete module placement for all future capability services.

Those details require implementation evidence and follow-up ADRs where needed.

## Alternatives Considered

### 1) Reuse builder-core application use cases directly inside built systems

Rejected.

This would tightly couple user-system behavior to product-internal workflows, reduce builder-core refactor safety, and reintroduce boundary sprawl between product operations and platform behavior.

### 2) Keep all reusable behavior inside one shell-like orchestration layer

Rejected.

A shell-centered model risks recreating the same coupling and ownership ambiguity the rebuild is explicitly trying to avoid. It also makes capability boundaries less explicit and harder to evolve independently.

### 3) Separate builder-core use cases, reusable platform capabilities, and user-authored behavior assets

Accepted direction.

This preserves internal-product autonomy, supports deliberate reuse through stable capability seams, and allows user-system behavior to evolve as composable assets without inheriting builder-internal workflow coupling.

### 4) Delay separation decisions until after broad implementation

Rejected.

Deferring this boundary decision would likely produce accidental coupling in early implementation, making later separation more expensive and disruptive.

## Consequences

### Positive

- Clearer separation between product-internal logic and user-system logic.
- Better long-term refactor safety for builder-core use cases.
- More deliberate, explicit reuse via stable capability seams.
- Better alignment with existing contract-family and application-port boundary direction.
- Lower risk of repeating shell-centered sprawl.

### Negative

- Additional design work is required to define and harden the platform capability layer.
- Asset role taxonomy and execution semantics remain partially open until more implementation evidence is available.
- Early implementation may move slower due to explicit boundary discipline and anti-coupling constraints.

## Follow-up Documentation or Implementation Needs

- Refine architecture docs once capability-layer responsibilities and boundaries are more concrete.
- Define where capability services/ports live in the repository and how they are versioned/exposed.
- Document how user-built systems consume platform capabilities without depending on builder-core internal use cases.
- Refine asset role taxonomy incrementally as implementation evidence accumulates.
- Record follow-up ADRs when capability APIs or asset-model semantics become concrete enough to standardize.

Note: this ADR intentionally establishes direction early while leaving detailed implementation shape open.
