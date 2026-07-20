# Context Pack: Asset Kernel

- Pack name: `asset-kernel`

## Purpose

- Keep implementation prompts aligned to the canonical Asset Kernel vocabulary.
- Prevent parallel models for assets, artifacts, resources, UI components, workflows, tools, pages, systems, generated outputs, previews, models, datasets, documents, external repository objects, and AI-readable context.

## Use When

Use this pack for tasks involving:

- asset definitions, instances, bindings, compositions, packs, manifests, source metadata, or resolver behavior,
- System Foundation, system/default/user/workspace pack source semantics, or pack activation references,
- Asset Registry or Asset Library list/detail/read-facade behavior,
- resource-backed asset views for artifacts, documents, images, generated outputs, datasets, models, storage/repository objects, or previews,
- asset authoring, user-library reuse, effective projections, composition planning, runtime readiness binding, execution plans, or controlled conversational execution.

## Do Not Use When

- The task is pure host/runtime/storage/UI work with no asset semantics.
- A narrower downstream pack fully covers the asset concern and canonical docs are not needed.

## Core Guidance

- Assets are versioned, configurable, AI-readable, machine-composable semantic units.
- Assets are broader than stored files; artifacts/resources can back assets but are not the full asset model.
- Keep definitions, instances, bindings, compositions, requirements, ports, configuration, AI context, validation, provenance, and lifecycle status distinct.
- Use shared `modules/contracts/asset` vocabulary and family barrels instead of feature-specific asset models.
- Application validation/use cases/facades stay transport-neutral; adapters and hosts compose persistence/provider/runtime seams.
- Asset Registry public reads are read-only and sanitized unless an explicit controlled mutation workflow is in scope.
- Resource-backed views are computed descriptor read models; they must not scan storage, read bytes/content, call providers/network/runtimes, or persist mappings by default.
- Generated outputs become reusable only after explicit finalization/registration; external repository objects become assets only after explicit import/localization/registration.
- Workspace-aware Asset Library reads require explicit workspace context and must not fall back to global records.
- System Foundation availability is by an exact workspace activation reference.
  Existing `system.foundation@1.0.0` activations remain valid; newly created
  workspaces reference `system.foundation@2.0.0`. Workspace creation must not
  install, copy, or seed definitions.
- Executable source, bundles, evidence, and host components live outside Asset Kernel records. Exact implementation releases bind to definitions through ADR-0030 contracts.

## Canonical Asset Terminology

- `Asset`: reusable/composable semantic unit known to AI System Builder.
- `AssetDefinition`: reusable, versioned blueprint/template.
- `AssetInstance`: configured use of a definition in a composition/system context.
- `AssetBinding`: typed connection between instances, ports, resources, runtime capabilities, storage objects, or external objects.
- `AssetComposition`: validated assembly of instances and bindings into a feature, workflow, page, subsystem, system, or system-of-subsystems.
- `AssetReference`: stable transport-neutral reference to an asset or referenceable backing object.
- `AssetConfiguration`: definition-owned configuration surface plus instance-selected values.
- `AssetAiContext`: structured AI-readable metadata for retrieval, validation support, and prompt assembly.
- `AssetPort`: formal input/output/event/control/action/data/error connection point.
- `AssetCompositionRule`: machine-checkable dependency, incompatibility, ordering, cardinality, parent/child, or binding rule.
- `AssetRequirement`: declarative runtime/host/permission/safety/resource/artifact/external-provider requirement.
- `Resource-backed Asset`: asset whose semantic value is backed by a resource/artifact descriptor.

## Current Implementation Shape

- Shared contracts live in `modules/contracts/asset`.
- Pure validation and mapping services live in `modules/application/services/asset`.
- Repository/read/mutation ports live in `modules/application/ports/asset`.
- Transport-neutral use cases live in `modules/application/use-cases/asset`.
- Local JSON persistence adapters live in `modules/adapters/persistence/asset` and store JSON-compatible metadata only.
- Host composition uses internal helpers under `modules/hosts/shared/composition` and must keep runtime roots separate from Asset Kernel records.
- Desktop IPC, server API, preload, renderer, and thin-client surfaces consume read/mutation wrappers rather than local persistence, host helpers, or application services directly.
- `system.foundation@1.0.0` and `system.foundation@2.0.0` are independently
  addressable immutable construction kits. Hosts install both releases and seed
  exact, separate trusted implementation bindings and backing resources. Shared
  Catalog previews are bounded and side-effect free; policy defaults fail closed
  and cannot expand platform authority.
- Only the current release adds definition-owned visual slots. Qualified current
  visual backing bundles contain the real declarative frontend structure,
  bounded named regions, fixtures, and styles interpreted by trusted renderers;
  legacy definitions remain unchanged and backing files are not reduced to
  metadata about absent implementation resources.
- Trusted built-in initialization preserves an existing compatible immutable
  backing-resource record for an exact release. Upgrades may fill missing exact
  resources, but must not overwrite retained release artifacts or digests.
- Preview or resource enrichment must also preserve the exact release's facet,
  runtime, entry-key, and compatibility identity; changing those semantics
  requires a new release instead of rewriting a trusted seed in place.

## Resource-Backed View Rules

- Provider output must be descriptor-only, bounded, deterministic, and sanitized.
- Supported families depend on safe host-composed seams; unsupported families return safe diagnostics.
- Model views may include configured shared model storage descriptors only through the model inventory/read seam; they must not perform arbitrary discovery or read model files.
- Dataset, image, artifact/document, generated-output, and external-object providers must omit paths, storage keys that reveal paths, prompts, workflow payloads, bytes, blobs, base64, tokens, signed URLs, stack traces, commands, env values, provider-native raw payloads, and resource contents.
- Public API/IPC/preload/UI surfaces stay read-only for view reads unless a controlled mutation operation is explicitly selected.

## Controlled Mutation Rules

- Approved controlled workflows are narrow: register resource-backed view, finalize generated output, import external repository object, and localize external repository object.
- Mutation use cases must guard approvals, actor/initiation metadata, capability flags, idempotency, source identity, duplicate checks, validation, and side-effect ports before writes.
- Mutations store sanitized metadata/references only and return retry-safe partial failures.
- Do not add general asset create/update/delete editors, arbitrary pack install/import/export, provider browsing, byte reads, workflow execution, or runtime calls without a canonical scope update.

## Workspace And Pack Rules

- Workspace-owned reads and writes must carry backend-resolvable workspace ids.
- `system.foundation` is the canonical system-trusted default pack; source labels alone do not prove system-default status.
- Workspace packs are not overrides unless explicit override metadata exists.
- Resolver behavior is pure, deterministic, caller-fed, and non-mutating unless a later canonical doc changes that.
- Exact references bypass overrides by default; semantic/default references apply enabled override rules only when explicitly requested.

## Required Docs To Inspect

- `docs/architecture/asset-kernel.md` - canonical terminology and boundaries.
- `docs/adr/ADR-0016-asset-kernel-terminology-and-architecture-baseline.md` - Asset Kernel decision baseline.
- `docs/adr/ADR-0005-builder-core-platform-capabilities-and-user-composable-assets.md` - composable asset/product capability direction.
- `docs/architecture/workspace-model.md` - workspace scope and activation semantics.
- `docs/architecture/user-library-and-cross-workspace-reuse.md` - promote/link/copy/import reuse behavior.
- `docs/architecture/asset-authoring-customization-and-overrides.md` - authored/customized asset and override behavior.
- `docs/architecture/effective-asset-projections.md` - materialized/effective read surfaces.
- `docs/architecture/asset-composition-planning.md` - composition plan semantics.
- `docs/architecture/runtime-readiness-binding.md` - readiness/capability output.
- `docs/architecture/execution-plan-preparation.md` - execution plan output boundary.
- `docs/architecture/controlled-conversational-system-execution.md` - conversational runtime execution when in scope.
- `docs/architecture/asset-implementations-and-packages.md` - executable/declarative release, package, trust, and functional-foundation boundary.
- `docs/architecture/asset-authoring-and-execution-security.md` - untrusted authoring, preview, build, execution, and capability boundary.
- `docs/architecture/persistence-and-storage.md` - artifact/resource/storage boundaries.
- `docs/architecture/module-dependency-rules.md` - dependency direction constraints.

## Companion Packs

- `user-library` for cross-workspace promote/link/copy/import reuse.
- `asset-authoring` for custom asset creation, drafts, revisions, and overrides.
- `effective-asset-projections` for materialized/effective views.
- `asset-composition-planning` for composition plans and diagnostics.
- `runtime-readiness-binding` for runtime capability matching.
- `execution-plan-preparation` for executable plan candidates.
- `controlled-conversational-system-execution` for runnable conversational systems.
- `system-builder` for workspace-owned composed-system records and Systems/Software status placement.
- `persistence-storage`, `desktop-host`, `server-host`, `ipc-electron`, `security`, and `testing` when their boundaries are directly touched.

## Anti-Drift Rules

- Do not create renderer-, IPC-, API-, image-generation-, workflow-, or provider-specific asset vocabularies.
- Do not duplicate persistence/storage/runtime readiness/task-registry concepts inside asset contracts.
- Do not embed code, React components, SQL, routes, source/package bytes, build logs, or implementation evidence in Asset Kernel records.
- Do not treat generated outputs, external repository objects, or previews as registered assets before explicit finalization/import/registration.
- Do not expose raw paths, bytes, provider payloads, prompts, tokens, stack traces, or local storage internals through Asset Kernel metadata or diagnostics.
- Do not turn read-only Asset Library/Registry work into mutation, seeding, import, finalization, provider browsing, scans, runtime execution, or byte/content reads.
- Do not bypass UI/client/transport wrappers by importing application services, host composition, or persistence adapters into renderer/thin-client code.

## Prompt Assembly Notes

- Pair this pack with the narrow task pack that matches the work.
- Read canonical docs when changing architecture, source semantics, workspace scope, mutation behavior, or public transport/UI exposure.
- Keep this pack as stable vocabulary and constraints; implementation-history state belongs in issues, PRs, or release notes, not reusable context.
