# ADR-0012: Image Generation Runtime Architecture and Contracts

- Status: accepted

## Context

The platform needs image generation as a first-class capability while preserving clean architecture boundaries established for runtime-backed AI work.

Existing long-running runtime flows (dataset preparation and model training) already use async lifecycle semantics through runtime task contracts. Image generation must align with that lifecycle model instead of introducing a separate execution pattern.

The system also needs to support engine variability over time (ComfyUI, local Python libraries, remote APIs) without leaking engine-specific structures into domain/application contracts.

## Decision

Image generation is established as a **first-class feature** with execution managed through the **Runtime Task Registry** lifecycle.

- Image generation execution uses `RuntimeTaskRegistryPort` lifecycle operations (`startTask`, `getTaskStatus`, `cancelTask`).
- Shared runtime readiness contracts may describe whether the host-owned `image-generation` capability and its runtime dependencies are available before/around execution, but they do not replace task registry lifecycle records.
- ComfyUI is treated as a runtime sidecar implementation detail, not a domain dependency.
- Image generation contracts remain engine-agnostic and do not encode ComfyUI workflow graph structures.

## Key Principles

- Contracts must not contain UI-specific or ComfyUI-specific payload structures.
- Readiness summaries/reasons/actions must stay transport-neutral; ComfyUI protocol details and filesystem paths remain adapter details.
- Image generation follows the same async task lifecycle as dataset preparation and model training.
- Generated outputs are represented as assets with stable identity and metadata.
- Artifacts remain storage-backed objects; artifacts do not replace assets as semantic entities.

## Architecture

Layered execution flow:

Renderer/UI
-> Application Use Case
-> ImageGenerationPort (engine abstraction)
-> RuntimeTaskRegistryPort
-> Runtime Adapter (ComfyUI, future engines)
-> Sidecar (ComfyUI server)

Boundary responsibilities:

- Renderer/UI requests generation via application APIs only.
- Application orchestrates validation and lifecycle calls through ports.
- Runtime adapters map generic requests/results to engine-specific runtime calls.
- Sidecars execute generation workloads and return outputs for artifact + asset registration.

## Asset Model

`ImageAsset` (conceptual contract target):

- `assetId`
- `artifactId`
- `source`: `uploaded` | `generated`
- `metadata`:
  - `prompt`
  - `negativePrompt`
  - `seed`
  - `model`
  - `engine`
  - `workflowTemplateId`
  - `dimensions`
  - `createdAt`

Clarifications:

- Assets carry identity + meaning for product behavior.
- Artifacts provide storage backing and retrieval mechanics.
- Generated images must be registered as assets.
- Uploaded images may be promoted to assets in future workflows.

## Runtime Model

- Add `TaskType.IMAGE_GENERATION` to shared runtime task taxonomy.
- All image generation execution uses Runtime Task Registry lifecycle operations:
  - `startTask`
  - `getTaskStatus`
  - `cancelTask`

## Engine Strategy

- ComfyUI is the first runtime engine implementation.
- Future engines include local diffusers-based runtimes and remote/cloud APIs.
- Engine-specific request mapping, workflow translation, and adapter quirks are confined to runtime adapters only.

## Non-Goals

- No ComfyUI workflow editor.
- No ControlNet or advanced generation features.
- No image-generation contract dependency on ComfyUI workflow JSON.
- No UI/runtime shortcut around the Runtime Task Registry lifecycle.
- No model download workflow requirement inside image-generation contracts; model management remains a separate feature boundary.

## Consequences

## Host-owned execution clarification

Image-generation execution is host-owned. Desktop-local and server-side ComfyUI runtime instances are independent by default, including host-specific ComfyUI install roots, Python environments, runtime process state, and runtime caches.

Runtime roots are separate from artifact storage roots. Generated images must be finalized into the executing host's artifact storage. Thin-client flows must not rely on ComfyUI temp output paths or server filesystem paths.

Future desktop-remote image generation (not yet implemented) should return server-owned artifact/image references through desktop IPC-facing APIs, or explicitly localize/import artifacts when local copies are required. Model/checkpoint resolution belongs to the executing host's model registry/checkpoint resolver, not UI components.

- Related canonical guidance: ADR-0013


### Positive

- Preserves strict layer boundaries and contract purity.
- Enables future engine additions without contract churn.
- Reuses shared async lifecycle semantics and operational patterns.

### Tradeoffs

- Requires adapter mapping work in follow-up work.
- Defers engine-specific power-user features until boundary contracts are stable.

## Separation of Concerns

- Contracts define intent and shared semantics only; they do not encode runtime-specific payloads.
- Runtime payload mapping is performed in adapters at execution boundaries.
- `ImageGenerationRequest` is not equivalent to a ComfyUI workflow definition.
- Asset registration occurs after runtime completion in the application layer, not in the runtime adapter layer.

## Runtime Installer Alignment

- ComfyUI may be auto-installed through the Runtime Installer abstraction before runtime startup, based on host/runtime configuration.
- ComfyUI supervisor integration with installer pre-start checks is implemented through host/runtime composition where an installer is supplied.
- Installation concerns remain separate from image generation contracts and use-case orchestration.

## UI Result Presentation

- Desktop and thin-client image-generation UI must keep the last finalized artifact-backed result visible while a later generation request is queued, running, or finalizing.
- The visible current result is swapped only after the replacement generation has completed and its preview media has been resolved.
- Session galleries are UI/session state only. They may list previous artifact-backed generations from the current working session, but they must not become a second persistence source or expose runtime/temp filesystem paths.
- Desktop may provide scrollable galleries and maximized previews over artifact/media URLs. Thin-client galleries should remain responsive, single-column, and media-reference based, with no dependency on local server paths.
- Loading indicators are presentation state over the existing task lifecycle and must not create alternate execution semantics.
- Runtime-not-ready responses should surface as actionable readiness/setup guidance in UI rather than as completed generation failures when no runtime task was started.
- API routes should emit structured received/succeeded/failed events for image-generation operations so server/thin-client failures are observable without exposing raw runtime paths, prompts, secrets, or sidecar payloads.
- If a submitted ComfyUI task crashes the runtime before queue/history can be read, task status reads should return a terminal failed image-generation task with sanitized recent runtime evidence instead of surfacing a generic transport/API failure.
- Managed ComfyUI Python environments must reject unsupported Python versions before dependency installation or sampling. Python versions that can install packages but are not supported by Torch/ComfyUI should be treated as setup failures and, for managed venvs, stale unsupported environments may be recreated non-destructively without deleting models or the ComfyUI checkout.
- Server-side CUDA startup selected only because a CUDA wheel index is configured is a best-effort acceleration path. If CUDA Torch setup fails during automatic selection, the server may fall back to CPU mode so generation remains available; explicit CUDA/runtime-device overrides should still fail loudly when their requested setup cannot be completed.
