# ADR-0016: Asset Kernel Terminology and Architecture Baseline

- Status: accepted
- Date: 2026-05-06
- Deciders: ai-system-builder maintainers
- Related: docs/adr/ADR-0005-builder-core-platform-capabilities-and-user-composable-assets.md, docs/adr/ADR-0004-persistence-and-storage-separation.md, docs/adr/ADR-0009-artifact-identity-and-backing-domain-model.md, docs/adr/ADR-0011-runtime-task-registry.md, docs/adr/ADR-0013-host-owned-runtime-execution-and-feature-placement.md, docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md, docs/architecture/asset-kernel.md, docs/architecture/system-overview.md, docs/architecture/persistence-and-storage.md, docs/architecture/runtime-model.md, docs/architecture/host-model.md

## Context

ADR-0005 established an early directional decision: builder-core use cases, platform capabilities, and user-authored system behavior must remain separate, and **Asset** is the shared composition umbrella for reusable managed units in user-built systems. ADR-0005 intentionally left exact taxonomy, concrete asset semantics, execution semantics, and capability API shapes open.

Asset Kernel needs an implementation-ready baseline so later work does not invent parallel models for artifacts, resources, UI components, tools, workflows, pages, systems, generated outputs, previews, external repository objects, and AI context.

Existing architecture already includes important adjacent concepts:

- persistence and storage are separate architecture concerns,
- artifacts have identity/backing semantics and may be file/object or provider/repository-backed,
- runtime readiness and runtime task registry contracts are shared runtime concepts,
- hosts own runtime execution and compose concrete providers,
- security policy boundaries must prevent sensitive path, token, environment, command, stack-trace, and adapter-detail leakage.

The Asset Kernel must build on those decisions rather than replace or duplicate them.

## Decision

Create the **Asset Kernel** as the canonical baseline for assets in `ai-system-builder`.

Assets are versioned, configurable, AI-readable, machine-composable building blocks that can represent structure, behavior, interface, data, instructions, resources, compositions, or logic containers, and can be assembled into features, systems, subsystems, and systems composed of subsystems.

The Asset Kernel defines these core concepts:

- `Asset`
- `AssetDefinition`
- `AssetInstance`
- `AssetBinding`
- `AssetComposition`
- `AssetReference`
- `AssetConfiguration`
- `AssetAiContext`
- `AssetPort`
- `AssetCompositionRule`
- `AssetValidationIssue`
- `AssetLifecycleStatus`
- `AssetProvenance`
- `AssetRequirement`
- `Resource-backed Asset`

It also defines how assets relate to outside-but-referenceable concepts:

- `Artifact`
- `Resource`
- `Generated Output`
- `Preview`
- `External Repository Object`

Logic containers are preserved as descriptive coverage for behavioral and composition assets such as tools, workflows, workflow steps, policies, feature logic, and system/subsystem behavior; ADR-0016 does not introduce a separate `logic-container` type.

The canonical terminology and implementation guidance live in `docs/architecture/asset-kernel.md`.

## Relationship to ADR-0005

This ADR **refines** ADR-0005. It does not supersede ADR-0005.

ADR-0005 remains the directional boundary decision separating builder-core internal use cases, reusable platform capabilities, and user-composable assets. ADR-0016 narrows that directional asset concept into the accepted Asset Kernel vocabulary and implementation boundaries.

ADR-0005 said the final taxonomy was not yet decided. ADR-0016 decides the initial shared kernel vocabulary, asset/resource/artifact distinctions, and incremental implementation order while preserving ADR-0005's builder-core/platform-capability/user-asset separation.

## Relationship to artifacts, resources, storage, and runtime

- Assets are broader than stored files/artifacts.
- Artifacts/resources can back assets but are not the whole asset model.
- A resource-backed asset is an asset whose semantic value is backed by a resource or artifact.
- The asset model must not duplicate low-level storage concerns such as raw bytes, local filesystem paths, object keys, or provider transfer mechanics.
- Generated outputs are resources/artifacts produced by runtime tasks; they become reusable only after finalization/registration as artifacts or resource-backed assets.
- Hugging Face repository objects remain external repository objects unless registered/imported as resource-backed assets.
- Existing artifact/model/dataset/image concepts must not be renamed in Asset Kernel contract baseline.
- Runtime requirements declared by assets must reference shared `RuntimeCapabilityId` values instead of creating parallel runtime readiness concepts.
- Asset requirements do not replace runtime readiness; readiness answers whether a required capability is currently available.
- Host composition remains responsible for wiring concrete runtime/readiness providers.

## Implementation implications for Asset Kernel

Implementation must stay layered: contract work begins in `modules/contracts`; validation and use cases live in `modules/application`; adapters live in `modules/adapters`; host wiring lives in `modules/hosts`; UI-specific behavior stays in UI/app areas after kernel contracts exist. Transport/UI work remains downstream of stable kernel contracts.

## Consequences

### Positive

- Gives later work a shared vocabulary for definitions, instances, bindings, and compositions.
- Prevents assets from being reduced to files, UI components, workflows, generated outputs, or Hugging Face objects alone.
- Preserves existing artifact/resource/storage/runtime concepts while defining how assets reference them.
- Enables AI-assisted composition through structured AI-readable context plus machine-composable contracts.
- Creates an incremental Asset Kernel contract baseline path that separates core contracts, configuration, AI context, ports/composition, validation, registry ports, persistence, and resource-backed mapping.

### Negative

- Adds another canonical architecture concept contributors must learn.
- Requires care to avoid over-modeling every possible asset type before concrete implementation evidence exists.
- Requires future implementation work to coordinate across contract, application, adapter, host, and UI boundaries rather than building vertical shortcuts.

## Alternatives considered

### Supersede ADR-0005

Rejected. ADR-0005 remains correct as the earlier directional separation of builder-core use cases, platform capabilities, and user-composable assets. The gap is specificity, not incorrectness.

### Update ADR-0005 directly

Rejected. ADR guidance supports follow-up ADRs when implementation choices become final enough to record. A separate ADR keeps the original directional decision intact and records the Asset Kernel contract baseline refinement history clearly.

### Treat artifacts/resources as the asset model

Rejected. Artifacts and resources are important backings for some assets, but assets also represent behavior, interface, instructions, and compositions. Collapsing assets into storage would duplicate low-level storage concerns and fail to support AI-assisted system composition.

### Create UI-, workflow-, image-, or Hugging-Face-specific asset models first

Rejected. Transport/UI/provider-specific models would fragment the vocabulary and force later migration. Specific families can specialize the shared kernel after shared contracts are stable.

### Implement contracts, persistence, or UI immediately

Rejected. this decision is documentation/architecture only. Implementation starts in later work after this baseline is recorded.

## Non-goals

- No TypeScript contracts in this prompt.
- No application services or validation implementation in this prompt.
- No persistence adapter, migrations, API routes, IPC routes, UI, runtime behavior, or storage rewrite in this prompt.
- No asset marketplace, plugin package registry, workflow execution store, scheduler/queue change, or runtime readiness change.
- No renaming of existing artifact/model/dataset/image concepts in Asset Kernel contract baseline.
- No transport/UI-specific asset models.
- No public asset metadata that exposes secrets, local temp paths, tokens, command lines, raw environment values, stack traces, or raw adapter details.
