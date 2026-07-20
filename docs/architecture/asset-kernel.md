# Asset Kernel

- Status: current
- Related decisions: `docs/adr/ADR-0005-builder-core-platform-capabilities-and-user-composable-assets.md`, `docs/adr/ADR-0016-asset-kernel-terminology-and-architecture-baseline.md`, `docs/adr/ADR-0030-executable-asset-implementations-and-releases.md`, `docs/adr/ADR-0034-functional-foundation-pack-evolution.md`
- Verification: `docs/architecture/architecture-verification.md`

## Purpose

The Asset Kernel is the canonical shared foundation for assets in `ai-system-builder`.

An asset is a versioned, configurable, AI-readable, machine-composable building block. Assets can represent structure, behavior, interface, data, instructions, resources, compositions, or logic containers, and can be assembled into features, workflows, pages, subsystems, systems, and systems composed of subsystems.

This document prevents parallel vocabularies for artifacts, resources, UI components, tools, workflows, pages, systems, generated outputs, previews, external repository objects, and AI-readable context.

## Relationship To ADRs And Architecture

- ADR-0005 establishes **Asset** as the directional composition umbrella for reusable managed units in user-built systems.
- ADR-0016 accepts the Asset Kernel terminology and architecture baseline.
- ADR-0004 and `docs/architecture/persistence-and-storage.md` remain authoritative for persistence/storage separation.
- ADR-0011, ADR-0013, and `docs/architecture/runtime-model.md` remain authoritative for runtime task/readiness ownership and host-owned execution.
- ADR-0015 remains authoritative for security and policy boundaries.

The Asset Kernel does not replace storage, runtime, host, transport, or security models. It defines how assets reference capabilities, resources, lifecycle, provenance, and composition needs without duplicating those lower-level systems.

Executable source, implementation bundles, build evidence, and system releases are also outside Asset Kernel records. ADR-0030 and `docs/architecture/asset-implementations-and-packages.md` define the separate implementation-release family and its exact bindings to semantic definitions.

## Canonical Terminology

| Concept                      | Kernel status                             | Canonical meaning                                                                                                                                                           |
| ---------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Asset`                      | Kernel concept                            | The reusable/composable semantic unit known to AI System Builder.                                                                                                           |
| `AssetDefinition`            | Kernel concept                            | A reusable versioned blueprint/template for a composable building block.                                                                                                    |
| `AssetInstance`              | Kernel concept                            | A configured use of an asset definition in a feature, system, workflow, page, or composition.                                                                               |
| `AssetBinding`               | Kernel concept                            | A typed connection between asset instances, ports, resources, runtime capabilities, storage objects, or external repository objects.                                        |
| `AssetComposition`           | Kernel concept                            | A validated assembly of asset instances and bindings into a larger unit such as a feature, workflow, page, subsystem, system, or system of subsystems.                      |
| `AssetReference`             | Kernel concept                            | A stable transport-neutral reference to an asset or referenceable backing object. Deterministic behavior should reference specific definition versions.                     |
| `AssetConfiguration`         | Kernel concept                            | The definition-owned configuration surface plus instance-selected values.                                                                                                   |
| `AssetAiContext`             | Kernel concept                            | Structured AI-readable metadata for retrieval, validation support, and prompt assembly.                                                                                     |
| `AssetPort`                  | Kernel concept                            | A formal input, output, event, control, action, data, or error connection point.                                                                                            |
| `AssetCompositionRule`       | Kernel concept                            | A machine-checkable rule for dependencies, incompatibilities, ordering, cardinality, parent/child constraints, or binding compatibility.                                    |
| `AssetValidationIssue`       | Kernel concept                            | A structured validation result for missing/invalid configuration, AI-context gaps, incompatible bindings, lifecycle problems, missing requirements, or unsafe declarations. |
| `AssetLifecycleStatus`       | Kernel concept                            | The lifecycle baseline: `draft`, `validated`, `published`, `deprecated`, `archived`, and `failed-validation`.                                                               |
| `AssetProvenance`            | Kernel concept                            | Safe creation/update/source/derivation metadata, including AI-generated or human-authored markers where appropriate.                                                        |
| `AssetRequirement`           | Kernel concept                            | Declarative runtime, host, permission, safety, resource, artifact, or external-provider requirements.                                                                       |
| `Resource-backed Asset`      | Kernel concept                            | An asset whose semantic value is backed by a resource or artifact descriptor.                                                                                               |
| `Artifact`                   | Outside kernel, referenceable             | A stored, managed resource with metadata, storage identity, provenance, and possibly external repository identity.                                                          |
| `Resource`                   | Outside kernel, referenceable             | Addressable content/data such as bytes, generated output, dataset file, image file, document file, model file, or provider object.                                          |
| `Generated Output`           | Outside kernel until registered/finalized | A runtime-produced resource/artifact that may later become or back an asset after explicit finalization/registration.                                                       |
| `Preview`                    | Outside kernel, referenceable             | A derived readable representation of a resource-backed asset or artifact.                                                                                                   |
| `External Repository Object` | Outside kernel, referenceable             | An object in an external system, such as a Hugging Face repository or file, that may be mirrored, referenced, localized, or wrapped as a resource-backed asset.             |

## Asset Ontology

### AssetDefinition

An `AssetDefinition` is a reusable blueprint/template for a composable building block.

Examples include:

- UI component definition,
- workflow step definition,
- tool definition,
- prompt template definition,
- model asset definition,
- dataset asset definition,
- system or subsystem definition.

Definitions own type/family, version, lifecycle, AI-readable context, configuration surface, ports, composition rules, requirements, and provenance. Definitions are versioned. Systems that require deterministic behavior should reference a specific definition version rather than an implicit latest version.

### AssetInstance

An `AssetInstance` is a configured use of an asset definition in a feature, system, workflow, page, or composition.

Examples include:

- an image gallery component configured for a generated-image collection,
- a workflow step configured to chunk textbook content,
- a tool instance bound to a specific runtime capability,
- a model asset instance bound to a model inventory record.

Instances own the definition reference, selected configuration, lifecycle/state, bindings, parent composition reference, applicable resource references, and use-specific provenance. Definitions and instances may have separate lifecycle and provenance.

### AssetBinding

An `AssetBinding` is a typed connection between asset instances, ports, resources, runtime capabilities, storage objects, or external repository objects.

Bindings are where AI-proposed composition becomes machine-checkable. AI can propose bindings, but validation must verify compatibility before execution or publication.

### AssetComposition

An `AssetComposition` assembles asset instances and bindings into a larger feature, workflow, page, subsystem, system, or system of subsystems.

A composition is not simply a folder, route, renderer tree, or file hierarchy. It is a validated assembly of configured instances and typed bindings.

### System Builder specialization

The System Builder does not define another component graph. `modules/contracts/system-builder` narrows `AssetComposition` to the `system` and `system-of-subsystems` composition types and wraps it in a workspace-owned design-time record. System Builder lifecycle describes construction progress only; software, host, installer, runtime, and execution status remain outside that record. See `docs/architecture/system-builder.md` and ADR-0024.

## Asset Families

High-level asset families:

1. **Structural assets**: interface, page, schema, layout, system shape, and other structure-bearing units.
2. **Behavioral assets**: tools, workflows, workflow steps, runtime-bound operations, adapters, tests, and policies.
3. **Resource-backed assets**: assets whose semantic value is backed by resources/artifacts such as models, datasets, images, documents, or provider repo files.
4. **Context assets**: prompts, instructions, AI-readable summaries, policies, examples, and composition guidance.
5. **Composition assets**: features, pages, workflows, logic containers, subsystems, systems, and systems composed of subsystems.

Example asset types include `ui-component`, `page`, `tool`, `workflow`, `workflow-step`, `schema`, `prompt-template`, `data-source`, `runtime-binding`, `adapter-binding`, `model`, `dataset`, `image`, `document`, `feature`, `subsystem`, `system`, `policy`, and `test`.

Logic containers are a descriptive umbrella for behavioral and composition assets such as tools, workflows, workflow steps, policies, feature logic, and system/subsystem behavior. They are not a separate required asset type.

## Resources, Generated Outputs, Previews, And External Objects

Rules:

- Artifacts/resources do not replace the asset model.
- The asset model does not duplicate low-level storage concerns such as bytes, local filesystem paths, object keys, or provider-native transfer mechanics.
- External repository `objectPath` values are provider object metadata only; they are not canonical Asset Kernel ids.
- Resource-backed asset primary backing links use safe `asset-resource-backing` references to internal backing ids, not provider-native paths or URLs.
- Generated outputs become reusable only after explicit finalization/registration.
- External repository objects become assets only after explicit import/localization/registration.
- Previews are derived representations, not the asset itself.
- Existing artifact, model, dataset, image, and storage families should not be renamed to satisfy Asset Kernel vocabulary.

## AI-Readable Context

Assets intended for AI-assisted composition use structured `AssetAiContext` under `modules/contracts/asset`. The contract can describe purpose, capabilities, limitations, input/output summaries, configuration guidance, composition guidance, examples, anti-patterns, safety notes, user-facing and developer-facing summaries, quality/completeness metadata, and safe metadata.

Guidance:

- AI context is asset metadata owned by the asset definition, not only external docs.
- AI context supports retrieval, validation support, and prompt assembly.
- AI context complements machine contracts and must not replace configuration schemas, formal ports, binding compatibility, composition rules, or validation services.
- AI context must not store secrets, tokens, local/temp/provider-native paths, sensitive raw prompts, raw private transcripts, raw environment values, command lines, stack traces, adapter payloads, file/blob bytes, or embeddings/vector arrays.

## Configuration Surface

`AssetConfiguration` contracts describe configuration schemas, fields, JSON-compatible default and selected values, constraints, option lists, generic UI hints, validation rule descriptors, examples, and schema/version references.

Guidance:

- Asset definitions own `configurationSchema`, `defaultConfiguration`, and `configurationExamples`.
- Asset instances own selected configuration values.
- Configuration values must remain JSON-compatible for persistence and transport.
- Functions, host/runtime objects, filesystem handles, bytes, paths, secrets, raw environment values, raw adapter details, and executable code are not configuration values.
- Configuration contracts are schema-engine-neutral and future JSON-schema-compatible. They do not imply a runtime schema parser, conditional schema engine, migration framework, or form renderer.

## Ports, Bindings, And Composition Rules

Composable assets describe formal connection points through ports, binding constraints, dependencies, composition rules, and validation summaries.

Contract concepts include:

- input, output, event, and control ports,
- lightweight port contracts for assets, resources, artifacts, configuration, runtime capabilities, events, control, JSON/text, and binary references,
- port and composition cardinality descriptors,
- binding constraints such as same contract kind, asset type/family, resource kind, runtime capability, single-source/single-target, ordering, and custom future-rule descriptors,
- composition rules for allowed parents/children, required/optional/incompatible children, required dependencies, cardinality, ordering, binding-required, runtime requirements, and custom descriptors,
- composition dependencies for assets, asset types/families, resources, artifacts, runtime capabilities, external repository objects, configuration, and custom descriptors.

Ports, bindings, and composition rules belong in shared asset contracts, not renderer-specific models. They are descriptor contracts unless an application validation service explicitly evaluates them.

## Lifecycle, Review, And Provenance

Lifecycle and review are separate concerns.

Lifecycle statuses:

- `draft`,
- `validated`,
- `published`,
- `deprecated`,
- `archived`,
- `failed-validation`.

Review/approval statuses:

- `unreviewed`,
- `reviewed`,
- `approved`,
- `rejected`.

Provenance can include created/updated timestamps, creator/source, source assets, derived-from links, AI-generated or human-authored markers, safe generation context, and optional review/approval status.

Public asset metadata and validation details use JSON-compatible `AssetMetadata` values. They must not expose secrets, local/temp/cache/storage/runtime paths, raw bytes, buffers, streams, filesystem handles, runtime objects, tokens, command lines, raw environment values, stack traces, or other sensitive implementation details.

## Requirements

Assets express requirements declaratively through `AssetRequirement` without replacing runtime readiness.

Requirement concepts include:

- required runtime capability IDs,
- required host type,
- required permissions,
- external network access,
- filesystem access,
- secret/token access,
- user approval requirement,
- thin-client safety,
- automation safety.

Guidance:

- Asset runtime requirements should reference shared `RuntimeCapabilityId` values without duplicating runtime readiness snapshots, runtime task statuses, or provider lifecycle concepts.
- Runtime readiness answers whether a required capability is currently available.
- Asset validation can structurally check declared requirements before execution or composition.
- Host composition remains responsible for wiring concrete runtime/readiness providers.
- Permission requirements should be declarative; enforcement belongs in application/host policy seams.

## Validation

Asset validation is application-layer and transport/UI-neutral. It returns structured `AssetValidationIssue` results and does not execute workflows, query runtime readiness, start runtimes, access filesystem/network, call LLMs, or persist anything.

Validation responsibilities include:

- required configuration,
- configuration type/constraint validity,
- AI context completeness for AI-composable definitions,
- port/binding compatibility,
- required dependencies,
- allowed parent/child composition,
- lifecycle state,
- missing runtime requirements structurally,
- unsafe or disallowed permission requirements.

Validation status vocabulary is shared: `not-validated`, `valid`, `valid-with-warnings`, `invalid`, and `unknown`.

Application create/register/update use cases validate before saving through repository ports. Read/list paths do not revalidate by default.

## Persistence And Local Composition

The Asset Kernel persists JSON-compatible metadata/reference records only. It does not store resource bytes, generated image bytes, provider payloads, raw workflow payloads, local/cache/runtime/storage paths, prompts, secrets, tokens, signed URLs, command lines, environment values, stack traces, or raw resource contents.

Current implementation state:

- Shared contracts live in `modules/contracts/asset`.
- Pure validation and mapping services live in `modules/application/services/asset`.
- Repository, read, and mutation ports live in `modules/application/ports/asset`.
- Transport-neutral use cases live in `modules/application/use-cases/asset`.
- Local JSON persistence adapters live in `modules/adapters/persistence/asset`.
- `composeLocalAssetKernel` composes local JSON record persistence for definitions, instances, compositions, and bindings under `<storageRoot>/asset-kernel/`.
- `composeInternalAssetRegistry` privately wires local persistence/use cases to the application `AssetRegistryReadFacade` for desktop/server host-owned consumers.

Local persistence writes a schema/kind manifest and family JSON files for definitions, instances, compositions, and bindings. It accepts JSON-compatible records only and rejects functions, symbols, undefined values, non-finite numbers, Dates, buffers/streams, class instances, and circular records at the durable adapter boundary. Migrations beyond the current manifest schema/kind checks remain unimplemented.

Deferred registry concerns remain explicit: no automatic definition version incrementing, no version-history service, no broad delete policy beyond optional repository-port methods, no additional conflict-detection policy beyond adapter behavior, and no direct runtime readiness, filesystem, or network access from registry use cases.

## Asset Registry, Resource-Backed Views, And Controlled Mutations

`AssetRegistryReadFacade` is read-only, transport-neutral, UI-neutral, and validation-on-request. It can read repository records, binding summaries, exact built-in metadata, validation summaries, and optional injected resource-backed views without save/update/delete/seed behavior.

Resource-backed views are computed descriptor read models. They are not persisted mappings, do not create `AssetInstance` records, do not scan storage, do not read bytes/content, do not call providers/network/runtimes, and do not move ownership away from existing artifact/image/dataset/model/storage/repository families.

Supported provider families depend on safe host-composed descriptor seams. Unsupported or unwired families return sanitized diagnostics rather than falling back to unsafe reads. Generated outputs remain `generated-output` views until finalization/registration succeeds. External repository objects remain external object views until import/localization/registration succeeds.

The public Asset Registry/Asset Library surfaces are read-only unless they invoke one of the narrow controlled mutation workflows. Public read surfaces must use API, IPC, preload, and client wrappers rather than local persistence adapters, application services, or host composition helpers directly.

Approved controlled mutation operations:

- `asset.register-resource-backed-view`,
- `asset.finalize-generated-output`,
- `asset.import-external-repository-object`,
- `asset.localize-external-repository-object`.

All controlled mutations require explicit approval, actor metadata, safe request context, guard-first application use-case execution, source re-read by id, safe source identity/deduplication, validation before save, and sanitized provenance/failure/result data. They store metadata and references only.

## System Foundation And Packs

`system.foundation` is the canonical versioned, system-trusted default pack. Its entries are full `AssetDefinition` records with source-pack metadata, category metadata, stable definition refs, stable fingerprints, semantic configuration schemas, AI context, ports, and composition guidance.

System defaults are represented as pack entries, not loose hardcoded built-ins. Read-side system-default classification requires trusted system source metadata or a valid installer-managed marker, not source labels alone.

Foundation definitions remain semantic and host-neutral. Functional behavior is supplied by exact trusted implementation-release or declarative-engine bindings under ADR-0034. Definitions do not embed renderer components, CSS, routes, API or IPC handlers, workflow engines, runtime tasks, provider calls, resource readers, storage reads/writes, file uploads, executable code, or implementation bytes.

The immutable 1.0.0 and current 2.0.0 releases are addressed independently.
Only current definitions receive the additive, definition-owned slots required
for nested visual composition; legacy definitions are not rewritten. Every
definition retains an exact backing-resource bundle. A qualified current visual
definition additionally carries a declarative frontend structure program with
its semantic element, bounded named regions, safe preview fixture, and styling
resource. These files are implementation backing resources outside Asset Kernel
metadata, not metadata references pretending that an implementation exists.
Trusted shared renderers interpret the closed programs without executing
authored/imported source or backend logic.

Pack validation, quality gates, install diagnostics, resolver diagnostics, manifest serialization, and parsing must stay sanitized. Unsafe paths, credentials, signed URLs, raw provider payloads, stack traces, command lines, environment values, bytes/blob/base64/data URLs, prompt text, workflow JSON, and raw resource contents must be rejected or omitted.

Install/seeding for `system.foundation` is explicit, internal, idempotent, and non-destructive. Shared composition helpers and workspace creation must not invoke it implicitly. The owning desktop/server asset-feature startup explicitly invokes and awaits the guarded global foundation installer before serving asset reads; startup fails closed if that product-owned baseline cannot be established. This is not workspace-scoped seeding, hidden workspace creation, or a public install/import path.

The resolver is pure and non-destructive. It accepts explicit candidate definitions, manifests, source-layer ordering, and override rules supplied by the caller. Exact references bypass overrides by default. Semantic/default references may apply explicit enabled override rules only when the request allows overrides. Override rules select effective replacements during resolution and never mutate system records.

## Workspace Scope

Workspace Asset Library reads require explicit workspace context. Missing workspace context must fail safely and must not fall back to global Asset Registry records.

A workspace can see `system.foundation@1.0.0` definitions only when it has an active trusted system-pack activation reference. A bare `sourcePackId` is not sufficient authority, and detail reads must not bypass the workspace effective view.

Workspace creation can create a reference activation for `system.foundation@1.0.0`; it must not copy pack manifests, asset entries, or definitions and must not invoke system pack install behavior.

Resource-backed descriptors require workspace context through contracts, clients, transports, read facades, provider ports, and persistence/provider seams. Providers that cannot safely scope a family must fail safely or return sanitized diagnostics instead of exposing global records.

User Library and Cross-Workspace Asset Reuse are defined in `docs/architecture/user-library-and-cross-workspace-reuse.md` and ADR-0017. Promotion, link, copy, import, provenance, propagation policy, and effective-source behavior must remain explicit and must not introduce accidental propagation.

## Boundaries And Non-Goals

Asset Kernel work must preserve clean architecture boundaries:

- shared asset contracts belong in `modules/contracts`,
- application validation/use cases belong in `modules/application`,
- adapters belong in `modules/adapters`,
- host wiring belongs in `modules/hosts`,
- UI belongs in apps/modules UI areas.

Non-goals:

- no automatic asset instance creation from artifacts, generated outputs, previews, or external repository objects,
- no durable resource-backed mapping repository beyond explicit `AssetInstance` records created by controlled workflows,
- no arbitrary asset create/update/delete/patch/editor API, IPC, preload method, renderer action, or thin-client action,
- no public marketplace, ratings, billing, publisher governance, or automatic updates,
- package import/install/activation is permitted only through ADR-0031's quarantine, inspection, admission, trust, and lifecycle boundary,
- no broad provider browsing, storage scans, byte/content reads, or network/provider calls from Asset Kernel reads,
- no workflow execution, runtime task execution, scheduler/queue behavior, or runtime readiness ownership,
- no visual composition/canvas authoring,
- no transport/UI-specific asset models,
- no file-only, UI-only, workflow-only, image-generation-only, or Hugging-Face-only asset model.

## Related Canonical Docs

- `docs/architecture/user-library-and-cross-workspace-reuse.md` defines User Library and cross-workspace reuse.
- `docs/architecture/asset-authoring-customization-and-overrides.md` defines authored/customized asset and override behavior.
- `docs/architecture/effective-asset-projections.md` defines workspace-effective projection reads.
- `docs/architecture/asset-composition-planning.md` defines composition plan records and diagnostics.
- `docs/architecture/runtime-readiness-binding.md` defines runtime capability matching.
- `docs/architecture/execution-plan-preparation.md` defines executable plan candidate preparation.
- `docs/architecture/controlled-conversational-system-execution.md` defines conversational runtime execution when in scope.
- `docs/architecture/asset-implementations-and-packages.md` defines executable/declarative implementation releases, bindings, package trust, and functional defaults.
- `docs/architecture/asset-authoring-and-execution-security.md` defines coding-model, sandbox, UI isolation, and capability-broker boundaries.
- `docs/architecture/persistence-and-storage.md` defines artifact/resource/storage boundaries.
- `docs/architecture/module-dependency-rules.md` defines dependency direction constraints.
