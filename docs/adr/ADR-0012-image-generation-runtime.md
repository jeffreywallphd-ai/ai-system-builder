# ADR-0012: Image Generation Runtime Architecture and Contracts

## Status
Proposed

## Context

The platform needs image generation as a first-class capability while preserving clean architecture boundaries established for runtime-backed AI work.

Existing long-running runtime flows (dataset preparation and model training) already use async lifecycle semantics through runtime task contracts. Image generation must align with that lifecycle model instead of introducing a separate execution pattern.

The system also needs to support engine variability over time (ComfyUI, local Python libraries, remote APIs) without leaking engine-specific structures into domain/application contracts.

## Decision

Image generation is established as a **first-class feature** with execution managed through the **Runtime Task Registry** lifecycle.

- Image generation execution uses `RuntimeTaskRegistryPort` lifecycle operations (`startTask`, `getTaskStatus`, `cancelTask`).
- ComfyUI is treated as a runtime sidecar implementation detail, not a domain dependency.
- Image generation contracts remain engine-agnostic and do not encode ComfyUI workflow graph structures.

## Key Principles

- Contracts must not contain UI-specific or ComfyUI-specific payload structures.
- Image generation follows the same async task lifecycle as dataset preparation and model training.
- Generated outputs are represented as assets with stable identity and metadata.
- Artifacts remain storage-backed objects; artifacts do not replace assets as semantic entities.

## Architecture

Layered execution flow:

Renderer/UI
→ Application Use Case
→ ImageGenerationPort (engine abstraction)
→ RuntimeTaskRegistryPort
→ Runtime Adapter (ComfyUI, future engines)
→ Sidecar (ComfyUI server)

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

## Non-Goals (This Prompt)

- No UI implementation
- No ComfyUI workflow editor
- No model downloading workflows
- No ControlNet or advanced generation features
- No runtime adapter/client implementation changes

## Consequences

### Positive

- Preserves strict layer boundaries and contract purity.
- Enables future engine additions without contract churn.
- Reuses shared async lifecycle semantics and operational patterns.

### Tradeoffs

- Requires adapter mapping work in follow-up prompts.
- Defers engine-specific power-user features until boundary contracts are stable.

## Separation of Concerns

- Contracts define intent and shared semantics only; they do not encode runtime-specific payloads.
- Runtime payload mapping is performed in adapters at execution boundaries.
- `ImageGenerationRequest` is not equivalent to a ComfyUI workflow definition.
- Asset registration occurs after runtime completion in the application layer, not in the runtime adapter layer.

## Runtime Installer Alignment (Prompt 1/4)

- ComfyUI may be auto-installed through the Runtime Installer abstraction before runtime startup, based on host/runtime configuration.
- ComfyUI supervisor integration with installer pre-start checks is deferred to a later prompt.
- Installation concerns remain separate from image generation contracts and use-case orchestration.
