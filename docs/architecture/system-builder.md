# System Builder

- Status: current
- Related decisions: `docs/adr/ADR-0005-builder-core-platform-capabilities-and-user-composable-assets.md`, `docs/adr/ADR-0016-asset-kernel-terminology-and-architecture-baseline.md`, `docs/adr/ADR-0020-asset-composition-planning.md`, `docs/adr/ADR-0024-system-builder-area-and-software-status-placement.md`, `docs/adr/ADR-0033-system-builds-releases-security-and-workflows.md`, `docs/adr/ADR-0036-canonical-slot-composition-and-foundation-layouts.md`
- Verification: `docs/architecture/architecture-verification.md`

## Purpose

System Builder is the workspace-scoped product area where users construct systems by composing assets and larger asset compositions. It is not an application-health dashboard and must not become a second asset, planning, runtime, or execution architecture.

The repository implements the revision-safe CRUD and typed composition-editor
boundary accepted by ADR-0033 plus deterministic build attempts and immutable,
content-addressed system releases. A validated design revision is still not a
release, deployment, or running system: build and approval remain explicit
downstream actions.

## Canonical concepts

- **Composed system**: a user-buildable `system` or `system-of-subsystems` Asset Kernel composition.
- **System Builder record**: the workspace-owned design-time aggregate used to identify a composed system and track its construction lifecycle.
- **System composition**: an `AssetComposition` specialization containing system roots, asset instances, bindings, rules, dependencies, provenance, and validation summary.
- **Source composition plan**: an optional reference to the non-executing asset composition plan from which a System Builder record is derived.
- **Materialized system definition**: an optional future reference to a versioned system `AssetDefinition`; the initial contract does not materialize or publish one.
- **Asset slot definition**: an exact definition-owned, named, bounded child region with accepted child rules; slot array order is logical source order.
- **Asset placement**: the revision-owned ordered containment edge from one parent instance and named slot to one child instance. It is separate from typed data/event/control/resource/runtime/dependency bindings.
- **System profile**: an explicit interactive, service, or workflow construction policy. Interactive profiles require one Foundation-derived system root and approved shell/page structure.
- **Legacy-flat structure**: a historical revision with no structure descriptor and no placements. Reads classify it without synthesizing or persisting a hierarchy.
- **Software status**: builder-application, host, runtime, installer, and resource diagnostics. This belongs to Settings and is never part of a System Builder record.

## Contract and data-model baseline

`modules/contracts/system-builder` is the family barrel for the initial baseline:

```ts
SystemBuilderRecord {
  systemId
  targetWorkspaceId
  name
  description?
  status
  revision
  currentRevisionId?
  composition
  sourceCompositionPlanId?
  systemDefinitionRef?
  createdAt
  updatedAt
  createdBy
  updatedBy
  archivedAt?
}
```

Slot-aware revisions add a versioned `SystemBuilderStructure`, canonical
`AssetPlacement` records, and matching composition placement references. The
structure and placement schemas are bounded and transport-neutral. Unknown
schema versions, unsafe IDs, duplicate child parents or positions, self
placement, excessive counts, invalid cardinality, and invalid order fail closed.
The same revision may still contain `AssetBinding` records, whose connection
semantics remain distinct from containment.

Historical revisions omit both additions and remain immutable. A read reports
`legacy-flat`; it never invents placements or writes an upgrade.
`SystemBuilderRevision` is an immutable snapshot containing the composition,
instances, bindings, safe validation issues, actor, and timestamp. Updating a
record requires the caller's expected record revision. Saving a composition
creates a new revision and advances the record atomically; an old revision is
never overwritten.

The composition field narrows the existing Asset Kernel `AssetComposition` to `system` or `system-of-subsystems`. It does not copy its instance, binding, rule, dependency, provenance, lifecycle, or validation vocabularies.

Design-time statuses are `draft`, `in-composition`, `blocked`, `ready-for-validation`, `validated`, and `archived`. These statuses describe construction progress only. They do not mean runtime-ready, execution-ready, healthy, installed, running, stopped, or failed software.

## Ownership and dependency boundaries

- System Builder records are workspace-owned and require explicit workspace identity at every future contract, client, transport, use-case, repository, and persistence seam.
- Asset Kernel definitions, instances, bindings, compositions, and references remain canonical component vocabulary.
- Asset composition planning remains the non-executing compatibility/planning input. A system record may reference a plan but must not mutate the plan or effective asset projections implicitly.
- Runtime readiness, execution plan preparation, and controlled execution remain downstream and separate.
- Software diagnostics must not be persisted into composed-system records or used as their lifecycle status.
- Future application behavior belongs behind focused ports and use cases; UI must not write local files or invent renderer-only system records.

## Product-area placement

**Systems** is a top-level, workspace-required destination. It owns system lists, revision-safe creation/editing, validation, builds, releases, and system-level Run & Test through explicit contracts and use cases. Surfaces must remain truthful while each operation is increment-gated.

General asset composition planning is presented in Systems / Plans as an
input-building workflow. System-specific assembly, record management, and
system-level Run & Test belong in Systems. Assets owns catalog, package import,
authoring, customization, and single-asset Studio workflows.

## Implemented composition boundary

- `modules/application/ports/system-builder` owns the repository seam.
- `modules/adapters/persistence/system-builder` uses structured document stores,
  so local SQLite and managed PostgreSQL receive the same semantics.
- `modules/application/use-cases/system-builder` owns revision-safe lifecycle
  commands; adapters and UI do not invent system truth.
- `ValidateSystemBuilderRevisionService` resolves exact definitions and composes
  canonical Asset Kernel validators with system endpoint, cardinality, and
  dependency-cycle checks.
- `modules/adapters/transport/api-express/system-builder` and
  `modules/adapters/transport/ipc-electron/system-builder` expose the same
  operations. API reads require `asset:read`; mutations require `asset:write`.
- `modules/ui/shared/system-builder` is the shared desktop/thin-client editor.
  It uses native labeled controls and buttons as the complete keyboard path.
- Compose provides a design-time UI preview of the current in-memory instance
  order and applied configuration. The shared modal renders only bounded frontend
  surfaces with registered, side-effect-free System Foundation renderers and
  truthfully reports omitted nonvisual or unsupported assets. It does not execute
  implementation or backend source and grants no build, release, activation, or
  deployment authority.
- `modules/contracts/system-build`, `modules/application/use-cases/system-build`,
  and the matching persistence/storage/transport adapters own deterministic
  attempts and immutable releases without adding runtime state to system
  records.
- Systems / Build & Release freezes an exact revision and deployment profile,
  exposes safe diagnostics and evidence, and requires an explicit integrity-
  verified approval before a release exists.

**Settings / Software status** owns:

- desktop host and feature-lifecycle diagnostics;
- Python runtime status and explicit controls;
- ComfyUI install status and repair controls;
- builder-application resource and readiness diagnostics.

Opening Systems must never trigger these operational reads. Opening Settings or Software status must not create, mutate, validate, or execute a composed system.

## Secured data-entry reference execution

Increment 7 adds one closed, versioned reference template,
`reference.secured-data-entry@1.0.0`. Template creation atomically persists the
system record and its first immutable revision; it does not bypass Asset Kernel
validation or create runtime state.

The corresponding `system-data` application family runs only from one
integrity-verified manifest belonging to an approved release. It fails closed
when the release, manifest, authentication declaration, audit declaration,
field mask, entity, operation, workflow, form, or narrowing role policy is
missing, duplicated, malformed, or bound to another entity. The trusted
application layer allowlists fields and values, enforces action policy, masks
protected fields, bounds reads, and atomically commits optimistic record writes
with append-only redacted audit entries.

Desktop and thin-client Systems pages share the same native-control Run & Test
presenter. API identity comes from authenticated request context, desktop IPC
uses its explicit local trusted principal, and neither renderer can select or
broaden the effective principal. This is a finite built-in release runtime, not
authorization for arbitrary release code, deployment activation, or a second
data/policy architecture.

## Controlled chatbot reference system

Increment 8 adds the closed `reference.controlled-chatbot@1.0.0` template. It
atomically creates and validates a 31-instance Asset Kernel composition using
exact-version shell, conversation, model/context, protected instruction,
bounded generation, narrowing policy, audit, controlled inference, fallback,
and complete-state assets. The template does not create a provider client,
runtime session, execution plan, deployment, or activation.

The existing deterministic build and approval families produce its immutable
release. Systems Run & Test remains a distinct downstream workflow: desktop and
thin client use the same shared presenter, list actual execution plans, and
create an approval-gated conversation session through the existing controlled
conversation clients. Protected instruction values remain behind application
configuration/context boundaries and are absent from public build summaries,
approval results, operational diagnostics, and session summaries. Tools,
retrieval, memory, multimodal IO, streaming, cancel, and retry are not implied.

## Secured data-review reference system

Increment 9 adds the closed `reference.secured-data-review@1.0.0` template and
the release-bound `system-review` application family. The template composes
exact-version shell, artifact browser/filter/detail, masking, audit,
authentication, finite workflow, and explicit text/table/raster-image/PDF/
unsupported preview assets without embedding stored files in Asset Kernel
definitions.

Runtime policy is derived only from one integrity-verified approved release.
The trusted application layer enforces workspace ownership, authenticated
narrowing roles, opaque artifact references, metadata masking, bounded list and
preview quotas, conservative content classification, and redacted audit. The
shared desktop/thin-client Run & Test presenter consumes those safe read models;
it cannot choose a principal, reveal host paths/provider payloads, or turn a
successful build into deployment authority. SVG and Office content remain
unsupported, and malformed, oversized, unavailable, or unauthorized reads fail
closed with safe states.

## Remaining increment-gated gaps

- independent qualified rebuild and higher assurance claims;
- qualified imported/authored execution sandboxes and portable standalone packaging;
- collaboration, permissions, import/export, marketplace, and deployment synchronization.

## Multi-shape deployment handoff

`modules/contracts/system-deployment` and its application, persistence,
runtime, transport, and shared UI families keep operational state separate from
System Builder designs and immutable releases. Install re-verifies release
artifacts and manifest classification, checks the frozen deployment profile,
host API/runtime ABI, implementation trust/runtime facts, required host
capabilities, and sandbox qualification before calling a runtime adapter.

Desktop owns `local-desktop`; server maps campus/corporate to `campus-server`
and cloud to `cloud-server`. The trusted adapter recognizes only the three
closed reference-system kinds and returns a bounded release-bound handoff. Thin
client can install, activate, inspect health/history, roll back, revoke, and
request a server run through authenticated HTTP, but it never receives local
runtime, filesystem, secret, capability, sandbox, organization, or principal
authority. The shared `SystemDeploymentWorkflow` presents these truthful
states in both hosts.

Policy is deny-by-default and can only narrow platform ceilings. Capability,
opaque secret-reference, HTTPS-origin egress, duration, memory, output, and
concurrency checks run before runtime invocation. Activation/readiness failure,
interruption, cancellation, rollback, and revocation preserve explicit safe
state and bounded redacted audit. Imported/authored execution returns
`deployment.sandbox-unavailable` unless a separately qualified adapter is
injected; the managed runner template is operator evidence, not sandbox proof.

Build/release support must not be inferred from design validation, and a release
must not be treated as deployed or running. See
`docs/architecture/system-build-and-release.md`.
