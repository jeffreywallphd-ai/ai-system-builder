# Context Pack: Server Host

- Pack name: `server-host`

## Purpose

- Guide server host composition and HTTP transport adaptation without boundary drift.
- Keep `apps/server`, server host wiring, Express routes, and thin-client API behavior aligned to shared contracts and use cases.

## Use When

- Working in `apps/server`, `modules/hosts/server`, or Express API transport adapters.
- Adding/changing server route registration, middleware, HTTPS/security mode, server runtime ownership, storage/runtime root composition, or thin-client API behavior.
- Diagnosing server-backed thin-client failures.

## Do Not Use When

- Desktop-only IPC/preload work.
- Pure domain/application/runtime changes with no server host or HTTP transport impact.

## Core Guidance

- Server is a host responsible for process lifecycle, configuration, and composition.
- Express is a transport adapter, not the application architecture center.
- Keep route/controller code thin and delegate use-case behavior inward.
- Managed published-system runtimes use provisioner-created per-instance
  PostgreSQL databases and distinct least-privilege runtime roles. Runtime code
  never receives provisioner authority and host shutdown drains runtime pools.
- Keep API contracts as transport specializations over shared envelopes and operation identities.
- Keep HTTP request/response details out of domain/application models.
- Pass small JSON-serializable host context inward; do not pass framework/session/window objects.
- Compose provider-backed storage, runtime readiness, security, and feature use cases explicitly in host wiring.
- Thin-client is a server-backed surface over server capabilities; it must consume API clients rather than server internals.

## Host-Owned Runtime And Storage Roots

- Server may own runtime sidecars such as ComfyUI/Python when server is execution authority.
- `SERVER_RUNTIME_ROOT` is for runtime installs/caches.
- `SERVER_STORAGE_ROOT` is for artifact/storage records and must not be reused as a runtime root by accident.
- Server and desktop runtime roots/processes are independent by default; see ADR-0013 for cross-host runtime ownership.
- Server readiness providers read bounded status only and must not start/stop/install/repair runtimes.

## Current Implementation Shape

- Server host composes artifact-object storage, artifact-repo storage, Hugging Face provider configuration, security middleware, runtime readiness, model/image-generation/dataset runtime capability providers, and Asset Registry read/mutation seams where applicable.
- Asset Registry server routes are facade-backed and read-only for list/detail/resource-backed reads unless one of the approved controlled mutation wrappers is in scope.
- Approved Asset Library mutation wrappers are narrow: register resource-backed view, finalize generated output, import external repository object, and localize external repository object.
- Workspace-aware server APIs accept explicit workspace context and must not fall back to global records for workspace-scoped resources.
- Thin-client workspace create/select/switch behavior is server-authoritative; the thin-client must not derive authoritative workspace ids from display names.

## Key Constraints

- Do not accumulate business logic in routes, controllers, or middleware.
- Do not bypass use cases by calling persistence/storage/runtime/provider adapters directly from routes.
- Do not expose host composition objects, repositories, token stores, runtime adapters, provider clients, or local paths through APIs.
- Unknown `/api/*` routes should be denied by centralized route policy.
- Public API errors must be sanitized and preserve safe status/code details.
- Do not add server routes for pack import/export/install/activate, resolver execution, provider browsing, scans, byte reads, workflow execution, collaboration, or marketplace behavior unless canonical scope changes.

## Canonical Source Docs

- `docs/architecture/host-model.md` - server host role and thin-client positioning.
- `docs/adr/ADR-0003-host-model-and-transport-separation.md` - host/transport separation.
- `docs/adr/ADR-0013-host-owned-runtime-execution-and-feature-placement.md` - server/desktop runtime ownership.
- `docs/architecture/module-dependency-rules.md` - dependency and boundary rules.
- `docs/architecture/system-overview.md` - app/host/transport placement model.
- `docs/standards/coding-standards.md` - boundary-safe route and host code.

## Companion Packs

- `security` for route policy, HTTPS/TLS, token, pairing, and sanitized API errors.
- `runtime`, `runtime-installer`, and `runtime-readiness-binding` for runtime-owned server behavior.
- `persistence-storage` for storage/runtime root separation and artifact/model/dataset/image storage.
- `asset-kernel` for Asset Registry/Library and resource-backed view server routes.
- `desktop-implementation` only when thin-client UI/client behavior is in scope.
- `testing` for route/host integration and regression coverage.

## Common Over-Inclusions To Avoid

- Desktop/Electron details for server-only work.
- Runtime adapter internals unless the server task directly invokes runtime integrations.
- Treating thin-client concerns as automatic full desktop parity.
- Keeping phase-by-phase server route history in prompt context.

## Prompt Assembly Notes

- Typical set: `index` + `server-host`.
- Add `security` for route policy/auth/TLS changes.
- Add feature/runtime/storage/asset packs only for boundaries directly touched.
