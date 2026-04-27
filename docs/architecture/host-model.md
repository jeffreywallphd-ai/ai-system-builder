# Host Model

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

## Server host

- Owns server process lifecycle and composition.
- Uses transport adapters (default: Express) for API exposure.
- Keeps route/controller logic thin and delegates use-case behavior inward.

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
- Multipart parsing for that server-backed artifact-upload path stays in the Express transport adapter and should parse
  the live request stream with Busboy rather than buffering the full request body before parsing.

## Practical boundaries

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


### Current host parity for repo-backed artifact workflows

- Server API and desktop IPC/preload both expose shared publish, published-verify, source-verify, register-from-repo, and localize-from-repo use cases.
- Thin-client and desktop renderer surfaces remain host-specific UI layers but call into the same shared application workflow path.


## Hugging Face token host configuration

- Server host now exposes a persisted Hugging Face token config seam for thin-client users (`GET/POST/DELETE /api/config/huggingface-token`).
- Desktop host exposes equivalent token config through preload/IPC so renderer flows can save/update/clear token without environment restarts.
- Artifact register/localize/publish/verify flows read token from host config at execution time; users no longer need to re-enter token per action.
- Public repositories may work without token; private/gated repositories can require one.
