# Asset and System Composition Implementation Roadmap

- Status: planned; successor architecture decisions are required before executable asset, import, and system-build implementation begins
- Existing decision authorities: [ADR-0016](adr/ADR-0016-asset-kernel-terminology-and-architecture-baseline.md), [ADR-0018](adr/ADR-0018-asset-authoring-customization-and-overrides.md), [ADR-0020](adr/ADR-0020-asset-composition-planning.md), [ADR-0023](adr/ADR-0023-controlled-conversational-system-execution.md), and [ADR-0024](adr/ADR-0024-system-builder-area-and-software-status-placement.md)
- Architecture authorities: [Asset Kernel](architecture/asset-kernel.md), [Asset Authoring](architecture/asset-authoring-customization-and-overrides.md), [System Builder](architecture/system-builder.md), [Module Dependency Rules](architecture/module-dependency-rules.md), and [Persistence and Storage](architecture/persistence-and-storage.md)

This document is a supporting delivery plan, not a canonical architecture source.
If it conflicts with an accepted ADR, architecture document, or standard, the
canonical source wins and this roadmap must be corrected.

## Outcome

Deliver an end-to-end Asset Catalog, Asset Studio, and System Builder in which a
user can:

1. browse system-default, organization-managed, imported, user-library, and
   workspace-authored assets;
2. inspect each asset's interface, implementation availability, compatibility,
   permissions, provenance, versions, and usage;
3. import a reviewed package without allowing untrusted code to execute during
   inspection or installation;
4. create an asset manually or with a coding model;
5. customize an asset through an override, linked customization, or detached
   derivative while preserving lineage;
6. compose configured asset instances into reusable features, pages,
   subsystems, systems, and systems of subsystems;
7. validate typed ports, configuration, data models, security policy,
   implementation compatibility, runtime readiness, and deployment shape;
8. build an immutable, reproducible system release with resolved asset
   implementations, UI and logic bundles, required data migrations, tests,
   SBOM/provenance evidence, and safe diagnostics;
9. preview and run the release through supported desktop and server hosts, with
   thin clients using server-owned execution; and
10. revise the source assets or system composition and produce a new version
    without mutating previously published releases.

The first complete release must prove this outcome with three reference systems:

- a secured data-entry application built from a data model, form, page, shell,
  validation, persistence-operation, workflow, and access-policy assets;
- a chatbot built from chat UI, conversation, model-reference, instruction,
  inference, approval, error-handling, and shell assets; and
- a data-review application built from artifact selection, metadata,
  tabular/text/image/PDF preview, filtering, security, audit, page, and shell
  assets.

## Product ownership

The product areas must have distinct responsibilities even when they share the
Asset Kernel underneath.

| Product area               | Owns                                                                                                                                               | Does not own                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Asset Catalog              | Browse, filter, inspect, compare, import, install, and locate reusable assets                                                                      | Whole-system assembly, deployment, or operations                                       |
| Asset Studio               | Create, customize, implement, preview, contract-test, version, and publish one asset or reusable composite feature                                 | Running a complete system or representing software health                              |
| System Builder             | Create systems, add configured asset instances, bind ports, arrange pages/features/subsystems, validate, build, test, version, and release systems | Editing the source implementation of an asset or displaying builder-application status |
| Settings / Software status | Host, runtime, storage, installer, provider, and builder-application diagnostics                                                                   | User system design-time state                                                          |

`Plans` and whole-system `Run & Test` workflows currently surfaced under Assets
move into System Builder. Asset Studio retains only single-asset preview,
contract tests, mocked integration tests, and reusable-composite validation.

## Non-negotiable architecture rules

1. `AssetDefinition` remains the semantic **what**: configuration, ports,
   requirements, composition rules, AI context, lifecycle, and provenance.
2. Executable code, runtime objects, raw paths, credentials, provider payloads,
   and functions never become Asset Kernel metadata or configuration values.
3. A separate implementation/release family represents **how** an asset works.
   Source and compiled bundles live in artifact/object storage; structured
   records retain safe references, hashes, compatibility, and evidence.
4. `AssetInstance` remains a configured use of a definition. A definition or
   implementation release is never mutated to represent one system's settings.
5. `AssetComposition` remains the common graph. System Builder specializes it
   rather than creating a second page/feature/workflow graph vocabulary.
6. Workspace and organization context propagate through contracts, clients,
   transports, use cases, ports, persistence, storage, build jobs, and runtime
   invocation. UI selection alone is never an authorization boundary.
7. System-default implementations may be precompiled and host-trusted.
   Imported and workspace-authored implementations remain sandboxed unless an
   explicit administrator promotion policy grants a narrower trusted status.
8. A signature establishes identity and integrity, not safety. Import admission
   also requires compatibility, policy, dependency, permission, and validation
   checks.
9. Security assets configure system-level requirements and host-enforced policy.
   They cannot replace, bypass, or weaken platform authentication,
   authorization, organization isolation, audit, secret handling, route policy,
   CSP, or runtime sandboxing.
10. A published asset advertised as usable must have either a compatible
    implementation binding, a valid resource backing, or an explicitly
    supported declarative host engine. Structural-only records remain drafts or
    are labeled `contract-only`; they are not presented as ready components.
11. Read operations do not install packages, start runtimes, call coding models,
    or execute asset code.
12. Desktop and thin-client surfaces expose the same domain behavior through
    IPC/API clients and shared presenters without importing adapters or host
    composition into UI code.

## Decision checkpoints

The following decisions must be accepted before their dependent increments can
claim implementation authority.

| Decision                  | Required resolution                                                                                                                                             | Dependent increments |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Executable asset boundary | Definition-to-implementation relationship, implementation facets, immutable release/version rules, compatibility resolution, revocation, and evidence           | 1 onward             |
| Package and import trust  | Package manifest, content addressing, signature/provenance policy, quarantine, conflict handling, install/activation, update, rollback, and organization policy | 2 onward             |
| Sandboxed execution       | Supported UI and logic isolation mechanisms, capability broker, resource limits, egress, secret mediation, cancellation, and host-specific containment          | 1, 3, 6 onward       |
| Coding-model authoring    | Model/provider-neutral port, permitted context, source-workspace boundary, tool permissions, dependency policy, review/approval, and provenance                 | 3 onward             |
| System build and release  | Meaning of buildable, build inputs/outputs, implementation resolution, reproducibility, release identity, migration inclusion, signing, and run/deploy handoff  | 5 onward             |
| Foundation-pack evolution | Versioning and workspace activation strategy for new definitions and implementation bindings; compatibility with `system.foundation@1.0.0`                      | 4 onward             |
| Security-asset authority  | Allowed declarative security policies, enforcement ownership, deny-by-default behavior, non-overridable platform controls, and unsafe composition rejection     | 4 onward             |
| Workflow execution scope  | Initially supported triggers/actions/control flow, transactional boundaries, retries, idempotency, approvals, and unsupported behavior                          | 4, 6 onward          |

Each decision requires a successor ADR or an accepted amendment, updates to the
owning architecture docs, a decision-readiness register update, and the narrow
context-pack corrections required by those canonical changes.

## Target record and service model

Names in this section are candidate role names for decision and implementation;
they do not supersede existing contracts before the executable-asset ADR is
accepted.

### Implementation records

- `AssetImplementationDraft`
  - workspace-owned source state and requested implementation facets;
  - safe references to source snapshots and coding-model generation records;
  - never selected for a published system release.
- `AssetBuildRecord`
  - immutable input snapshot, toolchain identity, status, safe diagnostics,
    output references, test/security evidence, and timestamps;
  - build logs remain sanitized and bounded.
- `AssetImplementationRelease`
  - immutable definition reference, implementation version, facet descriptors,
    package references/digests, supported host profiles, requested capabilities,
    provenance, evidence, trust state, lifecycle, and revocation state.
- `AssetImplementationFacet`
  - one of `ui`, `logic`, `tool`, `workflow`, `test`, or another accepted finite
    kind;
  - logical entrypoint/export identity, typed port mapping, runtime target,
    compatibility, and requested capabilities;
  - no host filesystem path or executable payload in the record.
- `AssetImplementationBinding`
  - associates an asset definition/version range with an implementation release
    and host/deployment selectors;
  - resolution is deterministic, policy-aware, and produces explainable
    incompatibility diagnostics.
- `AssetPackageManifest`
  - definition and implementation references, digests, dependencies, SBOM,
    provenance/signature references, compatibility, and install policy metadata;
  - package bytes remain artifact/object-storage content.

### System records

- `SystemBuilderRecord`
  - workspace-owned design record around an `AssetComposition` specialized to
    `system` or `system-of-subsystems`.
- `SystemBuildRequest`
  - immutable composition revision, effective asset projections, selected
    deployment profile, safe configuration references, and approval identity.
- `SystemBuildRecord`
  - normalized inputs, resolved implementations, validation results, build
    status, evidence, outputs, and safe diagnostics.
- `SystemRelease`
  - immutable composition snapshot, resolved implementation manifest,
    configuration schema, UI/logic bundles, migration references, provenance,
    evidence, compatibility, and release signature/reference.
- `SystemDeploymentBinding`
  - later mapping from a release to a host-owned runtime/deployment placement;
  - deployment status remains separate from the design record.

### Required application seams

- catalog/read facade and source/trust filters;
- import inspection, admission, installation, activation, update, disable, and
  removal use cases;
- implementation draft/source repository and artifact-storage ports;
- coding-model planning/generation port and scoped tool broker;
- build executor, contract validator, dependency/security analyzer, and evidence
  repository ports;
- implementation resolver and compatibility policy;
- system CRUD, composition mutation, validation, build, release, and read-model
  use cases;
- capability broker for asset UI/logic communication;
- host-owned sandbox/runtime invocation and cancellation ports.

Application services own orchestration and policy. Adapters implement storage,
build, package verification, sandbox, provider, and runtime details. Hosts select
adapters and deployment profiles. Transports expose typed use cases. UI consumes
sanitized read models and commands.

## Asset taxonomy and minimum functional foundation

The taxonomy remains based on Asset Kernel types, families, ports, and
composition rather than renderer-specific classes. The following product groups
are catalog facets and authoring templates, not parallel domain models.

| Group                    | Minimum simple assets                                                                                                                                            | Required functional behavior                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Data model               | scalar field, enum, entity, relationship, validation rule, computed field, query, filter, sort, pagination, datasource binding                                   | Validate configuration; expose typed record/query ports; produce migration/schema intent; enforce workspace/organization context         |
| Security and policy      | authenticated-user requirement, role requirement, permission rule, field visibility/masking, approval gate, audit event, route policy reference                  | Compile to host-enforced policy; reject missing enforcement; deny by default; never replace platform security                            |
| System shell             | application shell, header, sidebar, navigation, route outlet, page header, workspace context, notification/status region, theme tokens                           | Render in desktop and thin client; navigate declared pages; maintain accessible layout and responsive behavior                           |
| Page and layout          | page, section, stack, grid, panel, card, tabs, modal, toolbar, empty/loading/error state                                                                         | Render through trusted default implementations; accept child/content/action ports; preserve accessibility                                |
| Forms and input          | form, field group, text, number, select, checkbox, date/time, file/artifact selector, validation summary, submit/cancel action                                   | Bind to data model; validate; display field errors; submit through typed action ports; never call persistence directly from UI           |
| Data display and preview | text, key/value, table, detail, image, PDF, video/audio placeholder, metadata, artifact preview, pagination/filter controls                                      | Use authorized descriptor/content-read seams; bound previews; safe unsupported states; no raw paths or provider payloads                 |
| AI model and context     | model reference, model selector, instruction template, generation settings, embedding/reference context, conversation policy, inference action                   | Resolve through model inventory/readiness; keep credentials/provider details host-owned; expose typed request/result ports               |
| Chat and conversation    | transcript, message, composer, assistant response, conversation session, approval, retry/cancel availability, error/fallback display                             | Use controlled conversational execution; preserve approval and source verification; sanitize operational diagnostics                     |
| Logic and workflow       | user/event trigger, sequence, condition, switch, transform, validate, create/read/update operation, model call, tool call, approval, retry policy, error handler | Execute only supported finite operations through application/runtime ports; typed data flow; idempotency and cancellation where declared |
| Feature composites       | data-entry/CRUD feature, chatbot feature, artifact/data-review feature, model-assisted form feature                                                              | Remain reusable AssetCompositions built from simple assets; publish with dependencies, configurable slots, tests, and lineage            |
| Resource-backed          | artifact, document, image, dataset, model, external repository object                                                                                            | Explicit register/import/localize/finalize lifecycle; safe descriptors; resource bytes remain in storage                                 |
| Integration and adapter  | HTTP/API connector, approved tool connector, persistence binding, runtime binding                                                                                | Host-owned credentials and egress policy; typed contracts; health/readiness separate from asset metadata                                 |
| Test and observability   | fixture, mock port provider, assertion, accessibility check, audit expectation, metric/log event declaration                                                     | Run in build/test environments; produce bounded evidence; never expose secrets or protected content                                      |

### Default implementation requirement

Every system-default asset intended for active use must include:

- a complete semantic definition with configuration, ports, requirements,
  composition rules, AI context, provenance, and examples;
- one or more compatible implementation releases or a named trusted host engine;
- desktop and thin-client behavior where the capability is user-facing;
- mocked preview support in Asset Studio;
- contract, accessibility, empty/loading/error, and security tests appropriate to
  the asset;
- safe compatibility/readiness diagnostics;
- version, dependency, SBOM/provenance, and implementation-binding evidence; and
- at least one reference composition proving real use.

Existing declarative-only defaults remain valid semantic inputs, but are not
called functional until these requirements are met.

## Dependency order

| Increment | Outcome                                                                                  | Depends on            |
| --------- | ---------------------------------------------------------------------------------------- | --------------------- |
| 0         | Accepted decisions, threat model, canonical architecture, and vertical-slice plan        | Existing architecture |
| 1         | Executable asset implementation kernel and safe persistence/storage                      | Increment 0           |
| 2         | Unified catalog, package inspection/import, trust, and implementation resolution         | Increment 1           |
| 3         | Asset Studio creation, customization, implementation, preview, and coding-model workflow | Increments 1-2        |
| 4         | Functional system-default primitive assets across the minimum taxonomy                   | Increments 1-3        |
| 5         | System Builder CRUD and typed composition editor                                         | Increments 1-4        |
| 6         | System validation, implementation resolution, build, and immutable release pipeline      | Increments 1-5        |
| 7         | Forms and secured data-entry reference feature/system                                    | Increments 4-6        |
| 8         | Chatbot reference feature/system                                                         | Increments 4-6        |
| 9         | Data preview and review reference feature/system                                         | Increments 4-6        |
| 10        | Multi-shape runtime, packaging, deployment handoff, and parity                           | Increments 6-9        |
| 11        | Hardening, compatibility, recovery, performance, and support qualification               | All prior increments  |

Increments 7-9 may proceed in parallel after Increment 6, but each must remain a
complete vertical slice across contracts, application behavior, adapters, hosts,
transports, desktop/thin-client UI, documentation, and tests.

## Increment 0: Decisions, threat model, and architecture baseline

- Status: implemented and verified
- Purpose: convert the decision checkpoints into accepted, bounded architecture
  and select the first reference slice without silently broadening current ADRs.
- Deliverables:
  - current code/document mismatch audit for Asset Library, authoring, plans,
    System Builder, runtime readiness, execution planning, and conversation run;
  - successor ADRs for executable assets, package/import trust, sandboxing,
    coding-model authoring, system builds/releases, security-asset authority,
    workflow scope, and foundation-pack evolution;
  - threat model for imported code, coding agents, dependency supply chain,
    package parsing, UI rendering, backend execution, capability brokerage,
    cross-workspace/organization access, and build/deployment credentials;
  - canonical target-state updates and context-pack routing updates;
  - implementation vocabulary, compatibility/version policy, and deprecation
    policy;
  - one thin vertical-slice plan: trusted text-input asset -> form composite ->
    page -> system -> validated build -> runnable preview.
- Research requirement:
  - revalidate current Electron, Node, browser sandbox/CSP, WASI or selected
    sandbox runtime, SLSA/Sigstore, package ecosystem, and AI coding security
    guidance before accepting runtime and package choices.

### Increment 0 implementation plan and evidence

1. Audit the current UI and code boundaries against the roadmap.
2. Revalidate primary security, package, runtime, and coding-agent guidance.
3. Accept successor decisions before implementation.
4. Record the target architecture, threat model, compatibility/deprecation
   policy, context routing, and first thin slice.
5. Run documentation, agent-support, architecture, and formatting checks.

Current mismatch audit:

| Surface                 | Current evidence                                                                        | Required correction                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Asset Library/Catalog   | Read-only registry/library plus resource-backed views; definitions may be semantic-only | Add truthful implementation/trust/compatibility/readiness summaries and package lifecycle             |
| Asset authoring         | Definition drafts/customizations/overrides are metadata-focused                         | Add separate source, implementation draft/build/release, review, test, and publish workflow           |
| Asset Plans             | Planning, readiness setup, and execution previews are hosted in Assets                  | Move system-specific composition and Run & Test to Systems while preserving shared contracts          |
| System Builder          | Contract baseline and preparation page only                                             | Add workspace-scoped revisions, CRUD/editor, validation, build, release, and shared clients           |
| Runtime readiness       | Safe non-executing capability matching exists                                           | Extend inventories for implementation/build/sandbox capabilities without adding side effects to reads |
| Execution planning      | Safe non-runnable previews exist                                                        | Bind approved immutable system releases and exact implementation locks downstream                     |
| Conversation Run & Test | Controlled text-generation slice exists                                                 | Recompose it from reusable assets and keep runtime records operational                                |

Accepted authorities:

- ADR-0030: executable asset implementation drafts/builds/releases/bindings;
- ADR-0031: non-executing package inspection, trust, admission, activation, and rollback;
- ADR-0032: isolated coding-model workflow, UI/logic sandbox, and capability broker;
- ADR-0033: system revisions, deterministic builds/releases, composed security, and finite workflows;
- ADR-0034: versioned functional foundation assets.

Compatibility policy uses independently versioned definition contracts,
implementation releases, package format, host API, runtime ABI, system-release
format, and data schemas. Frozen builds use exact versions and digests. A
breaking contract publishes a new major version; deprecation supplies a
replacement and support window but never rewrites an existing lock. Revocation
blocks new resolution/activation and is recorded separately from immutable
history.

The first thin slice is fixed as: trusted `text-input` definition and UI facet ->
form-field composite -> form/page composition -> system revision -> validation ->
deterministic build/release -> trusted preview. It uses an in-memory authorized
submit capability first, then the secured data-entry slice adds durable data.

- Exit evidence:
  - all required ADRs are accepted or the roadmap is narrowed to only accepted
    decisions;
  - decision-readiness has no `decision-required` item crossed by Increment 1;
  - docs and agent-support checks pass;
  - security review approves the first vertical-slice trust boundary.

## Increment 1: Executable asset implementation kernel

- Status: implemented and verified
- Purpose: add implementation drafts, builds, immutable releases, facets,
  bindings, evidence, and deterministic resolution without polluting semantic
  asset contracts with executable payloads.

### Increment 1 implementation plan

1. Add normalized contracts for drafts, source snapshots, builds, immutable
   releases, facets, compatibility, bindings, revocations, safe summaries, and
   deterministic resolution.
2. Add repository, artifact, builder, validation, publication, binding,
   resolution, disable, and revocation application seams.
3. Persist safe records through the deployment-selected structured-document
   store so SQLite and PostgreSQL share repository semantics; keep bytes behind
   a focused artifact port over object storage.
4. Compose exact trusted built-in implementation bindings for desktop and
   server without importing host code into contracts/application code.
5. Expose safe read-only API and IPC/preload/client operations.
6. Verify normalization, immutability, conflict handling, compatibility,
   ambiguity, downgrade, revocation, organization/workspace isolation, storage
   containment, host parity, and no-byte/no-path/no-secret DTO behavior.

Research notes: existing Asset Kernel repositories establish the application
port/use-case pattern; the deployment-shaped `StructuredDocumentStore` already
provides SQLite/PostgreSQL organization isolation, optimistic revisions, and
transactions; the artifact object-storage port already provides contained,
checksummed filesystem/object semantics. Increment 1 reuses those seams rather
than creating a second database or blob subsystem. OCI digest identity and SLSA
evidence conventions follow the Increment 0 primary-source research.

### Increment 1 implementation evidence

- The normalized contract family is implemented under
  `modules/contracts/asset-implementation/` and exported through API and IPC
  contract barrels.
- Application ports, safe read-model validation, deterministic resolution, and
  lifecycle use cases are implemented under
  `modules/application/{ports,services,use-cases}/asset-implementation/`.
- Records use the organization-scoped `StructuredDocumentStore`; immutable
  bytes use the existing checksummed object-storage port through a contained,
  digest-addressed adapter. No raw source, package bytes, storage keys, local
  paths, or secrets enter public summaries.
- Desktop and server host compositions seed the same exact, system-trusted
  built-in implementation only after the semantic foundation definition is
  installed. Server route calls await initialization, preventing a startup
  race.
- Safe list and resolution reads have Express, Electron IPC, preload, and
  thin-client clients. Server routes have explicit `asset:read` policy.
- Focused contract, resolver, structured-persistence isolation, artifact
  integrity, host parity, transport parity, and route-policy tests pass. The
  trusted sample resolves for local-desktop and campus-server profiles, while
  an unimplemented definition remains truthfully unavailable.
- Deliverables:
  - accepted contract family and family-barrel invariants;
  - application repository, artifact, build, validation, resolver, and revocation
    ports;
  - use cases for draft creation, source snapshot, build request, validation,
    publication, binding, resolution, disable, and revocation;
  - SQLite and PostgreSQL structured persistence for safe records;
  - filesystem/object-storage implementations for source/package/evidence bytes;
  - host composition for trusted built-in implementation lookup and sandboxed
    implementation candidates;
  - safe API/IPC/preload/client read surfaces for implementation summaries;
  - status vocabulary that distinguishes semantic definition, resource-backed,
    implementation-ready, incompatible, setup-required, blocked, and revoked.
- Minimum verification:
  - contract normalization and malformed-input tests;
  - immutable-release and conflict tests;
  - deterministic resolution, ambiguity, incompatibility, revocation, and
    downgrade tests;
  - SQLite/PostgreSQL semantic conformance and organization/workspace isolation;
  - storage-key containment and no-path/no-secret read-model assertions;
  - host composition and API/IPC parity tests.
- Exit evidence:
  - a trusted sample asset definition resolves to a real implementation in both
    desktop and server composition;
  - an unimplemented definition remains visible but truthfully unavailable;
  - code/package bytes never appear in Asset Kernel records or public DTOs.

## Increment 2: Catalog, import, trust, and reuse

- Status: implemented and verified
- Purpose: give users one truthful catalog for system defaults, organization
  assets, imports, user-library assets, and workspace-authored assets.
- Deliverables:
  - source, ownership, trust, implementation-shape, compatibility, lifecycle,
    and readiness filters;
  - asset detail tabs for Overview, Interface, Implementation, Preview & Tests,
    Versions & Trust, and Usage;
  - package inspect/dry-run that performs no code execution or install side
    effects;
  - quarantine, signature/provenance verification, digest/SBOM/dependency scan,
    manifest/schema validation, capability review, conflict preview, admission,
    install, activation, update, disable, and rollback workflows; destructive
    removal remains deferred because ADR-0031 requires retention checks across
    active bindings, system releases, and audit policy;
  - explicit workspace import, user-library link/copy/promote, and
    organization-managed activation behavior aligned with existing provenance;
  - malicious archive, traversal, oversized content, duplicate identity,
    unsupported runtime, revoked signer, dependency, and downgrade defenses;
  - desktop/thin-client parity through shared read models and commands.
- Scope guard:
  - begin with local files and an organization-approved internal source;
  - public marketplace discovery, ratings, billing, and automatic updates remain
    outside scope until separately decided and qualified.

### Increment 2 implementation plan

1. Define a versioned, bounded `.aisb-package` container, safe inspection DTOs,
   quarantine/admission/install/activation records, trust evidence, and commands.
2. Implement a pure inspector that calculates the package digest before parsing,
   never executes content, validates normalized entry paths and declared
   digests, and enforces file-count, per-entry, total-expanded-size, encoding,
   manifest, capability, dependency, compatibility, and duplicate limits.
3. Add pluggable signature/provenance/dependency-verification ports and a
   fail-closed admission policy. Unsigned content can only become
   workspace-approved through an explicit authorized decision; it is never
   inferred trusted from its source label.
4. Persist lifecycle and activation records through `StructuredDocumentStore`
   and bytes through the existing immutable implementation artifact adapter.
   Install exact semantic definitions and implementation releases without
   overwriting same-identity/different-content records.
5. Expose inspect, admit/install, list, activate, disable, and rollback through
   safe API/IPC/preload/thin-client clients, with explicit route scopes.
6. Add Catalog package/trust/readiness filters and a package-management surface
   shared by desktop and thin client. Preserve existing library browse and reuse
   behavior.
7. Verify no-execution inspection, traversal/device/duplicate/oversize/encoding
   attacks, digest and evidence failures, authorization/scope isolation,
   idempotent retry, interrupted admission, activation rollback, downgrade and
   revocation denial, transport parity, accessibility, and safe DTOs.

Research notes: OCI descriptors establish content-addressed digest/media-type/
size semantics and require unknown content to remain opaque. Sigstore bundles
carry verification material and signed content, but identity and artifact digest
claims must still be checked against configured expectations. SLSA 1.2 treats
provenance as verifiable evidence evaluated against an explicit trust policy,
not as an automatic safety claim. OWASP upload guidance requires allowlisted
types, generated storage names, size limits, quarantine, and defenses against
parser exploits, traversal, active content, and archive expansion attacks. The
first container is therefore bounded JSON with uncompressed base64 entries;
unknown compression and links are rejected rather than invoking a general
archive extractor. An OCI registry can later transport the same descriptor
graph without changing application use cases.

Implementation evidence:

- `.aisb-package` v1 contracts and the bounded JSON inspector reject malformed
  encodings, traversal/device paths, normalized/case-colliding duplicates,
  unsupported media/runtime kinds, excessive entry/expanded sizes, and digest
  mismatches without loading or executing an entry;
- immutable quarantine bytes, inspection/package records, signature,
  provenance and SBOM evaluation, exact capability consent, same-identity
  non-overwrite, install, activation, disable, and rollback are composed for
  desktop and server hosts;
- scoped API/IPC routes, preload and desktop/thin clients preserve safe
  envelopes and route policy; organization-aware document/storage wrappers
  preserve the existing managed-host tenant boundary;
- desktop and thin-client Assets pages share an accessible three-step package
  manager with explicit empty, loading, error, trust, evidence, capability, and
  lifecycle states; and
- focused contract, inspector, storage, lifecycle, malicious-input, transport,
  security-policy, and shared-UI tests pass. Public marketplace discovery,
  automated updates, package removal, and registry transport remain explicitly
  outside this increment.
- Minimum verification:
  - no-execution inspection tests;
  - signature/digest/provenance and conflict-policy tests;
  - package traversal/zip-bomb/resource-limit tests;
  - cross-workspace/organization denial and same-ID non-overwrite tests;
  - import interruption, retry, rollback, and revocation tests;
  - catalog accessibility, empty/error/loading, filter, and parity tests.
- Exit evidence:
  - a reviewed package can be inspected, admitted, installed, activated, found,
    and safely disabled without executing during browse/import;
  - catalog readiness accurately reflects available implementation bindings.

## Increment 3: Asset Studio and coding-model implementation workflow

- Status: implemented and verified through reviewed immutable source snapshot;
  sandboxed build, preview, and publication remain fail-closed pending a
  qualified adapter
- Purpose: replace metadata-only authoring with a guided studio that can produce
  complete definitions and tested implementation releases.
- Deliverables:
  - ordered authoring flow for purpose/type, interface/configuration, ports and
    composition rules, implementation facets, permissions/dependencies, tests,
    and publication;
  - create-from-scratch, customize-linked, override, detached-copy, and
    create-from-template paths with explicit lineage;
  - source workspace separated from the AI System Builder repository and from
    published packages;
  - TypeScript-first editor/templates with schema-aware configuration and port
    assistance;
  - provider-neutral coding-model use case that consumes a bounded context pack
    and produces a plan plus patch in an isolated workspace;
  - dependency allowlist/verification, no-production-secret policy, default-deny
    network, tool allowlist, resource limits, action audit, and cancellation;
  - diff review, typecheck, format, lint where configured, unit/contract/security
    tests, dependency audit, preview, and explicit human publication approval;

### Increment 3 implementation plan

1. Add an `asset-studio` contract family for bounded source files, dependency
   declarations, provider-neutral generation requests, plans, patch proposals,
   review decisions, validation evidence, and immutable workflow records. Keep
   source content outside Asset Kernel records.
2. Add a coding-model port that can only return structured plans and file
   patches. It receives allowlisted context, has no shell, persistence, network,
   secret, activation, or publication capability, and is fail-closed when a
   host has no configured provider.
3. Validate proposal paths, extensions, content sizes, dependency allowlists,
   capability changes, secret-like content, and exact source revision before a
   human can approve a patch. A stale proposal or changed permission set
   invalidates approval.
4. Store workflow records in organization-aware structured persistence and
   approved source through the immutable implementation artifact seam. Connect
   approved source to the existing implementation draft/build/release kernel;
   do not execute source during planning, generation, review, or snapshotting.
5. Expose plan, propose, review, validate, snapshot, and status operations
   through scoped API/IPC clients and add a shared ordered Asset Studio flow for
   desktop and thin client. Manual TypeScript/declarative editing and coding-
   model-assisted editing use the same review and evidence gates.
6. Qualify traversal, stale approval, prompt-injection-shaped context, secret,
   dependency, capability escalation, size/timeout/cancellation, workspace and
   organization isolation, safe diagnostics, transport parity, accessibility,
   and no-execution behavior.

Research notes: NIST SSDF and the NIST DevSecOps reference guidance require
human and automated oversight of AI-generated code plus verifiable evidence;
generated suggestions must not be accepted uncritically. OWASP agent guidance
requires least-privilege, schema-validated tool calls, explicit approval for
high-risk actions, bounded cost/retries, and separation of decision from
execution. OWASP prompt-injection guidance treats repository documents and code
comments as untrusted context and recommends validating proposed actions
against the original user intent. GitHub's coding-agent controls reinforce
isolated workspaces, narrow credentials, protected publication, required
checks, and human review. This increment therefore treats a coding model as an
unprivileged patch-proposal service; only application use cases can persist an
approved immutable snapshot, and build/publication remain independent gates.

Implementation evidence:

- `asset-studio` contracts, a provider-neutral no-tool coding-model port,
  bounded request/proposal validators, organization-aware workflow persistence,
  immutable proposal artifacts, exact human review, and source snapshots extend
  the existing implementation kernel;
- safe path/type/count/size, dependency, capability, duplicate, secret-like
  content, exact-definition, stale-revision, timeout, tamper, and unavailable-
  provider paths fail closed before publication or execution;
- start, propose, read, list, approve, and reject operations have scoped
  API/IPC/preload/desktop/thin-client seams and authenticated actor assignment;
- the shared desktop/thin-client Studio uses the same ordered contract, propose,
  complete diff review, approval, and build-gate UX; and
- focused workflow, prompt-injection-shaped context, persistence, transport,
  route-policy, shared UI, typecheck, and thin-client build checks pass.

No untrusted source is built or executed by this increment. Manual source is
fully reviewable and snapshot-capable; coding-model assistance becomes
available only when a host supplies the narrow port. A qualified isolated asset
implementation builder remains required before build, preview, or publication
can be enabled. Increment 6 consumes already-published exact implementation
releases for deterministic system builds; it does not substitute for that
asset-implementation sandbox. Increment 10 preserves `sandbox-unavailable` for
authored/imported execution, so the Studio displays these gates as blocking.

- source/model/toolchain/prompt-template/test/approver provenance without
  storing protected prompts or provider payloads in general records;
- desktop and thin-client Studio parity, with builds and privileged execution
  remaining host/server-owned.
- Minimum verification:
  - definition and implementation draft lifecycle tests;
  - customization/rebase/conflict and immutable-source tests;
  - agent scope, context minimization, path containment, egress, credential, tool,
    timeout, cancellation, and out-of-scope edit tests;
  - dependency hallucination/nonexistent package and vulnerable version tests;
  - diff approval and independent negative-test gates;
  - preview sandbox and message-contract tests.
- Exit evidence:
  - a user can create or customize a simple asset, manually implement it or ask
    a coding model for a patch, review all changes, pass gates, publish an
    immutable implementation release, and find it in Catalog;
  - the coding model cannot publish, activate, deploy, access secrets, or modify
    the product repository directly.

Current boundary: the second exit criterion is verified. The first is verified
through complete review and immutable source snapshot only; isolated build,
preview, publication, and resulting Catalog implementation availability remain
blocked until the sandbox qualification described above is supplied.

## Increment 4: Functional system-default asset foundation

- Status: implemented and verified
- Purpose: turn the existing semantic foundation into a practical construction
  kit while preserving host-neutral definitions.
- Delivery order:
  1. layout, shell, page, status, button, and basic display primitives;
  2. data types, entities, fields, relationships, validation, query, and binding;
  3. form and input primitives;
  4. security/policy and audit primitives;
  5. artifact/data display and preview primitives;
  6. AI model/context and chat/conversation primitives;
  7. finite logic/workflow primitives;
  8. test, mock, and observability declarations.
- Deliverables for every default:
  - semantic definition and examples;
  - trusted implementation release/binding or supported declarative engine;
  - desktop and thin-client implementation where applicable;
  - configuration renderer/editor support;
  - preview fixtures and contract tests;
  - accessibility and responsive behavior for UI assets;
  - permission/capability/readiness requirements;
  - safe error, loading, empty, and unsupported states;
  - versioned pack manifest, compatibility, provenance, and activation behavior.

### Increment 4 implementation plan

1. Preserve the existing 63-definition semantic foundation and extend it only
   where the delivery taxonomy has a real gap: data/schema/query, security and
   audit, artifact/data preview, AI context/model, finite logic, test/mock, and
   observability assets plus composed record-form and data-preview features.
2. Add a closed, versioned functional-default catalog that maps every exact
   foundation definition to one trusted built-in or declarative-engine entry,
   facet kind, deployment-profile compatibility set, preview fixture, and
   fail-closed security posture. Keep React components, functions, source, SQL,
   routes, and bytes out of Asset Kernel records.
3. Publish and bind the catalog through the existing implementation kernel
   after the immutable `system.foundation` manifest is installed. Resolve every
   binding with the same deterministic trust, compatibility, disable, and
   revocation rules used by imported implementations.
4. Implement one shared accessible foundation preview surface for desktop and
   thin client. Use native form/table/status semantics, explicit loading,
   empty, error, and unsupported states, and registry-owned renderers instead
   of definition-provided components.
5. Add conformance tests proving that every manifest entry has exactly one
   functional descriptor, a resolvable release on all supported profiles, a
   bounded preview, valid typed ports/configuration, and no capability or
   platform-authority escalation. Add semantic UI tests for the construction
   kit's form, data, conversation, and fail-closed policy representatives.
6. Reconcile the foundation manifest, implementation/package architecture,
   System Builder guidance, context packs, and roadmap evidence; run focused
   tests, typechecks, architecture and documentation gates before Increment 5.

Research notes: W3C WAI guidance recommends native HTML controls and labels
before ARIA substitutes, keyboard-operable patterns, and explicit field-level
success/error notifications. JSON Schema 2020-12 provides the portable
validation vocabulary for configuration and data-shape declarations, while
OpenAPI 3.1 aligns its Schema Object with that vocabulary. This increment
therefore uses host-neutral schema/port declarations and a closed platform
renderer/declarative-engine registry. Definitions describe meaning and
constraints; trusted host code owns rendering and capability mediation.

Implementation evidence:

- `system.foundation@1.0.0` now contains 87 immutable definitions across UI,
  form, display/state, shell, conversation, data-model, security/audit,
  artifact/data preview, AI context/model, finite logic, test/observability,
  and reference-feature categories;
- every exact manifest entry has one closed functional descriptor, bounded
  preview fixture, compatible implementation facet, and trusted built-in or
  declarative-engine release/binding across local desktop, campus server,
  cloud server, and thin-client profiles;
- shared desktop/thin-client Catalog details render accessible no-side-effect
  form, table, conversation, state, workflow, policy, layout, or semantic
  previews, with a truthful unsupported state outside the closed registry;
- record-form and data-preview reference features and the existing basic
  assistant system retain explicit dependency lineage to lower-level assets;
  no second graph or embedded implementation is introduced; and
- conformance tests cover one-to-one manifest mapping, bounded fixtures,
  cross-profile resolution, representative semantic rendering, safe states,
  and fail-closed authority-free security defaults.
- Minimum verification:
  - pack install/activation/version conflict tests;
  - definition-to-implementation conformance for every default;
  - renderer snapshot/semantic/accessibility tests;
  - port compatibility and invalid-composition tests;
  - security-policy enforcement and attempted-bypass tests;
  - cross-host default availability and truthful incompatibility tests.
- Exit evidence:
  - the Catalog contains a coherent minimum construction kit rather than
    declarative shells;
  - every advertised default can be previewed and used in at least one tested
    composition;
  - security defaults fail closed and cannot weaken platform controls.

## Increment 5: System Builder CRUD and composition editor

- Status: implemented and verified
- Purpose: make Systems the workspace-scoped place for assembling simple assets
  into pages, features, subsystems, systems, and systems of subsystems.
- Deliverables:
  - system create, read, rename, revise, clone, archive, and restore use cases;
  - workspace-scoped persistence in SQLite/PostgreSQL;
  - asset browser/picker with source, type, implementation, compatibility, and
    readiness filters;
  - add/configure/remove asset instance operations;
  - typed port binding, required dependency, cardinality, ordering,
    parent/child, incompatibility, and cycle validation;
  - hierarchical editor for shell -> navigation/routes -> pages -> features ->
    low-level assets, plus logic/data/security/model bindings;
  - reusable composite feature creation and publish-back-to-Asset-Studio handoff;
  - undo/redo or revision-safe mutation behavior selected by accepted design;
  - explicit dirty, draft, blocked, valid, and validated design-time states;
  - desktop/thin-client parity and accessible keyboard-driven editing;
  - relocation of composition Plans and system-level Run & Test from Assets.

### Increment 5 implementation plan

1. Extend the accepted `system-builder` contract family with optimistic record
   revisions, immutable composition revisions, commands/results, safe
   validation diagnostics, and API/IPC operation identities. Reuse
   `AssetComposition`, `AssetInstance`, `AssetBinding`, ports, references, and
   validation vocabulary without a second graph model.
2. Add workspace-scoped record/revision repository ports and one structured
   persistence adapter used by SQLite- and PostgreSQL-backed hosts. Make create,
   read, list, rename, clone, archive, restore, save-revision, and validate
   operations transaction-safe and conflict-aware; never delete immutable
   revisions.
3. Implement deterministic composition validation for duplicate/orphan
   instances, roots, missing definitions, invalid configuration, missing or
   incompatible ports, cardinality, parent/child constraints, cycles, and
   fail-closed security assets. Return actionable bounded diagnostics and a
   design-time status only.
4. Expose the use cases through authenticated workspace-scoped API and IPC
   handlers, preload bridges, desktop/thin clients, and route policies. Preserve
   authenticated actor assignment and organization-scoped structured stores.
5. Replace the Systems preparation shell with one shared three-pane editor:
   system/revision list, searchable compatible asset picker and keyboard-
   operable hierarchy, and schema-backed configuration/binding inspector. Add
   explicit dirty/saving/conflict/blocked/validated states and revision history;
   use buttons and native form controls as a complete keyboard alternative to
   pointer reordering.
6. Move Plans and system-level Run & Test out of Assets and into Systems, add
   thin-client Systems routing/navigation parity, and verify create -> add
   defaults/composite -> configure -> bind -> save -> reopen across both client
   contracts.
7. Update System Builder architecture/context/readmes and run CRUD,
   persistence/isolation/conflict, graph validation, transport/security,
   accessibility, typecheck, build, docs, and architecture checks.

Research notes: W3C APG distinguishes focus from selection and defines explicit
keyboard behavior for hierarchical tree views and interactive grids. Its
guidance also warns that composite ARIA widgets require complete focus
management. The initial editor therefore uses native buttons, labeled controls,
and a semantic hierarchy with explicit move/add/remove actions; pointer
enhancements cannot be the only editing path. Revision-safe saves follow the
accepted ADR-0033 optimistic-token model, while all components remain canonical
Asset Kernel instances and bindings.
Research sources: the W3C [Tree View pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/),
[Grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/), and
[keyboard-interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/).

Implementation evidence:

- `SystemBuilderRecord` now uses optimistic record revisions and points to an
  immutable `SystemBuilderRevision` snapshot containing the canonical
  `AssetComposition`, `AssetInstance`, and `AssetBinding` graph;
- the structured repository persists workspace-qualified records and revisions
  through the same transactional document-store abstraction used by SQLite and
  PostgreSQL, with atomic record/revision writes and no revision deletion path;
- create, list, read, rename, archive, restore, clone, save, revision-read, and
  revision-history use cases are composed once for both hosts;
- validation pins exact definition versions, reuses Asset Kernel configuration
  and port validation, rejects duplicates, orphans, missing endpoints,
  incompatible ports, cardinality violations, and dependency/control cycles,
  and returns at most 200 safe actionable issues;
- authenticated API routes and Electron IPC handlers share operation identities,
  actor assignment, workspace/organization-scoped persistence, and fail-closed
  `asset:read` / `asset:write` route policy;
- desktop and thin-client Systems pages use the same keyboard-operable
  three-pane catalog/composition/inspector editor with explicit add, configure,
  connect, remove, save, clone, archive, restore, conflict, and history states;
- Plans and whole-system Run & Test are owned by Systems in both clients, and
  the thin client now has workspace-gated `/systems` routing and navigation;
- focused contract, persistence/use-case, graph-validation, composition-root,
  API/IPC parity, and security-policy tests pass; thin-client typecheck and
  production build pass.
- Minimum verification:
  - CRUD/revision/conflict and persistence conformance tests;
  - missing-workspace and cross-organization denial tests;
  - graph compatibility, cycle, cardinality, orphan, and invalid-binding tests;
  - concurrent edit/conflict behavior;
  - desktop/API/IPC/thin-client parity and accessibility tests;
  - no renderer-owned system truth or direct persistence access.
- Exit evidence:
  - a user can create a system, add simple defaults and a composite feature,
    configure them, bind their ports, save revisions, reopen the system in
    another client, and receive actionable validation diagnostics.

## Increment 6: System validation, build, and immutable release

- Status: implemented and verified; approved-release runtime activation remains
  explicitly owned by Increment 10
- Purpose: turn a validated design into a reproducible build and runnable release
  without making design records runtime state.
- Build flow:
  1. freeze the system composition revision and effective asset projections;
  2. validate definitions, configurations, data schemas, security policy,
     dependencies, ports, and composition rules;
  3. resolve one permitted compatible implementation for every required asset;
  4. evaluate deployment-shape, runtime, model/provider, storage, secret,
     migration, and capability readiness;
  5. normalize frontend/backend/workflow build inputs;
  6. generate UI routes/shell composition, logic bindings, configuration schema,
     and data migration artifacts through deterministic builders;
  7. compile/bundle in an isolated build environment;
  8. run contract, unit, integration, accessibility, security, and reference
     tests;
  9. generate SBOM, provenance, digests, compatibility manifest, and evidence;
  10. require release approval and persist an immutable release.

### Increment 6 implementation plan

1. Add a normalized `system-build` contract family for build requests, frozen
   lock manifests, attempt records, immutable release records, approvals,
   compatibility, safe diagnostics, evidence descriptors, and API/IPC
   operations. Keep design revisions, build attempts, releases, deployments,
   and execution runs as distinct record families.
2. Add workspace-scoped structured repository, content-addressed artifact,
   canonical-serialization/digest, implementation-resolution, and deterministic
   materializer ports. Compose adapters once for SQLite/PostgreSQL and
   filesystem/object-backed hosts; artifact metadata never contains bytes,
   credentials, raw paths, signed URLs, or provider payloads.
3. Implement a fail-closed build orchestrator that reads one immutable System
   Builder revision, reruns full graph/configuration validation, resolves one
   permitted exact implementation and facet for every instance, verifies
   deployment/capability compatibility, compiles finite policy/workflow/schema
   manifests, materializes deterministic artifacts, writes bounded evidence,
   and persists success or safe failure without activating partial output.
4. Implement explicit approval and release publication. Approval must bind the
   actor to the successful build digest; publication verifies every stored
   artifact before inserting a content-addressed immutable release. Rebuild and
   comparison operations must distinguish repeatability from independent
   reproducibility and never mutate an old release.
5. Expose build/list/read/cancel, approval, release/list/read/compare, and
   verified-manifest operations through authenticated API and IPC transports,
   preload, desktop/thin clients, and fail-closed route policy.
6. Add a Systems `Build & release` workflow using the shared ordered-step UI:
   target/readiness, frozen inputs/resolution, build evidence, approval, and
   immutable release history. Preserve loading, empty, blocked, cancellation,
   retry, conflict, safe-diagnostic, and keyboard-accessible states.
7. Update architecture, context packs, security/operations guidance, and run
   deterministic digest, ambiguous/revoked/incompatible implementation,
   tamper, immutability, cancellation, storage, tenancy, transport parity,
   accessibility, typecheck, build, docs, architecture, and full test gates.

Research notes: SLSA 1.2 Build L1 requires automatically generated provenance
describing the builder, build process, and top-level inputs, while higher levels
add signed hosted/hardened builder guarantees; this increment records truthful
local or managed assurance rather than claiming a higher level. SPDX 3.0.1
provides an open BOM model covering software, build information, AI models,
datasets, provenance, integrity, and relationships. NIST SSDF PS.3.2 calls for
collecting and sharing provenance for release components, and NIST's DevSecOps
reference model recommends ephemeral build/test/release environments plus
integrity, signature, secret, dependency, and evidence checks. The Reproducible
Builds project defines reproducibility as bit-for-bit identity from the same
source, build environment, and instructions, so the implementation records a
canonical lock/toolchain and labels same-host duplicate-output checks as
`repeatable` until an independent qualified builder verifies them.

Research sources:

- [SLSA 1.2 Build track](https://slsa.dev/spec/v1.2/build-track-basics)
- [SPDX 3.0.1 scope](https://spdx.github.io/spdx-spec/v3.0.1/scope/)
- [NIST Secure Software Development Framework](https://csrc.nist.gov/projects/ssdf)
- [NIST DevSecOps notional reference model](https://pages.nist.gov/nccoe-devsecops/notational-reference-model.html)
- [Reproducible Builds documentation](https://reproducible-builds.org/docs/)

Implementation evidence:

- a distinct `system-build` family now owns build attempts, exact lock
  manifests, safe diagnostics, artifact/evidence descriptors, content-addressed
  releases, compatibility, and comparisons; design revisions remain unchanged;
- the build orchestrator re-reads and validates an exact immutable System
  Builder revision, resolves permitted implementation releases/facets for the
  requested deployment profile, canonicalizes the lock, and fails closed for
  unresolved, invalid, incompatible, or cancelled inputs;
- deterministic materialization produces manifest, applicable UI/logic/workflow
  bundles, deny-by-default policy, configuration schema, migration plan, and an
  SPDX SBOM; raw secret-like configuration and mutation without a platform
  policy are rejected;
- content-addressed artifact storage verifies SHA-256 at write and approval;
  in-toto/SLSA-style provenance plus bounded evidence are generated
  automatically, and assurance is truthfully labeled `repeatable` until an
  independent qualified builder verifies it;
- release approval binds the authenticated actor to the reviewed lock digest,
  re-verifies all output and evidence artifacts, derives an immutable release
  identifier from content, and preserves prior releases for comparison;
- SQLite/PostgreSQL-backed structured persistence semantics, server API,
  desktop IPC/preload, route security, and one shared four-step desktop/thin
  Build & Release workflow are wired through active host compositions; and
- focused contract, deterministic output, secret/policy denial, unresolved and
  tamper denial, workspace isolation, optimistic conflict, release
  immutability, transport parity, actor-boundary, security-policy, and shared UI
  tests pass. Server and thin-client production builds are required before this
  increment is closed.
- Deliverables:
  - build/release contracts, ports, use cases, persistence, storage, transports,
    clients, and UI;
  - deterministic implementation resolution with lock manifest;
  - data-schema compatibility and migration plan validation;
  - security-policy completeness and unsafe composition rejection;
  - build cancellation, bounded logs, retry policy, and safe failure recovery;
  - reproducibility check and release comparison;
  - preview/run handoff that reuses runtime readiness and execution approval
    boundaries.
- Minimum verification:
  - same-input/same-toolchain reproducibility and digest tests;
  - unresolved, ambiguous, revoked, incompatible, or setup-missing
    implementation tests;
  - migration compatibility/rollback and unsafe schema-change tests;
  - policy omission/bypass and secret/path redaction tests;
  - build timeout/cancellation/resource-limit/partial-output cleanup tests;
  - tampered artifact/provenance rejection;
  - release immutability and old-release rerun tests.
- Exit evidence:
  - the thin vertical slice from Increment 0 produces an immutable release with
    complete evidence and runs in a supported preview host;
  - changing an asset or system creates a new build/release and never mutates the
    prior release.

## Increment 7: Forms and secured data-entry reference system

- Status: implemented and verified; live PostgreSQL conformance remains
  environment-gated by `TEST_POSTGRES_URL`
- Purpose: prove that users can build useful business software from simple
  assets rather than from a hidden feature-specific implementation.
- Reference composition:
  - application shell and navigation;
  - authenticated page and role/permission policy;
  - entity with text, number, enum, date, relationship, and validation assets;
  - create/edit form assembled from field/input/validation/action assets;
  - list/detail table and data-display assets;
  - create/read/update workflow assets and audit declarations;
  - loading, empty, validation, authorization-denied, success, and error states.
- Deliverables:
  - reusable form and CRUD feature composites published from simple defaults;
  - data model -> form binding and generated migration intent;
  - host-owned authorized persistence operation implementation;
  - complete reference system template and Asset Studio examples;
  - desktop/thin-client functional parity.
- Minimum verification:
  - form validation, accessibility, keyboard, and responsive tests;
  - authorized CRUD, field masking, audit, and cross-tenant denial tests;
  - migration and round-trip persistence tests on SQLite and PostgreSQL;
  - rebuild after compatible customization and rejection after incompatible
    contract changes.
- Exit evidence:
  - a user can create the reference system through System Builder, build it,
    enter and revise data, enforce access policy, inspect audit evidence, and run
    the same logical release in local and managed shapes.

### Increment 7 implementation plan

1. Promote the remaining date/time primitive and add exact host-neutral entity
   field, validation, persistence-operation, CRUD workflow, masking, and audit
   defaults required by the reference composition. Keep definitions data-only;
   rendering, authorization, validation, transactions, and writes remain
   platform-owned implementations.
2. Add a closed, versioned reference-system template registry and a
   transaction-safe application use case that creates a System Builder record
   plus its first immutable Asset Kernel revision. Expose template list/create
   through API, IPC, preload, and shared Systems UX rather than assembling
   privileged records in a renderer.
3. Add approved-release-bound system data contracts and repositories for typed
   record values, optimistic revisions, workspace/release/entity isolation, and
   append-only safe audit entries. Use the shared structured-document seam so
   SQLite and PostgreSQL retain equivalent application semantics.
4. Implement a finite form/data runtime that reads the verified release
   manifest, derives an allowlisted schema and narrowing role policy, validates
   every value on the trusted application layer, masks protected fields,
   authorizes each create/read/update/list action, commits record plus audit in
   one transaction, and returns bounded safe diagnostics.
5. Expose the same release-bound CRUD behavior through authenticated API and
   desktop IPC clients and a shared accessible Run & Test form/list/detail UX.
   Use native labeled controls, inline and summary errors, keyboard-complete
   actions, loading/empty/denied/conflict/success states, and no client-only
   security decisions.
6. Verify exact template composition, deterministic build/approval, field
   validation and masking, authorization denial, audit redaction, optimistic
   conflicts, cross-workspace and cross-organization isolation, SQLite and
   PostgreSQL repository semantics, transport parity, responsive accessibility,
   and rebuild compatibility.
7. Update foundation, System Builder, runtime, persistence, security, context,
   operations, and roadmap documentation; run focused tests, production builds,
   architecture/docs/agent gates, and the applicable full suite.

Research notes: WCAG 2.2 requires detected input errors to be identified and
described in text, provides error-prevention requirements for stored-data
changes, and adds focus/target-size and redundant-entry criteria. W3C WAI form
guidance recommends native labeled controls and makes clear that client
validation improves usability but never replaces trusted server validation.
OWASP ASVS requires positive allowlist/shape validation at the trusted service
layer, least privilege, and fail-secure access control; its logging guidance
calls for attributable create/update/delete audit trails while excluding access
tokens, passwords, secrets, and sensitive data. JSON Schema 2020-12 remains the
portable declarative schema vocabulary. SQLite permits only one simultaneous
writer and requires explicit busy/conflict handling, while PostgreSQL
Serializable transactions require retry on serialization failure. The shared
repository therefore uses bounded optimistic commands and atomic transactions,
with adapters responsible for native retry/busy translation.

Research sources:

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [W3C WAI validating input](https://www.w3.org/WAI/tutorials/forms/validation/)
- [W3C native HTML form-control technique](https://www.w3.org/WAI/WCAG22/Techniques/html/H91.html)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12)
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)

Implementation evidence:

- the closed `reference.secured-data-entry@1.0.0` registry materializes 35
  exact-version canonical instances spanning shell, page, auth/policy/mask,
  typed data fields, form controls, CRUD operations/workflow, audit, display,
  and complete interaction states; creation atomically stores its first
  validated immutable revision;
- deterministic build/approval emits and verifies the manifest, applicable
  bundles, deny-by-default policy, configuration schema, migration plan, SPDX
  SBOM, provenance, and evidence before deriving the immutable release;
- the release resolver requires one verified approved manifest plus exact
  single-instance security, entity, operation, workflow, and form declarations,
  rejects ambiguity/cross-entity binding, and derives only finite allowlisted
  field and narrowing-role definitions;
- the trusted runtime validates typed values, bounds list/audit reads, enforces
  per-action host-derived principals, masks protected fields, preserves
  optimistic revisions, atomically commits record plus audit, and stores field
  names rather than values in audit evidence;
- authenticated API, desktop IPC/preload, desktop/thin clients, and one shared
  accessible Run & Test form/list/detail presenter expose equivalent behavior
  and safe loading, empty, validation, denied, conflict, masked, success, and
  audit states;
- focused contracts, template validation, resolver fail-closed cases,
  authorization/masking/redaction, conflicts, workspace/organization isolation,
  API/IPC/preload parity, shared UI, and composition-level
  create-build-approve-run tests pass;
- the production Electron SQLite integration suite now proves system-data
  round-trip, audit, and stale-write behavior. The live PostgreSQL suite proves
  the same semantics plus RLS organization isolation when
  `TEST_POSTGRES_URL` is supplied.

## Increment 8: Chatbot reference system

- Status: implemented and verified
- Purpose: prove an AI-enabled system can be assembled from reusable UI, model,
  context, policy, and logic assets while preserving controlled execution.
- Reference composition:
  - shell/page, transcript, message, composer, response, and status assets;
  - model reference/selector, instruction template, generation settings, and
    conversation policy assets;
  - controlled inference action, approval, error/fallback, and optional supported
    context-source assets;
  - runtime readiness, source verification, execution plan, session, and audit
    bindings.
- Deliverables:
  - reusable chatbot feature composite built from simple defaults;
  - model compatibility/readiness display and configuration;
  - instruction/context customization with protected-content boundaries;
  - conversation preview in Asset Studio and full Run & Test in Systems;
  - truthful unsupported states for tools, retrieval, memory, multimodal, or
    streaming behavior not accepted at implementation time.
- Minimum verification:
  - approval invalidation, stale source, unsupported runtime, failure, and
    cancellation-availability tests;
  - protected prompt/context and provider payload non-disclosure tests;
  - model/readiness compatibility and host parity tests;
  - accessibility and long-conversation rendering tests;
  - existing controlled conversational execution regression suite.
- Exit evidence:
  - a user can compose, customize, build, approve, and run a chatbot without a
    chatbot-specific parallel architecture or direct provider calls from UI.

### Increment 8 implementation plan

1. Extend the functional foundation only with the finite reusable AI declarations
   missing from the existing conversation family: protected instruction
   reference/configuration, bounded generation settings, narrowing conversation
   policy, controlled text-generation action, and safe fallback declaration.
   These remain data-only assets; they cannot contain credentials, call a
   provider, grant tools, or weaken host policy.
2. Add a closed `reference.controlled-chatbot@1.0.0` System Builder template
   composed from the existing conversation assets plus shell, model/context,
   policy, approval/readiness, audit, and complete state assets. Make template
   selection generic in shared Systems UX and keep template creation atomic,
   exact-versioned, and validated.
3. Reuse Increment 6 deterministic build and approval unchanged. Prove the
   chatbot template produces immutable manifest/UI/workflow/policy evidence,
   while preserving the explicit fact that release approval is not deployment
   activation and controlled conversation execution still requires its reviewed
   execution plan, current readiness binding, and separate session approval.
4. Consolidate the duplicated desktop/thin conversational Run & Test presenter
   into one shared component. List actual execution-plan summaries (never
   composition-plan ids), project host-provided action/readiness state, render
   the transcript as a bounded accessible `role="log"`, and preserve explicit
   empty/loading/approval/stale/unsupported/failure/success states.
5. Keep the existing controlled conversation application services, persistence,
   API/IPC/preload clients, protected-context builder, runtime guards, adapter
   catalog, and Python text-generation adapter as the only invocation path.
   Do not add direct UI/provider calls or fake responses; tools, retrieval,
   memory, multimodal, streaming, cancel, and retry remain visibly unsupported
   unless the host already proves them end to end.
6. Verify template composition and customization/rebuild, deterministic build
   and approval, exact execution-plan identity, stale approval/readiness denial,
   unsupported runtime/cancel/retry behavior, bounded input/transcript output,
   prompt/context/provider-payload non-disclosure, host parity, accessibility,
   long-conversation rendering, and the full controlled-execution regression
   suite.
7. Update foundation, System Builder, controlled-execution, security, UI,
   context-pack, and roadmap documentation, then run focused tests, production
   builds, architecture/docs/agent gates, and the applicable full suite.

Research notes: NIST AI 600-1 treats generative-AI risk management as an
ongoing govern/map/measure/manage activity and emphasizes documented
pre-deployment testing, provenance, monitoring, and human oversight rather than
assuming a model or prompt is intrinsically safe. OWASP identifies direct and
indirect prompt injection as a control-bypass and data-exfiltration risk and
warns that a system prompt is neither a secret store nor an authorization
boundary. The implementation therefore keeps instructions/context behind
protected application contracts, never embeds credentials, and preserves
host-owned authorization and capability checks outside the model. WAI-ARIA
defines a chat history as an ordered live `log` with polite announcements and
supports `aria-busy` while a coherent update is in progress; the shared
presenter uses those semantics without moving keyboard focus on every response.

Research sources:

- [NIST AI 600-1 Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)
- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [OWASP LLM07:2025 System Prompt Leakage](https://genai.owasp.org/llmrisk/llm072025-system-prompt-leakage/)
- [OWASP prompt-injection prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- [W3C ARIA23 chat-log technique](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA23.html)
- [WAI-ARIA 1.2 `aria-busy`](https://www.w3.org/TR/wai-aria/#aria-busy)

Implementation evidence:

- `system.foundation@1.0.0` now provides safe data-only instruction,
  generation, conversation-policy, controlled-inference, and fallback
  declarations without credentials, provider authority, or enabled tools;
- `reference.controlled-chatbot@1.0.0` atomically creates a validated closed
  composition of 31 exact-version shell, conversation, AI, policy, audit, and
  complete-state assets;
- the existing deterministic build and integrity-verified approval pipeline
  builds and publishes the chatbot release without exposing protected
  instruction content through public build, approval, or diagnostic results;
- desktop and thin-client Systems surfaces use one shared Run & Test presenter,
  list real execution-plan summaries, preserve plan identity on session
  creation, project application-owned action availability, bound input to 4,000
  characters and visible transcript output to 200 entries, and expose the
  conversation as an accessible live `log`;
- production clients continue to invoke only the existing controlled
  conversation services and runtime adapter boundary. Tools, retrieval, memory,
  multimodal input, streaming, cancel, and retry remain truthfully unsupported
  unless the host advertises a completed path; and
- the Asset Library read regression caused by unsafe new foundation declarations
  is fixed: every foundation entry again passes the safety gate, functional
  catalog conformance, and workspace Asset Library read-facade tests.

Verification evidence includes controlled-template validation, create/build/
approve end-to-end coverage, protected-content non-disclosure, nested desktop
operation-envelope handling, execution-plan identity, 202-entry transcript
bounding, desktop/thin host UI parity, foundation manifest/catalog safety, and
the existing controlled-conversation regression suites.

### Increments 1-8 backward verification audit (2026-07-17)

| Increment | Verified repository-owned outcome                                                                                                                                                                                                                             | Remaining or intentionally bounded condition                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Normalized implementation records, deterministic resolution, immutable structured persistence/artifacts, safe read transports, and cross-host trusted bindings pass focused contract, resolver, storage, transport, and composition tests.                    | The kernel exposes a replaceable builder port; it does not claim a qualified untrusted builder.                                              |
| 2         | Bounded non-executing inspection plus quarantine, admission, install, activation, disable, rollback, trust, transport, and shared-UI paths pass focused malicious-input and lifecycle tests.                                                                  | Destructive removal, automatic updates, public marketplace discovery, and registry transport remain outside the accepted current lifecycle.  |
| 3         | Manual/coding-model proposal validation, untrusted-context handling, timeout, stale approval, immutable proposal storage, exact human review, source snapshot, transport parity, and shared UI pass focused tests.                                            | Untrusted build, preview, and publication remain `sandbox-unavailable`; the roadmap status and exit wording above now state this explicitly. |
| 4         | All 87 exact foundation entries retain one safe functional descriptor and compatible trusted binding; manifest, catalog, install, fail-closed policy, and accessible preview tests pass.                                                                      | New defaults still require closed-registry conformance and versioned pack evolution.                                                         |
| 5         | Revision-safe CRUD, graph validation, structured persistence composition, API/IPC parity, shared system/template entry UI, and keyboard-complete controls pass focused tests.                                                                                 | Operational runs remain separate from design records by construction.                                                                        |
| 6         | Deterministic materialization, bounded system size, evidence integrity, immutable approval/release, persistence, transport, and shared build UI pass focused tests.                                                                                           | Deployment activation is owned and verified by Increment 10, not by design/build records.                                                    |
| 7         | The secured data-entry template creates, builds, approves, and runs with typed validation, policy, masking, optimistic persistence, and safe audit evidence across shared transports/UI.                                                                      | Live PostgreSQL conformance runs only when `TEST_POSTGRES_URL` is supplied; SQLite production integration is covered.                        |
| 8         | The controlled chatbot creates/builds/approves through the general system pipeline and runs only through controlled conversational execution; plan identity, bounded transcript, safe client parity, and Asset Library foundation-read regression tests pass. | Tools, retrieval, memory, multimodal, streaming, cancellation, and retry remain truthfully unsupported.                                      |

Focused audit batches passed 26 tests for Increments 1-3, 54 tests for
Increments 4-6, and 42 tests for Increments 7-8. The repository-wide suite and
production gates listed under Increment 11 provide the broader regression
evidence.

## Increment 9: Data preview and review reference system

- Status: implemented and verified
- Purpose: prove resource-backed assets, bounded content access, multiple preview
  types, filtering, and security can form a reusable review application.
- Reference composition:
  - shell/page, artifact browser/selector, metadata, filters, detail panel, and
    preview state assets;
  - text, table, image, PDF, and safe unsupported Office/media preview assets;
  - artifact-read policy, field/metadata masking, audit, and optional review
    workflow assets;
  - empty, unavailable, oversized, unauthorized, and malformed-content states.
- Deliverables:
  - reusable data-review feature composite built from simple defaults;
  - descriptor-first browse/detail and authorized content retrieval bindings;
  - bounded preview processing and resource quotas;
  - import/localize/register integration without making stored files the asset
    definition itself;
  - desktop/thin-client functional parity.
- Minimum verification:
  - content type, malformed input, size/resource limit, and parser isolation
    tests;
  - path/storage/provider detail redaction tests;
  - cross-workspace/organization read denial and audit tests;
  - preview accessibility, keyboard, loading, empty, and failure tests;
  - filesystem and object-storage adapter conformance.
- Exit evidence:
  - a user can compose, build, and run a secured data-review system whose preview
    behavior is assembled from reusable assets and authorized storage seams.

### Increment 9 implementation plan

1. Extend `system.foundation` only with the missing finite review declarations:
   an artifact-read policy and explicit text, table, raster-image, PDF, and
   unsupported preview assets. Reuse the existing resource-browser/detail,
   metadata, filter, field-mask, audit, authentication, workflow, and complete
   state assets; keep every new definition data-only and authority-free.
2. Add the closed `reference.secured-data-review@1.0.0` System Builder template.
   Materialize exact-version shell, browser, filter, detail, preview, policy,
   masking, audit, and empty/unavailable/oversized/unauthorized/malformed state
   instances into one canonical Asset Kernel graph, validate it atomically, and
   build/approve it through the existing deterministic release pipeline.
3. Add a `system-review` application boundary analogous to the release-bound
   `system-data` runtime. Resolve policy only from one integrity-verified
   manifest of an approved release; require authentication and allowlisted
   roles; browse/read through existing artifact ports; mask configured metadata;
   classify supported preview kinds; record bounded redacted allow/deny audit
   events; and fail closed for missing, duplicated, malformed, stale, or
   cross-workspace release evidence.
4. Make preview quotas enforceable before byte materialization. Add an optional
   maximum-byte ceiling to the host-neutral artifact retrieval request and
   media-view boundary, require adapters to reject objects above the ceiling
   before reading them, and verify the filesystem adapter stats before
   `readFile`. Keep full downloads a separate explicit operation without
   silently treating them as previews.
5. Harden shared preview rendering. Classify from normalized media metadata plus
   conservative signatures, never render HTML as markup, treat SVG and Office
   formats as unsupported in the reference runtime, parse only bounded JSON/CSV
   samples into native tables, neutralize spreadsheet-formula display risk,
   sandbox and title PDF frames, revoke object URLs, and expose explicit
   loading, empty, unavailable, oversized, unauthorized, malformed, and
   unsupported states.
6. Expose the release-bound review operations through authenticated API and IPC
   transports, preload, desktop/thin clients, and one shared Systems Run & Test
   presenter. The presenter selects an approved release, filters a bounded
   artifact list, renders masked metadata and the shared preview, and shows safe
   audit evidence. It must not reveal paths, provider payloads, credentials,
   unmasked metadata, or raw parser errors.
7. Add contract, release resolver, authorization/masking/audit, malformed and
   oversized content, workspace/organization isolation, filesystem pre-read
   quota, transport parity, presenter accessibility/keyboard/state, template,
   and create-build-approve-run tests. Reuse a port conformance harness for the
   artifact-object behavior; a managed cloud object-store selection remains an
   Increment 10 deployment-shape decision rather than an invented provider in
   this increment.
8. Update storage, preview, System Builder, security, host, UI, context-pack, and
   operations docs. Run focused tests while iterating, then both host
   typechecks/builds plus docs, architecture, agent-support, and full applicable
   repository gates.

Rollback plan: the new template and runtime are additive. If release-policy or
preview conformance fails, remove the template from the registry and leave the
existing artifact browser/read paths unchanged; optional byte ceilings preserve
unbounded download compatibility when omitted. No migration or destructive
record rewrite is introduced.

Research notes: OWASP recommends allowlisting necessary file types, checking
signatures rather than trusting caller-supplied content type, enforcing size
limits, keeping storage outside the web root, and serving content through an
authorized handler. The WHATWG MIME Sniffing standard documents the security
risk when contributed bytes are interpreted as a more privileged scriptable
type than intended; this increment therefore uses conservative supported-type
classification and `nosniff` behavior rather than extension-only trust. RFC
9110 byte-range semantics demonstrate the portable partial-read model, but a
range request is advisory and does not replace a server-side maximum; the
application and adapter enforce their own ceiling. W3C iframe guidance requires
an accessible frame title; PDF preview also uses a sandboxed, constrained frame.

Research sources:

- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [WHATWG MIME Sniffing Living Standard](https://mimesniff.spec.whatwg.org/)
- [RFC 9110 HTTP Semantics - Range Requests](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests)
- [W3C WCAG Technique H64: iframe titles](https://www.w3.org/WAI/WCAG22/Techniques/html/H64)

Implementation evidence:

- `system.foundation@1.0.0` now includes the finite artifact-read policy and
  text, table, raster-image, PDF, and unsupported preview declarations, and the
  closed `reference.secured-data-review@1.0.0` template composes them with the
  existing browser, filter, detail, masking, audit, authentication, workflow,
  and complete-state assets;
- the release-bound `system-review` application family accepts only one
  integrity-verified approved release manifest, derives a finite allowlist and
  quotas from that manifest, returns opaque artifact references and masked
  metadata, enforces authenticated role/workspace ownership, and records
  bounded redacted allow/deny audit evidence;
- preview retrieval carries an application-owned maximum-byte ceiling through
  API/IPC and storage seams. The filesystem adapter checks file size before
  reading, while shared classification rejects SVG/Office and malformed or
  oversized input, bounds JSON/CSV tables, neutralizes displayed spreadsheet
  formulas, and constrains titled sandboxed PDF frames;
- API, Electron IPC, preload, desktop/thin clients, and the shared Systems Run
  & Test presenter expose the same describe, browse, detail, preview, and audit
  operations without accepting caller-selected principals or returning paths,
  provider payloads, credentials, unmasked metadata, or raw parser errors; and
- the desktop Asset Library startup regression is fixed. Host startup performs
  a guarded system-owned foundation refresh, fails closed when it cannot
  establish the foundation, removes the missing legacy implementation seed,
  and treats compatible trusted built-in releases/bindings as idempotent. An
  isolated copy of the previously failing desktop persistence data now installs
  with zero failures and reads all 105 library entries.

Verification evidence includes foundation/template validation, create/build/
approve coverage, release-policy integrity denial, workspace and authorization
isolation, masking and redacted audit, malformed/oversized preview denial,
filesystem pre-read ceilings, API/IPC transport parity, shared presenter empty
state/accessibility, 40 focused Increment 9 tests, filtered TypeScript
diagnostics including the desktop template-id regression, successful server and
thin-client production builds, and successful Electron desktop packaging.

## Increment 10: Multi-shape runtime and deployment handoff

- Status: implemented and verified
- Purpose: run the same logical system release safely across local, campus,
  corporate, and cloud deployment shapes.
- Deployment behavior:

  | Shape                   | Structured records | Package/source/evidence storage        | Build and execution authority                                                                                      |
  | ----------------------- | ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
  | Local desktop           | SQLite             | Desktop artifact storage               | Local trusted implementations plus approved constrained sandbox; no remote requirement for supported local systems |
  | Campus/corporate server | PostgreSQL         | Institution filesystem/object service  | Server build service and isolated worker/container pool under organization policy                                  |
  | Cloud                   | PostgreSQL         | Tenant-aligned object storage/registry | Ephemeral tenant-isolated builders/runners with quotas, egress, audit, and managed secrets                         |
  | Thin client             | Server-owned       | No privileged local package store      | Sandboxed browser UI only; backend build and logic execution remain server-owned                                   |

- Deliverables:
  - deployment-profile compatibility resolution and build-target selection;
  - trusted built-in renderer/runtime mapping per host;
  - sandboxed imported/authored UI and logic execution selected by accepted ADR;
  - capability broker, secret references, egress policy, quotas, cancellation,
    health/readiness, logs/metrics, and audit;
  - install/activate/rollback behavior for system releases;
  - run history and deployment status separate from design/build records;
  - portable export/import or standalone packaging only to the extent explicitly
    accepted by the build/package ADR;
  - deployment templates and operator guidance for system release storage,
    policy, backups, upgrades, and revocation.
- Minimum verification:
  - desktop package, server build, thin-client build, and host smoke tests;
  - sandbox escape, capability escalation, egress, secret, resource exhaustion,
    and cross-tenant negative tests;
  - same-release compatibility and unsupported-shape tests;
  - release activation, rollback, revocation, and interrupted-start tests;
  - no privileged backend execution in thin-client/browser processes.
- Exit evidence:
  - all three reference systems run through the supported local and managed host
    paths from the same logical release model;
  - unsupported host capabilities fail before execution with actionable safe
    diagnostics.

### Increment 10 implementation plan

1. Introduce a separate `system-deployment` contract family for deployment
   identity, target/profile, immutable release binding, compatibility evidence,
   desired/observed lifecycle, health, bounded quotas, egress rules, opaque
   secret references, run history, safe diagnostics, audit, and cancellation.
   Do not add operational fields to System Builder records or mutate releases.
2. Extend frozen system-build implementation evidence with trust/runtime facts
   required at handoff. Resolve the selected host profile against the release's
   exact deployment/host/runtime compatibility and required capabilities before
   install; reject thin-client execution authority and incompatible or stale
   release evidence before any runtime adapter call.
3. Add workspace- and organization-scoped deployment/run repository ports plus
   database-neutral structured adapters so SQLite and PostgreSQL share revision,
   isolation, interruption, and rollback semantics. Deployment history is
   append/update operational data; approved releases remain immutable.
4. Add application-owned install, activate, health reconciliation, rollback,
   revoke, list/read, start-run, cancel-run, and safe audit use cases. Activation
   re-verifies release artifacts, records the previously active deployment for
   rollback, waits for adapter readiness, and never exposes credentials, raw
   paths, provider responses, or sandbox output.
5. Define a capability broker and replaceable runtime/sandbox port. Enforce the
   intersection of platform, organization, release, actor, egress, secret,
   resource, and cancellation policy for every call. Map the three closed
   reference-system kinds to product-compiled trusted runtimes on desktop and
   managed server profiles. Imported/authored UI or logic must return a specific
   safe `sandbox-unavailable` readiness result unless an independently qualified
   adapter is injected; this increment will not silently select or advertise an
   unqualified container/WASI engine.
6. Expose deployment/readiness/run-history commands through authenticated API
   and Electron IPC/preload, desktop/thin clients, and one shared Systems
   Deploy & Run presenter. Thin client remains a control/read surface only and
   cannot supply a local runtime, filesystem, secret, capability, or principal.
7. Add operator templates and automated fitness checks for managed runners:
   restricted non-root security context, read-only root, dropped capabilities,
   no service-account token, default-deny network posture, explicit resource and
   temporary-storage quotas, startup/readiness/liveness separation, graceful
   cancellation, immutable images, tenant labels, and opaque secret injection.
8. Verify compatibility and unsupported-shape decisions, same-release desktop/
   managed handoff for all three references, cross-workspace/organization
   denial, capability/egress/secret escalation denial, quota exhaustion,
   interruption, readiness failure, cancellation, activation, rollback,
   revocation, audit/telemetry redaction, transport parity, presenter states,
   thin-client non-execution, host builds/smokes, and desktop packaging.
9. Update build/release, host, security, tenancy, deployment, operations,
   context-pack, UI, and roadmap documentation, then run focused tests and all
   applicable repository gates.

Rollback plan: the new deployment family and host composition are additive.
Disable its API/IPC registration and shared presenter to return to direct
reference-release Run & Test while preserving immutable release and deployment
history. Activation failures retain the prior active deployment; rollback is an
explicit new deployment transition, never a rewrite or deletion. An unavailable
or unqualified sandbox remains a safe denial, so rollback never requires
executing imported code.

Research notes: Kubernetes Restricted Pod Security requires current hardening
controls such as non-root execution, no privilege escalation, a constrained
capability set, and seccomp; Kubernetes also notes that it has no generic API
that proves a workload uses a sandboxed runtime. The repository therefore treats
cluster configuration as operator evidence, not proof that an arbitrary asset
is safe. NetworkPolicy permits default-deny ingress/egress but allows all traffic
when no policy exists and requires an explicit DNS exception when resolution is
needed. ResourceQuota and LimitRange provide namespace and per-workload limits;
application quotas still remain mandatory because cluster quotas do not bound a
single logical run across retries. Startup, readiness, and liveness probes have
different failure semantics, so activation waits on readiness and does not use a
dependency outage as a liveness failure. OCI defines the portable runtime
configuration/lifecycle surface and Linux isolation mechanisms but does not by
itself qualify one runtime against this threat model. Electron likewise requires
process sandboxing, context isolation, narrow bridges, and sender validation for
untrusted renderer content. OpenTelemetry semantic conventions provide common
signal/resource naming, but deployment events stay bounded and redacted at the
application boundary before reaching a sink.

Research sources:

- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
- [Kubernetes Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [Kubernetes Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/)
- [Kubernetes liveness, readiness, and startup probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/)
- [Kubernetes Pod lifecycle and graceful termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [OCI Runtime Specification](https://specs.opencontainers.org/runtime-spec/)
- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)

Implementation evidence:

- the separate `system-deployment` contract/application/port/persistence family
  stores organization/workspace-scoped deployments, runs, health, revisions,
  compatibility, bounded policy, cancellation, and redacted audit without
  mutating designs or releases;
- release approval now freezes implementation trust facts and derives the
  compatible profile intersection. Install re-verifies every release artifact
  and the bounded manifest, then rejects incompatible profile, host/runtime,
  capability, thin-client authority, unknown runtime, and unqualified sandbox
  inputs before adapter execution;
- desktop and server compose trusted mappings for the three closed reference
  kinds on local, campus/corporate, and cloud profiles. Imported/authored
  execution remains explicitly `sandbox-unavailable`, while activation,
  readiness, interruption, rollback, revocation, bounded run handoff,
  cancellation, and audit retain safe operational state;
- authenticated API and Electron IPC derive organization/principal and host
  authority, preload and desktop/thin clients expose parity, and the shared
  Deploy & Run presenter shows compatibility, status, health, history, audit,
  and truthful thin-client control-only behavior; and
- the suspended managed-runner specimen and automated deployment fitness checks
  require Restricted Pod Security, non-root/read-only/drop-all controls,
  default-deny network, namespace and container quotas, bounded ephemeral
  storage/deadline, distinct probes, cancellation grace, immutable images,
  opaque tenant labels, and secret-reference injection without claiming sandbox
  qualification.

Verification evidence includes 9 focused deployment lifecycle/persistence/
transport/presenter tests, cross-profile handoff for all three references,
capability/secret/egress/concurrency/sandbox/cross-tenant negative tests,
interrupted terminal-state checks, managed-runner drift tests, filtered
TypeScript diagnostics, the deployment static gate, successful server and
thin-client production builds, and successful Electron desktop packaging.

## Increment 11: Hardening and support qualification

- Status: implemented; controlled support qualification remains incomplete
- Purpose: establish release-quality security, compatibility, recovery,
  observability, performance, and operational evidence.
- Deliverables:
  - compatibility matrix for definition, implementation, package, system,
    schema, host, runtime, and deployment versions;
  - revocation propagation and vulnerable dependency response;
  - upgrade, rollback, backup/restore, export/import, and disaster-recovery
    procedures for asset/system metadata and packages;
  - catalog, editor, resolver, build, and runtime performance budgets;
  - quotas and admission controls for packages, builds, previews, and executions;
  - security review and penetration testing of package parsing, coding-model
    tools, sandboxes, capability broker, security assets, and tenant isolation;
  - accessibility qualification of Catalog, Studio, Builder, and reference
    systems;
  - architecture fitness functions preventing executable payloads in metadata,
    renderer/adapter boundary violations, security-policy bypass, unscoped
    persistence, and capability drift;
  - support and deprecation policy, operator runbooks, user guidance, and example
    systems.

### Increment 11 implementation plan

1. Add one versioned, machine-readable support-qualification manifest plus a
   human-readable support policy. The manifest will relate definition,
   implementation, package, system, schema, host API, runtime ABI, deployment
   profile, and application versions; record compatibility direction,
   deprecation state, replacement, support window, and known unsupported
   combinations; and preserve exact immutable locks. It will not infer
   compatibility from a package version alone.
2. Add an application-owned revocation-read seam to deployment composition.
   Install, activation, health reconciliation, and run start will re-evaluate
   every frozen implementation release in the approved system release. A newly
   revoked implementation will fail closed, deactivate an active runtime where
   possible, persist a revoked deployment state, and write a bounded audit
   reason before any further start. Desktop and server will source this truth
   from the existing implementation repository; thin client remains a control
   surface.
3. Document and test the vulnerable-package response path: correlate an
   advisory to the locked package/SBOM identity, disable affected package
   activation, revoke each affected immutable implementation release, reconcile
   deployments, choose an unaffected approved release, and retain evidence. The
   existing locked dependency audit and SPDX gate remains the repository
   dependency control; this increment will not silently query a public registry,
   auto-upgrade packages, or treat provenance as proof of safety.
4. Publish exact upgrade, rollback, coordinated metadata/package backup,
   portable export/import, restore, and disaster-recovery procedures. Add a
   versioned qualification-evidence record that distinguishes `passed`,
   `failed`, `not-run`, and `not-applicable`, records digests and sanitized
   environment facts, and rejects a production-qualified result when required
   environment or manual evidence is absent. RPO, RTO, retention, encryption,
   regional failure scope, and approval remain organization-owned inputs.
5. Define catalog, Studio editor, resolver, deterministic build, safe preview,
   and trusted runtime performance budgets with representative workload sizes,
   percentile, warm/cold state, host shape, and measurement method. Add a
   repeatable Node qualification runner that emits sanitized timing evidence;
   keep timing gates out of ordinary unit tests where host variance would create
   flakes, while validating the budget schema and admission ceilings in CI.
6. Consolidate the enforced package inspection, build diagnostics/manifest,
   preview, deployment, output, concurrency, memory, duration, and temporary
   storage ceilings into the qualification manifest. Add drift checks tying
   those declarations to the owning source and negative tests proving oversized,
   excessive, widened-capability, and concurrent requests remain rejected.
7. Extend the canonical architecture gate with direct asset/system fitness
   functions for executable payload fields in Asset Kernel metadata, renderer
   imports of privileged layers, missing API security-policy registration,
   missing organization/workspace scope in operational deployment persistence,
   and trusted-reference capability widening. Add negative fixture tests for
   every rule and update the architecture verification map.
8. Add a security and accessibility qualification procedure. Automated evidence
   will cover parser bombs/path collisions/digest confusion, authorization and
   tenant denial, sandbox-unavailable behavior, secret/path redaction, IPC/API
   parity, keyboard semantics, labels, live/busy/error states, and reference
   presenters. Manual OWASP ASVS-informed security review and WCAG 2.2 AA
   review remain explicit required evidence rather than an automated
   conformance claim.
9. Update operator/user guidance, context packs, examples, support/deprecation
   policy, and the roadmap. Run focused revocation, compatibility, admission,
   fitness, qualification-schema, performance-runner, security, accessibility,
   transport, persistence, and host tests, followed by the full repository
   gates and available builds/packages. Record unavailable controlled-platform
   checks without converting them into passes.

Rollback plan: the compatibility, quality, and evidence manifests and their
fitness checks are additive and can be removed together if their schema must be
replaced. Revocation enforcement is fail closed and uses the existing immutable
implementation and deployment histories; rollback selects an unaffected prior
release and never deletes a revocation. Removing a presenter or qualification
runner does not widen runtime authority. A rollback must not disable the
existing dependency audit, package admission limits, workspace/organization
scope, capability narrowing, or sandbox-unavailable denial.

Research notes: NIST SSDF treats vulnerability response and root-cause feedback
as part of secure software development, while SPDX notes that SBOM vulnerability
information becomes stale and consumers must re-evaluate it. CISA's Known
Exploited Vulnerabilities catalog is therefore a prioritization input, not an
automatic package verdict. OWASP ASVS supplies a review vocabulary for technical
application controls, but a checklist is not a penetration test. WCAG 2.2 is the
current W3C Recommendation and Level AA requires all Level A and AA success
criteria; automated semantic tests cannot establish full conformance. Semantic
Versioning requires a minor release when public API is deprecated and a major
release for incompatible changes, while immutable system locks still preserve
the exact admitted versions. Node's stable performance APIs support monotonic
high-resolution measurements, but budgets must name workload and environment to
be meaningful. Electron's security guidance continues to require sandboxing,
context isolation, narrow bridges, sender validation, secure content, and a
current framework. NIST contingency guidance and PostgreSQL backup guidance both
support rehearsed, isolated recovery; neither chooses this product's RPO/RTO.

Research sources:

- [NIST Secure Software Development Framework 1.1](https://csrc.nist.gov/pubs/sp/800/218/final)
- [OWASP Application Security Verification Standard 5.0](https://owasp.org/www-project-application-security-verification-standard/)
- [W3C Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)
- [Semantic Versioning 2.0.0](https://semver.org/)
- [SPDX 2.3 vulnerability and SBOM guidance](https://spdx.github.io/spdx-spec/v2.3/how-to-use/)
- [CISA Known Exploited Vulnerabilities Catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)
- [Node.js performance measurement APIs](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html)
- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [NIST contingency planning guidance](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final)
- [PostgreSQL SQL dump backup guidance](https://www.postgresql.org/docs/current/backup-dump.html)

Implementation evidence:

- `dev-tools/config/asset-system-qualification.json` now owns the exact
  compatibility/deprecation matrix, six p95 workload budgets, five admission
  control groups, and required evidence for all five deployment profiles;
- the qualification assessor rejects missing/failed evidence and rejects a
  performance pass without a complete validated p95 report. The Node runner
  measures trusted probes with a monotonic clock and omits raw samples/results;
- the canonical architecture gate now checks executable Asset Kernel metadata,
  renderer-to-privileged imports, asset/system route-policy coverage,
  organization/workspace deployment scope, closed trusted capabilities, and
  manifest-to-source admission-limit drift, with negative fixtures;
- package admission and system build now reject excessive declarations and
  instances before privileged work, with regression coverage;
- deployment install, activation, health, rollback selection, and run start now
  re-read every frozen implementation revocation. Revocation storage failure
  denies the transition, and a newly revoked active deployment is deactivated
  where possible, persisted as revoked, and denied new starts;
- the support runbook defines vulnerable-package response, immutable upgrade and
  rollback, coordinated metadata/artifact recovery, performance evidence,
  security review, WCAG 2.2 AA review, deprecation, and honest profile status.

Implementation is complete for repository-owned controls. No profile is declared
production-qualified by this increment alone. Cross-platform packages, live
managed services, coordinated recovery, target load/sandbox limits, penetration
review, manual accessibility review, and rehearsed revocation/recovery remain
required controlled evidence and therefore remain `not-run`/`incomplete` until
an owning organization supplies them.

- Minimum verification:
  - full repository tests, architecture, docs, agent-support, security dependency,
    server/thin builds, and desktop packaging;
  - live PostgreSQL and object-storage integration;
  - controlled environment recovery and revocation drills;
  - cross-platform desktop qualification;
  - load, concurrency, cancellation, and sandbox resource-limit tests;
  - manual security and accessibility evidence where automation is insufficient.
- Exit evidence:
  - each supported deployment shape has qualifying evidence for the reference
    systems;
  - recovery and revocation objectives are rehearsed;
  - no structural-only default is advertised as functional;
  - known unsupported behaviors are explicit in UI, docs, and compatibility
    manifests.

## End-to-end acceptance matrix

| User outcome | Required evidence                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browse       | All source kinds appear through one workspace-aware catalog with truthful implementation, trust, compatibility, and readiness states                              |
| Import       | Package inspection is non-executing; admission verifies integrity, provenance, compatibility, permissions, dependencies, and policy; rollback and revocation work |
| Create       | Asset Studio produces a complete definition and a tested implementation/resource/declarative binding, not metadata alone                                          |
| Customize    | Override/link/copy/derive paths preserve source, revisions, conflicts, propagation policy, and lineage                                                            |
| Compose      | System Builder uses AssetInstances, typed ports, bindings, requirements, rules, and reusable nested AssetCompositions without a parallel graph model              |
| Validate     | Missing implementations, incompatible ports, invalid schemas, unsafe policy, unavailable runtimes, and unsupported hosts block build with safe diagnostics        |
| Build        | Frozen inputs resolve deterministically and produce immutable bundles, migrations, SBOM/provenance, tests, compatibility, and evidence                            |
| Run          | Approved releases execute through host/runtime adapters and capability policy; design records and runtime state remain separate                                   |
| Revise       | Asset/system changes create new revisions and releases; previous releases remain reproducible or explicitly revoked                                               |
| Deploy       | Local and managed shapes use the same contracts and logical release while selecting appropriate persistence, storage, build, sandbox, and runtime adapters        |

## Verification strategy

Each increment begins with current primary-source research where a selected
technology or security boundary may have changed, repository impact inspection,
a focused implementation plan, and a rollback/test plan. Each increment ends
with the narrow tests for its change-impact rows plus applicable repository
gates.

Required recurring checks include:

- contract-family normalization/export invariants;
- application use-case policy and denial paths;
- SQLite/PostgreSQL semantic conformance and isolation;
- artifact/object-storage containment and lifecycle;
- API/IPC/preload/client parity and safe envelopes;
- desktop/thin-client presenter, accessibility, empty/error/loading, and
  interaction tests;
- sandbox, capability, credential, network, resource, and cancellation tests;
- dependency audit, SBOM, provenance, signature, and tamper verification;
- architecture fitness functions and documentation/context drift checks;
- `npm run docs:check` after documentation changes;
- `npm run architecture:check` after source/dependency changes;
- `npm run agent-support:check` after context/agent-support changes;
- `npm test` for implementation increments;
- `npm run build:server` and `npm run build:thin-client` for shared/server/client
  changes; and
- desktop typecheck/package qualification when Electron composition, preload,
  renderer, native dependencies, or local sandboxing changes.

An increment is not complete because a contract, page, or adapter exists. It is
complete only when the promised user outcome works through the active host
composition, has truthful unsupported/error states, preserves workspace and
organization isolation, updates canonical documentation, and has executable
verification evidence.

## Documentation and anti-drift updates during implementation

At minimum, accepted decisions and implementation must keep these sources
aligned:

- `docs/adr/decision-readiness.md` and successor ADRs;
- `docs/architecture/asset-kernel.md`;
- `docs/architecture/asset-authoring-customization-and-overrides.md`;
- `docs/architecture/user-library-and-cross-workspace-reuse.md`;
- `docs/architecture/effective-asset-projections.md`;
- `docs/architecture/asset-composition-planning.md`;
- `docs/architecture/system-builder.md`;
- `docs/architecture/runtime-readiness-binding.md`;
- `docs/architecture/execution-plan-preparation.md`;
- `docs/architecture/controlled-conversational-system-execution.md`;
- `docs/architecture/security-architecture.md` or its current owning security
  source;
- `docs/architecture/persistence-and-storage.md` and host/runtime architecture;
- the materially affected context packs, documentation map, and app/feature
  READMEs; and
- direct architecture checks for each newly accepted invariant.

Do not copy this roadmap into canonical docs or context packs. Canonical sources
describe accepted current architecture and implemented behavior; this document
tracks the delivery sequence and must be updated as increments are completed,
narrowed, or replaced by accepted decisions.
