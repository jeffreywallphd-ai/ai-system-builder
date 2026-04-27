# Context Pack: Server Host

- Pack name: `server-host`

## Purpose

- Guide server host composition and HTTP transport adaptation without boundary drift.

## Use When

- Working in `apps/server`.
- Working in `modules/hosts/server`.
- Working in `modules/adapters/transport/api-express` or equivalent Express API transport surfaces.

## Do Not Use When

- Desktop-only host/IPC tasks.
- Runtime/domain/application changes with no server-host or HTTP transport impact.

## Core Guidance

- Server is a host model responsible for process lifecycle and composition.
- Express is the default API transport adapter, not the application architecture center.
- Keep internal application contracts distinct from HTTP-specific request/response details.
- Keep API contracts as transport specializations over shared transport envelopes; do not create API-only success/failure families.
- Keep operation identity transport-neutral (`workspace.create` style), with HTTP route details staying adapter-side.
- Route/controller code must stay thin and delegate use-case behavior inward.
- Server host composition is separate from transport adaptation.
- Server host composition may include multiple specialized storage adapter families (artifact-object plus artifact-repo storage) and should keep that composition explicit.
- Current composition includes artifact-object filesystem storage and the first artifact-repo provider adapter registration (Hugging Face).
- Pass host metadata inward via `modules/contracts/host` host-context contracts,
  not HTTP framework objects.
- Keep host-context metadata small and serialization-friendly (JSON-serializable values only).
- Do not encode auth/session/request/window/framework semantics in host-context metadata.
- `apps/thin-client` is a thin surface over server capabilities, not assumed full parity from day one.
- The thin-client image vertical slice is server-backed end to end for both write and read paths (feature-local HTTP client for upload plus artifact browse/read/content-read -> Express route mapping -> shared use case -> shared storage/persistence capabilities).

## Key Constraints

- Do not accumulate business logic in routes/controllers/middleware.
- Do not encode HTTP semantics into domain/application models.
- Keep host wiring, transport translation, and application orchestration as separate responsibilities.
- Do not hide provider-backed storage semantics behind ad hoc route/UI shortcuts; compose provider-backed adapters explicitly in host wiring.

## Canonical Source Docs

- `docs/architecture/host-model.md` — server host role and thin web client positioning.
- `docs/adr/ADR-0003-host-model-and-transport-separation.md` — host/transport separation decision.
- `docs/architecture/module-dependency-rules.md` — dependency and boundary rules.
- `docs/architecture/system-overview.md` — app/host/transport placement model.
- `docs/standards/coding-standards.md` — boundary-safe coding and anti-patterns.

## Common Over-Inclusions to Avoid

- Desktop/Electron details for server-only work.
- Pulling runtime adapter specifics unless server task directly invokes runtime integrations.
- Treating thin web client concerns as full-stack parity requirements.

## Prompt Assembly Notes

- Typical set: `index` + `server-host`.
- Add `architecture` for boundary-sensitive refactors.
- Add `logging` for startup/request diagnostics and `testing` for route/host integration behavior.



## Current implementation checkpoint (server host)

- `composeServerHost` now wires artifact-repo use cases and route registration for `POST /api/artifact-repo/has`, `POST /api/artifact-repo/store`, `POST /api/artifact/publish`, and `POST /api/artifact/publish/verify`.
- `composeServerHost` now wires artifact-repo use cases and route registration for `POST /api/artifact-repo/has`, `POST /api/artifact-repo/store`, `POST /api/artifact/publish`, `POST /api/artifact/publish/verify`, and `POST /api/artifact/source/verify`.
- These routes delegate through application use cases; they do not bypass to storage adapters directly.
- Thin-client artifact-browser publish flow should target `POST /api/artifact/publish` as the primary user workflow route.
- Thin-client artifact-browser re-check flow should target `POST /api/artifact/publish/verify` to update durable verification state/time without republishing bytes.
- Thin-client artifact-browser source re-check flow should target `POST /api/artifact/source/verify` for imported-source backing verification refresh.
- Desktop host uses the same shared `PublishArtifactToRepoUseCase` path via IPC/preload transport (separate host/transport wiring, shared application orchestration).


- Server route surface now includes `POST /api/artifact/register-from-repo` delegating to shared application use-case orchestration.
- Server route surface now also includes `POST /api/artifact/localize-from-repo` for explicit localization/download of imported artifacts through shared application orchestration.


- Server host route surface now includes Hugging Face token config endpoints (`GET/POST/DELETE /api/config/huggingface-token`) so thin-client users can recover from auth-required artifact errors without leaving the product.
