# Desktop host composition

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`composeDesktopHost` wires desktop-host lifecycle dependencies while keeping Electron IPC transport thin.

Current composition includes:

- artifact-object storage via filesystem adapter,
- local artifact catalog and storage-binding persistence,
- artifact-browser read + media retrieval use cases,
- artifact-repo storage composition with Hugging Face provider registration.

## Desktop artifact authorization and sender trust

When the production desktop host has its persisted local identity, it composes
workspace authorization from the canonical organization and membership
repositories. Artifact reads, mutations, uploads, and publication resolve the
local principal and workspace before protected storage/provider work. Artifact
publication requires `artifact:write` and `provider-credential:use`; creating a
missing provider repository additionally requires
`provider-repository:create` and explicit creation approval. Authorization
decisions are written to the dedicated host-owned security audit log, separate
from normal diagnostics.

Electron transport trust is supplied by the app main process, not inferred by
feature code. Artifact handlers accept only invocations from the main frame of
a live desktop window owned by that process. Tests may inject a bounded trust
double, but production registration must use the owned-window policy.

## Hugging Face token configuration

- `composeDesktopHost` passes `options.artifactRepo.huggingFaceAccessToken` into the Hugging Face adapter.
- If that option is omitted, the adapter falls back to `HF_TOKEN`, then `HUGGING_FACE_TOKEN` in the desktop host environment.
- Desktop renderer artifact-repo operations (`register`, `localize`, `publish`, `verify`) use this host path via preload/IPC and therefore depend on desktop host token configuration for private/gated repositories.
- Public Hugging Face repos may work without a token; private/gated repos surface explicit auth-required (`unavailable`) errors.

## FaceID behavior (Image Generation)

FaceID is optional in the image generation feature. When enabled in the desktop UI, users can select 1-3 uploaded image artifacts as face references and pass FaceID tuning parameters (identity/structure/noise) with the generation request payload.

The managed ComfyUI workflow prepares selected image artifacts into the runtime input directory and uses the first FaceID reference as an image-to-image latent source when no explicit latent reference is selected. This keeps facial retention usable without requiring custom InstantID/InsightFace nodes in the local runtime install.

## Feature lifecycle disposal policy

Desktop host composition keeps core startup services resident and treats feature disposal as an explicit lifecycle concern of host-owned lazy providers. Local foundations such as artifact storage, model registries, asset definitions, settings, workspace shell, logging, diagnostics, and runtime readiness remain resident or warm after first use. Clearly transient features such as artifact remote/Hugging Face adapters, website ingestion, dataset preparation without active tasks, Context Management without active generation/retrieval tasks, and image generation without active tasks may be disposed by explicit developer action or scoped idle timeout.

Context Management is composed lazily over the retained artifact and runtime
foundations. Its generation, browser, retrieval, deletion, and task-list
operations share one application facade, and active context tasks block generic
feature disposal.

Generic disposal must not delete persisted records or files, must not stop Python or ComfyUI, and must not cancel active runtime work. Python process stop, Python model unload, and ComfyUI process/runtime unload remain explicit user/runtime-control paths.

Explicit Python-backed execution requests such as dataset preparation use the
desktop host's bounded capability activation seam. When readiness initially
reports the lazy Python runtime as stopped, the execution guard starts the
supervisor, reads live supervisor-backed readiness again, and proceeds only when
the requested capability is ready. Passive readiness, task status, list, and
cancel reads do not start the runtime. Startup or readiness failures remain
fail-closed and expose only sanitized capability details.

Desktop Python composition canonicalizes both the worker bind and client base
URL to host-owned loopback HTTP, then delegates per-launch bearer generation and
rotation to the shared Python runtime foundation. Runtime launch credentials are
child-only state and must not be included in desktop logs, diagnostics, preload,
IPC, or renderer data.
