# ADR-0024: System Builder Area and Software Status Placement

- Status: accepted
- Date: 2026-07-16
- Deciders: ai-system-builder maintainers
- Related: `docs/adr/ADR-0005-builder-core-platform-capabilities-and-user-composable-assets.md`, `docs/adr/ADR-0016-asset-kernel-terminology-and-architecture-baseline.md`, `docs/adr/ADR-0020-asset-composition-planning.md`, `docs/architecture/system-builder.md`

## Context

The desktop product used its top-level **System** area for builder-application diagnostics, runtime controls, and host lifecycle state. That product label conflicts with the repository's established meaning of a system: a user-composed Asset Kernel unit assembled from assets, instances, bindings, subsystems, workflows, and other compositions.

Operational software status is global builder-application configuration and diagnostics. A composed system is workspace-owned design-time product data. Keeping both meanings behind the same label makes future contracts, persistence, prompts, and UI behavior prone to drift.

## Decision

### Systems is the System Builder product area

The top-level desktop destination is named **Systems**. It is workspace-scoped and reserved for constructing, validating, and later managing composed systems. Initial UI may be a truthful preparation shell while creation, editing, persistence, and execution capabilities remain unimplemented.

### System Builder specializes the Asset Kernel

`modules/contracts/system-builder` defines the initial design-time record and identity/status vocabulary. A System Builder record:

- belongs to an explicit workspace;
- contains a system or system-of-subsystems `AssetComposition` specialization;
- may reference an existing asset composition plan;
- may later reference a materialized system asset definition;
- contains design-time lifecycle and validation state only.

The contract family must not create parallel asset, binding, runtime-readiness, execution-plan, software-health, persistence, or transport models.

### Software status belongs to Settings

Builder-application diagnostics, host feature lifecycle state, Python runtime controls, ComfyUI install status, repair controls, and resource utilization are labeled **Software status** and live under **Settings**. They remain globally accessible and deferred until the relevant settings section is opened.

### Vocabulary is explicit

- **System** or **composed system** means a user-buildable product-domain composition.
- **System Builder** means the product capability and area used to construct composed systems.
- **Software status**, **builder application**, **desktop host**, and **runtime status** describe operational state of this software.
- **System-owned** and **System Foundation** retain their established ownership/trust meanings; they do not denote software status or a user-built system.

### Systems uses one guided lifecycle

Systems presents **Manage**, **Compose**, **Publish**, and **Run & Test**.
Compose Connections owns the user-facing system relationship workflow; a
separate Systems / Plans page would duplicate that workflow and is removed.
Build & test opens a modal scoped to the exact selected saved revision. Publish
lists application-projected build versions and is the explicit immutable-release
boundary. These placement choices do not merge design, planning, build,
publication, deployment, or runtime authority.

## Consequences

### Positive

- Product navigation matches the repository's Asset Kernel vocabulary.
- Future system contracts and persistence can evolve without inheriting operational status fields.
- Runtime and host diagnostics remain available in a more accurate global location.
- Agents receive a clear rule for distinguishing product systems from builder-application infrastructure.

### Negative

- Existing desktop route keys, lazy-loading tests, diagnostics guidance, and user-facing labels must change together.
- The Systems area initially exposes preparation state rather than complete authoring behavior.
- A future capability increment is still required for repositories, use cases, transports, and editing UI.

## Non-goals

- No system create/update/delete/list operations.
- No System Builder persistence adapter, schema, API, IPC, or preload operation.
- No visual canvas, workflow materialization, runtime execution, marketplace, or collaboration behavior.
- No relocation or renaming of `system.foundation`, system-owned provenance, system prompts, operating-system resources, or other technically correct uses of the word system.
