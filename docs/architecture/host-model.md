# Host Model

- Status: current
- Related decisions: `docs/adr/ADR-0003-host-model-and-transport-separation.md`, `docs/adr/ADR-0013-host-owned-runtime-execution-and-feature-placement.md`, `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md`, `docs/adr/ADR-0025-deployment-shaped-structured-persistence.md`, `docs/adr/ADR-0026-local-sqlite-runtime.md`, `docs/adr/ADR-0027-managed-postgresql-runtime.md`, `docs/adr/ADR-0039-dedicated-system-runtime-data-plane.md`
- Verification: `docs/architecture/architecture-verification.md`

## Asset Kernel relationship

Assets may declare host and permission requirements, but hosts remain responsible for composition and concrete runtime/readiness provider wiring. Asset metadata should stay declarative and transport/UI-neutral; desktop IPC, server API, and renderer models must not redefine asset semantics. Permission requirements can be validated structurally first, with enforcement added later through application and host policy seams.

## What a host means in this repository

A **host** is the runtime environment composition layer that starts and operates the system in a specific deployment mode.

In `ai-system-builder`, hosts are responsible for:

- lifecycle/startup/shutdown behavior,
- wiring application use cases to adapters,
- environment-specific composition choices.

Hosts are implemented under `modules/hosts/` and surfaced through `apps/*` entry points.

## Host types

## Desktop host (initial implementation priority)

- Built on Electron with Electron Forge (webpack plugin) as the canonical desktop dev/build/package path.
- Owns desktop lifecycle composition and desktop-specific wiring.
- Uses Electron IPC as a transport boundary (via transport adapters), not as business logic location.
- Desktop implementation is split intentionally across Electron `main`, preload, renderer, and host composition:
  - `main`: lifecycle/bootstrap/window creation only,
  - preload: narrow secure renderer bridge,
  - renderer: React UI composition only (no filesystem or IPC internals),
  - host composition (`modules/hosts/desktop`): adapter/use-case wiring.
- Desktop artifact publish/verification uses the same shared application use case path as server/thin-client (`PublishArtifactToRepoUseCase`, `VerifyPublishedArtifactBackingUseCase`) and is exposed through preload+IPC transport wiring rather than renderer-side orchestration.
- Desktop host composition may use focused helper modules for runtime readiness, storage, model management, image generation, and transport registration, but those helpers remain composition-only wiring seams and must not absorb business policy, runtime protocol logic, or IPC payload shaping. Runtime readiness helpers and small runtime-task-registry wiring helpers are extracted; broader storage/model/image-generation decomposition remains future cleanup unless completed in a later change.
- The local deployment shape targets embedded SQLite under the desktop
  application-data persistence root. Desktop startup migrates SQLite, performs
  the explicit rollback-preserving legacy import, and then composes typed
  repositories on the database seam before registering IPC.
- Installed system runtimes use a separate host-owned SQLite adapter that
  derives one contained database per opaque runtime instance. Desktop shutdown
  closes all open runtime databases; renderers receive neither paths nor handles.
- Published visual systems run in a bounded registry of dedicated sandboxed
  `BrowserWindow` instances with a separate minimal preload. Main owns the exact
  window-to-lifecycle-session association, denies navigation, popups, permission
  requests, and foreign/subframe IPC, and performs ordered shutdown: runtime
  windows and conversation sessions, sidecar, runtime databases, then platform
  database. Electron objects remain in app/host code and never enter shared host
  context or application contracts.

## Server host

- Owns server process lifecycle and composition.
- Uses transport adapters (default: Express) for API exposure.
- Keeps route/controller logic thin and delegates use-case behavior inward.
- Server host composition may use focused helper modules for runtime readiness, storage, model management, image generation, and API registration, but those helpers remain composition-only wiring seams and must not absorb business policy, runtime protocol logic, or Express payload shaping. Runtime readiness helpers and small runtime-task-registry wiring helpers are extracted; broader storage/model/image-generation decomposition remains future cleanup unless completed in a later change.
- Campus, corporate, and cloud deployment shapes target PostgreSQL through a
  client/server connection. Explicit managed shapes migrate/import before API
  registration and fail closed; only an unshaped non-production server retains
  named JSON compatibility behavior.
- Managed system runtimes use a provisioner-controlled PostgreSQL adapter that
  creates one database and least-privilege runtime role per opaque instance.
  Runtime pools are bounded and drained before the platform pool on shutdown.

## Why hosts are separate from transport adapters

Transport answers **"how requests/messages move"**.
Host answers **"what process/environment composes and runs the system"**.

Keeping these separate avoids common coupling failures:

- treating Express app setup as the architecture center,
- treating Electron IPC handlers as the business layer,
- mixing lifecycle concerns with request translation concerns.

## Host context contract boundary

When host-aware metadata must cross into inner layers, use the thin host context
contracts under `modules/contracts/host`.

- Keep host context limited to host identity/kind plus lightweight boundary
  metadata.
- Keep host identity ids normalized and serialization-friendly (trimmed non-empty
  string when present).
- Keep metadata JSON-serializable (plain objects, arrays, and primitive values).
- Keep metadata semantics host-neutral and intentionally small; do not introduce
  auth/session/request/response/window/framework semantics.
- Keep framework objects (`BrowserWindow`, Express request/response, etc.) out
  of host context contracts.
- Keep session/auth modeling out of host context unless explicitly introduced by
  a separate decision.

## Shared transport contract core and specialization

Transport adapters should share a transport-neutral contract core under `modules/contracts/transport`.

- The shared core defines generic transport request/response/error envelopes.
- API (HTTP) and IPC contracts specialize this core for transport-specific needs only.
- Specialization must not change application-facing operation identity and result/error semantics.
- API specialization must not introduce HTTP-only transport mechanics into shared contracts (status codes, headers, or framework request/response objects stay adapter-side).
- IPC specialization should add only channel identity context; it must not recreate transport success/failure envelopes.
- IPC channels must stay operation-derived as `ipc.<operation>.<kind>` where kind is `request`, `response`, or `event`.
- Transport-specific mechanics (HTTP status/headers or IPC channel registration details) remain in adapter-level contracts and implementations.

## Supported operating modes

The architecture is designed to support:

1. desktop-only,
2. server-only,
3. desktop-server hybrid (later).

Host kind and deployment shape are related but distinct. `desktop` normally maps
to the `local` deployment shape. The `server` host can run as `campus-server`,
`corporate-server`, or `cloud`; configuration must select that shape explicitly
once database composition is active. Hybrid coordination remains undecided and
must not be inferred from either host kind or persistence target.

### Staging rule

Desktop-first delivery is the first implementation target.

Server and hybrid compatibility should be preserved through boundaries and contracts, but early code should not absorb speculative hybrid complexity.

## Hybrid mode status

Hybrid synchronization/coordination architecture is **not yet fully designed**.

Contributors should:

- avoid claiming parity behavior that is not implemented,
- avoid embedding assumptions that force one future hybrid topology,
- keep host composition modular so hybrid can be added intentionally later.

## Thin web client role

`apps/thin-client/` is a thin host-specific web surface for server interaction.

- It is not assumed to be full feature parity with desktop.
- It composes pages/features/components in a renderer-oriented structure and calls server APIs over HTTP through feature-local clients.
- It should remain structurally distinct from the desktop preload-backed path and avoid duplicating host logic.
- The initial server-backed image vertical slice includes both upload and read-side artifact browse/view behavior:
  - thin-client UI calls server HTTP contracts for artifact upload plus image-backed artifact browse/detail/content-read,
  - the Express adapter stays thin and delegates to shared application use cases,
  - shared server host composition continues to own storage/persistence capability wiring for both write and read flows.
- Server composition installs centralized route policy, authentication, and
  managed organization admission before JSON or multipart parsing. Express
  dispatch stays case-sensitive so canonical policy and handler identity agree.
- Multipart parsing for the server-backed artifact-upload path stays in the
  Express transport adapter and parses the live request stream with Busboy under
  file, field, part, and byte limits. Legacy JSON upload bytes are shape- and
  range-validated before typed-array allocation. Parser failures return the
  shared sanitized API failure contract rather than framework error pages.

## Practical boundaries

## Execution authority and feature placement

Host is the execution authority. Desktop and server each own runtime execution whenever they execute a feature.

Desktop renderer should continue using preload/IPC regardless of local execution or future remote execution. Thin-client calls server APIs and never owns runtime execution.

System deployment follows the same rule. Desktop composes the trusted
`local-desktop` release adapter behind IPC. Server derives `campus-server` for
campus/corporate shapes and `cloud-server` for cloud, then exposes authenticated
deployment lifecycle and run-handoff use cases. The thin client is a command and
safe-read surface only; request bodies cannot select principal, organization,
host capabilities, runtime ABI, or sandbox qualification.

Published-build lifecycle composition is host-owned. Each host injects its
target ID, runtime profile, compatibility policy, capabilities, secret and
egress policy, platform policy, identifier generators, and actor context behind
the application facade. API and IPC accept only workspace, exact release,
projected action, and opaque expected revision. They ignore or reject
renderer-supplied deployment IDs, run IDs, policy, capabilities, secrets, and
egress values.

Activation and start re-read the immutable release and verify its exact digest
before runtime authority is granted. Runtime adapters classify a run as
`visual` or `service`. A visual adapter may return a bounded host launch
descriptor tied to the exact release and runtime profile; a service adapter
starts without a browser surface. The renderer never supplies a launch URL,
path, component, executable, or runtime target.

On desktop, a visual launch descriptor is consumed only by host composition.
The host prepares the required sidecar and opens or focuses one dedicated
runtime window for the exact started deployment. The runtime preload carries no
authority identifiers; main derives them from its bounded window registry and
revalidates before each transcript read or turn submission. A launch failure
compensates with Stop rather than leaving hidden runtime authority active.

Deployment and run records are retained across process restart. A separate
atomic current-deployment pointer selects at most one non-retired deployment
for an organization, workspace, exact release, and host target. Uninstall
retires that pointer only after runtime authority is removed, preserving prior
generations and audit history for recovery and investigation.

Future execution placement should be per feature rather than all-or-nothing. Example future placement:

- image generation: remote
- artifact browsing: local
- training: remote
- model management: local or remote by execution target

## Host-owned runtime roots

Runtime roots are host-owned. Desktop and server runtime roots are independent by default. Avoid sharing ComfyUI/Python install roots across hosts unless an advanced explicit override is configured.

Runtime roots must not be treated as artifact storage roots.

See ADR-0013 for canonical cross-host runtime ownership and placement guidance.

- Apps own framework bootstrap surfaces (for example `express()` instantiation and app-level middleware).
- Host modules compose dependencies and register transport adapters against app-provided ports.
- Transport adapter registration should be feature-sliced (for example `artifact-upload/...`) with only tiny top-level aggregators.
- Host modules may depend on application/contracts/adapters.
- Transport adapters may be selected by hosts.
- Hosts may compose multiple specialized storage adapter families (artifact-object plus artifact-repo providers) when task scope requires it.
- Server/desktop host composition should keep those storage-family choices explicit in composition wiring (for example future Hugging Face artifact-repo provider composition) rather than hiding provider semantics behind ad hoc transport/UI shortcuts.
- Business rules remain in domain/application.
- UI remains separate from host lifecycle internals.

If host code starts accumulating business logic, move that logic inward before it becomes entrenched.

### Private Asset Kernel composition

`modules/hosts/shared/composition/composeLocalAssetKernel.ts` is the shared internal helper for local Asset Kernel composition. It initializes and validates the host-selected Asset Kernel record store and returns repository ports plus existing application registry use cases for host-internal consumers. `modules/hosts/shared/composition/composeInternalAssetRegistry.ts` builds on that helper by composing the application `AssetRegistryReadFacade` as an internal host-owned service with an injected aggregate resource-backed view provider. These helpers expose the internal system-pack installer seam but do not invoke it. The owning desktop/server asset-feature startup composes the safe descriptor/read providers, explicitly invokes and awaits guarded installation of the product-owned global foundation, and fails feature composition closed when that baseline cannot be established. Managed hosts keep immutable definitions on the deployment-selected global store while organization-owned records stay on the request-context store. This lifecycle does not create or seed workspaces, expose installer mutations through public transports, scan resources, perform provider/network calls, read bytes, or place Asset Kernel records under runtime roots.

Asset Registry read-surface baseline desktop composition passes only the internal registry read facade/read port into Electron IPC registration for definition list/read/version reads. It does not pass the full internal registry composition, repositories, mutation use cases, seed services, storage adapters, runtime adapters, or provider clients to asset IPC handlers. The desktop renderer Asset Library consumes only the preload-backed read client and shared UI read models; it does not import host composition, application services, persistence/storage adapters, transport handlers, runtime adapters, or provider clients.

Asset Registry read-surface baseline server composition follows the same boundary: it may hold the full internal Asset Registry privately, but it passes only the read facade/read port to Express Asset Registry route registration. The thin-client Asset Library consumes only the GET-only server API client and shared UI read models. The public API/IPC/preload scope is read-only definition list/read/version-read plus read-only resource-backed view list/detail; no host transport may seed built-ins, mutate assets, scan resources, call runtime readiness/task registries, call providers, read bytes, or expose instances/compositions for this phase.

Asset Library validation diagnostics are explicit read-side details only: normal list and detail reads do not request validation, and the UI may request validation only through the existing read operation with `includeValidation: true`. Advanced technical sections stay collapsed by default, built-in seeding remains explicit/internal, and resource-backed views are visible as computed read models without public scan, provider-call, runtime-call, mutation, or byte-read behavior.

Resource-backed provider wiring stays internal to desktop/server host composition and the application Asset Registry read facade. Public API routes, IPC channels, preload methods, and desktop/thin-client controls expose only read-only resource-backed list/detail views through that facade. Hosts must not own provider business logic or add automatic seeding, registration/import/finalization/localization/publishing workflows, scans, provider/network calls, runtime/task-registry calls, or byte/content reads for resource-backed views.

Hosts wire the four approved controlled asset mutation workflows through narrow use-case dependencies only: register resource-backed view, finalize generated output, import external repository object, and localize external repository object. Server API and desktop IPC/preload wrappers remain transport glue; they do not receive host composition objects, repositories, providers, storage/runtime adapters, token stores, or UI objects. Host registration must not execute mutation use cases or perform provider/network/storage/runtime/finalization/localization work at startup, and no general asset editor, built-in seeding, provider browse/download, runtime execution, scan, or byte/content route is introduced.

Asset-pack serialization remains application-local and in-memory. Hosts should not wire these helpers into startup import/export behavior, file pickers, API routes, IPC channels, preload methods, renderer buttons, package registries, marketplace clients, archive readers/writers, signing keys, active-pack activation, or override editing workflows. Resolver output remains internal application data and must not be exposed directly by hosts; public display must continue through read-facade/read-model sanitization.

Host-specific Asset Library UI actions use only the existing public API/preload clients. Desktop renderer and thin-client UI may show confirmation-driven actions for the same four workflows, but they must not import application use cases/services, host composition, persistence/storage adapters, provider clients, route handlers, runtime adapters, or token stores directly. Asset Library browsing remains read-only and side-effect-free until a user confirms one of those approved actions.

### Current host parity for repo-backed artifact workflows

- Server API and desktop IPC/preload both expose shared publish, published-verify, source-verify, register-from-repo, and localize-from-repo use cases.
- Thin-client and desktop renderer surfaces remain host-specific UI layers but call into the same shared application workflow path.

## Hugging Face token host configuration

- Server host exposes organization-scoped Hugging Face credential status and
  mutation for thin-client users (`GET/POST/DELETE
/api/config/huggingface-token`). Managed access requires the active
  organization plus an owner, administrator, or operator role; the raw value is
  not returned.
- Desktop host exposes equivalent token config through preload/IPC so renderer flows can save/update/clear token without environment restarts.
- Artifact register/localize/publish/verify flows read token from host config at execution time; users no longer need to re-enter token per action.
- Public repositories may work without token; private/gated repositories can require one.

Managed hosts also authorize application setting mutations below transport.
Ordinary shared settings require owner, administrator, or operator role; the
shared model folder and PyTorch/CUDA wheel source require owner or administrator
role and the wheel source is restricted to credential-free HTTPS channels on
`download.pytorch.org`. Artifact publication may request creation of a missing
provider repository only through an explicit approval plus private/public choice.
Managed composition authorizes the exact repository and active organization
before provider I/O; desktop-local composition retains the explicit approval
without inventing a managed principal.

## Host security composition guidance

Hosts choose concrete security modes through composition. Server host owns server security configuration and API transport security setup. Desktop host will later own configured remote-server credential handling, and thin-client relies on server APIs through secure fetch behavior. Development no-auth mode must be explicit and noisy. Future remote desktop execution must route through secure API client adapters behind desktop IPC boundaries. See ADR-0015.

## Workspace contracts and host boundaries

Workspace contracts are shared DTO/type vocabulary. Application ports, local persistence adapters, and workspace use cases own workspace records/indexes, active workspace selection preferences, workspace system-pack activation records, and workspace creation behavior. Hosts must not treat these foundations as permission to add startup workspace creation, active workspace global application-service state, system-pack install/copy behavior, collaboration permissions, invites, sync, or remote auth. The create use case can persist active selection only when explicitly requested and can activate `system.foundation@1.0.0` by reference only, without using the system foundation pack installer or copying definitions. If activation persistence fails after workspace persistence succeeds, hosts should treat the returned failure as a partial workspace-created/no-activation result rather than assuming rollback. Workspace request context remains explicit caller-provided context rather than implicit host state.

### Active workspace UI context

Desktop and thin-client hosts maintain active workspace selection as host/UI/request context for routing and page gating. Workspace-scoped pages must not render resource-backed global lists when no active workspace is selected; they show a non-technical create/select workspace state instead. Once selected, the shell/page displays the workspace display name and passes the workspace id explicitly through renderer page context for later workspace-scoped clients.

The active workspace selection preference is not an authorization grant and must not become application-service global mutable state. Application use cases and transport requests that operate on workspace-owned resources must continue to receive explicit workspace context. Workspace filtering, resource scoping, and persistence scoping belong in application/persistence seams; hosts must not fake those boundaries with UI state alone. Collaboration, invites, sharing, sync, and remote auth remain out of scope.

### Workspace system pack activation availability

Hosts may call the application-layer workspace system pack activation use cases with explicit workspace context to determine which system-owned packs are active for a workspace. Availability is reference-only for the known `system.foundation@1.0.0` pack and does not call the system foundation pack baseline installer or copy system definitions. Asset Library effective-view filtering, artifact/data/model/image scoping, and collaboration must remain explicit host/application boundaries.

## workspace foundations artifact workspace context

Desktop and server hosts forward request/UI workspace ids into artifact browse, read, upload, and artifact-backed resource-view seams. Hosts only compose dependencies and transports; they must not create hidden/default workspaces, auto-migrate legacy global artifacts, or implement workspace filtering rules outside the application/persistence seams.

### Desktop and thin-client workspace UX integration

Desktop and thin-client hosts now expose visible workspace create/select/switch controls in the shell. Workspace-required pages remain reachable from navigation, but render a gated create/select state until an active workspace is available. Home can guide first-run users to create a workspace; hosts must not create hidden/default workspaces or seed workspaces automatically at startup.

Create-workspace UI delegates to the real workspace transport/use case and does not generate authoritative workspace ids locally. The optional System Foundation checkbox requests `system.foundation@1.0.0` activation by reference during workspace creation; it is not a system-pack installer UI and must not copy definitions. Workspace-scoped UI clients pass the active workspace id explicitly on reads/writes and clear or refetch stale records when the active workspace changes. User Library and cross-workspace reuse remain governed by their own canonical docs, and collaboration remains out of scope.

## workspace foundations workspace host composition stabilization

Desktop and server hosts compose workspace repositories, workspace use cases, workspace-aware Asset Registry reads, and workspace-scoped resource adapters/services where implemented. Hosts pass explicit workspace context into application services; they do not implement workspace filtering business rules locally.

Hosts must not auto-create hidden/default workspaces, auto-seed or auto-activate system packs at startup, call the system foundation pack baseline system pack installer during workspace creation, or expose raw storage/runtime paths in diagnostics. Workspace list/create/select operations are safe host surfaces; public pack import/export/install, collaboration permission, invite/sync/remote-auth, user-library, and cross-workspace reuse endpoints remain out of workspace foundations.
