# Context Pack: Runtime Model

- Pack name: `runtime`

## Purpose

- Guide runtime-related implementation while preserving the TypeScript-first, adapter-driven architecture.
- Keep runtime execution, readiness, diagnostics, and task lifecycle responsibilities distinct.

## Use When

- Implementing runtime execution flow, runtime contracts, Python/ComfyUI adapters, runtime task behavior, runtime readiness, or runtime diagnostics.
- Diagnosing runtime-backed feature failures.
- Changing runtime root, sidecar, installer, or capability-provider behavior.

## Do Not Use When

- Pure UI/docs work with no runtime execution or capability impact.
- Host wiring work that only passes through existing runtime seams and does not change runtime behavior.

## Core Guidance

- Node.js + TypeScript is the default core runtime path.
- Python/ComfyUI and other runtimes are adapter paths under `modules/adapters/runtime`.
- Shared runtime vocabulary belongs in `modules/contracts/runtime`.
- Runtime-specific protocol details stay out of core contracts and application/domain logic.
- Runtime operation identity should be helper-driven and transport-neutral.
- Runtime diagnostics specialize shared structured logging; do not invent parallel runtime-only diagnostics.
- Runtime readiness describes host-owned capability availability; it is not a runtime protocol payload or task lifecycle record.
- Runtime Task Registry is the lifecycle authority for accepted long-running tasks.
- Feature starts should guard required readiness before task creation and should not return pollable task ids when rejected as unavailable.
- Dataset preparation is the dataset-producing boundary; model training is the model-producing boundary.
- Dataset preparation source options must come from the shared capability registry. The worker creates physical aggregate, train, validation, and test outputs, keeps source/group and exact-content duplicates in one deterministic split component, and reports counts derived from those outputs.
- The worker startup dependency probe includes the exact patched PyArrow pin
  required for bounded Parquet input/output; Parquet support must not depend on
  an uninstalled training-only requirements file.
- Managed Python setup includes the exact Context LanceDB requirements by
  default. Explicit RAG create/inspect/query starts repeat an asynchronous
  one-flight exact-version/import probe and bounded install/re-probe before
  dispatch, reporting only fixed task progress. Readiness/capability/status/list
  reads remain no-install operations.
- Automatic model placement uses the exact managed Accelerate pin. Startup
  repairs it before readiness, and generation preflight reports a sanitized
  repair code instead of degrading a missing component into zero examples.
- Generic Transformers readiness requires configuration, complete weights or
  indexed shards, and tokenizer files. Readiness is a local-only check and must
  never trigger network acquisition. Incomplete caches fail with a distinct
  sanitized reason, remain resumable only through the explicit model-download
  task, and never count as a cache hit. Structured download progress is
  rate-limited and replaces unstructured stderr progress. Generation `skip` applies only
  to explicit source no-candidate results; load, decoder, output, inference,
  dependency, and unexpected runtime failures stop with sanitized reason codes.
- Desktop IPC and authenticated server HTTP expose the same asynchronous start/read/cancel lifecycle. Workspace ownership is recorded at start and every status read or cancellation must fail closed for another workspace.
- Model training emits progress for every completed microbatch. Runtime success
  remains staged until an explicit workspace-scoped save or discard action;
  pending-review responses are path-free, save performs registration/storage or
  publication once, and discard removes staged runtime output. Desktop offers
  one unload action after each terminal training run without depending on the
  generation-model inventory, because task-local training models are not listed
  there; the existing active-task denial remains authoritative.
- Dataset preparation task profiles are shared contract metadata and executable dataset-output profiles in the Python worker. Text-bearing profiles choose provided source text or local-model-generated text through `task.textInputMode` and `generation.promptTemplate`; built-in generation presets are quality 7B (`Qwen/Qwen2.5-7B-Instruct`) and compact 3B (`Qwen/Qwen2.5-3B-Instruct`). Task-scoped generation parameter defaults live in runtime contracts; UI may expose them in an automated formatting section but must not hardcode QA-generation settings keys or duplicate model parameter fields. LLM profiles can emit structured/generated text rows; diffusion and vision profiles emit image manifest rows from metadata or structured manifests. Model training requests carry the selected training task. Executable Python training supports causal-LM text training for LLM instruction/classification/extraction/embedding/reranker tasks, diffusion LoRA adapter training for image-caption manifests, and vision LoRA or full-finetune training for classification, detection, and segmentation manifests. Image-manifest text generation uses metadata/annotations rather than pixel understanding; image-manifest model training must receive runtime-local source file paths through dataset metadata instead of making the Python worker read artifact storage directly.
- Capacity-aware model defaults step an untouched 7B preset down to 3B on a
  constrained host. Explicit/saved choices remain authoritative, but live
  weight-memory preflight rejects implicit disk offload, and model-status reads
  remain nonblocking while valid construction proceeds.
- Optional local token-constrained JSON generation is Python-adapter behavior,
  not a new core runtime. The worker advertises
  `dataset-preparation.constrained-json` only when the exact reviewed decoder
  pins are available on Python 3.10 through 3.13. Checked mode uses the one
  compiler-owned exact schema for token masks, parsing, and validation and
  fails closed without an unconstrained retry. Unchecked mode remains explicit
  and keeps strict structural and semantic validation.

## Runtime Readiness Rules

- Capability ids cover Python runtime, ComfyUI runtime, image generation, dataset preparation, model training, model validation, and model publishing.
- Model publishing may be composed as a readiness capability while still reporting unavailable/not implemented until a task implementation exists.
- Readiness snapshots are host-scoped and should read each top-level provider at most once per snapshot.
- Missing-provider statuses are for direct or explicitly requested capabilities, not every unsupported future capability.
- Readiness reads, task status reads, task cancel reads, and task list reads must not start, stop, install, repair, or unboundedly probe runtimes.
- Explicit state-changing feature starts may use a host-injected bounded
  activation seam for an eligible local runtime, but must re-read readiness and
  fail closed before task creation. Never expose raw activation failures or use
  this seam from passive readiness/task reads.
- The managed Python sidecar is host-private: bind/client configuration is
  canonical loopback HTTP only, and every endpoint (including readiness probes)
  requires the current per-launch bearer token. Rotate that child-only token
  before every spawn and never expose it through logs, UI, diagnostics, or
  process-wide environment mutation. Do not attach to unauthenticated ambient
  loopback services.
- Provider failures become sanitized readiness/status objects with safe codes/details.

## Key Constraints

- No runtime-specific leakage into domain/application logic.
- Avoid ad hoc per-feature protocols and speculative runtime plugin frameworks.
- Keep filesystem paths, temp paths, env values, secrets, tokens, raw exception messages, command lines, HTTP internals, process internals, and raw adapter payloads out of public readiness/task payloads.
- Runtime/model/plugin downloads are supply-chain concerns and should route through installer/security/storage guidance when touched.
- Decoder schemas, compiled processors, caches, outputs, and diagnostics must be
  bounded; prompts, source content, generated output, local paths, and stack
  details must not enter capability or public task evidence.
- Runtime roots are not Asset Kernel record roots or resource-backed view discovery roots.
- ComfyUI reference images must be retrieved through workspace/catalog-owned,
  byte-bounded artifact media reads, signature-checked, staged with contained
  randomized filenames, and cleaned after terminal or failed execution.

## Asset Kernel Notes

- Include `asset-kernel` when assets declare runtime requirements or bind tools/workflows/models to runtime capabilities.
- Asset requirements may reference shared `RuntimeCapabilityId` values but must not duplicate readiness or task-registry contracts.
- Asset validation may structurally check requirements but must not execute or probe runtimes.
- Resource-backed Asset Registry reads must not use runtime readiness, Runtime Task Registry, ComfyUI, Python runtimes, generation, finalization, dataset preparation, model training/validation/publishing, or runtime install/probe/start behavior to discover records.
- Generated-output finalization is a separate controlled workflow and must not make Asset Kernel reads query runtime/task state.

## Workspace Notes

- Runtime task outputs created from workspace actions require explicit workspace context where implemented.
- Missing workspace context must fail safely for workspace-owned runtime outputs and must not fall back to global records.
- Global runtime readiness and provider diagnostics may remain global but must not masquerade as workspace-owned resources.

## Canonical Source Docs

- `docs/adr/ADR-0002-typescript-first-runtime-model.md` - core runtime decision.
- `docs/adr/ADR-0013-host-owned-runtime-execution-and-feature-placement.md` - desktop/server runtime ownership.
- `docs/architecture/runtime-model.md` - runtime responsibilities and boundaries.
- `docs/architecture/data-management.md` - ingestion-to-dataset preparation flow, split integrity, UI, and diagnostic boundaries.
- `docs/security/data-management-threat-model.md` - source, provider, runtime, split, task ownership, and non-disclosure controls.
- `docs/architecture/runtime-readiness-binding.md` - readiness/capability output.
- `docs/architecture/module-dependency-rules.md` - adapter dependency constraints.
- `docs/standards/logging-standards.md` - runtime diagnostics and redaction.
- `docs/standards/testing-standards.md` - runtime adapter and boundary testing.

## Companion Packs

- `runtime-task-registry` for start/read/cancel/list lifecycle behavior.
- `runtime-installer` for installation, dependency setup, and installer state.
- `image-generation` for ComfyUI/image generation feature behavior.
- `server-host` or `desktop-host` when host-owned runtime composition changes.
- `security` for process, dependency, env, credential, and diagnostic hardening.
- `testing` for runtime regressions and adapter behavior.

## Common Over-Inclusions To Avoid

- Full host model detail for host-agnostic runtime contract work.
- Transport adapter specifics unless invocation crosses API/IPC boundaries.
- Treating readiness reads as health probes that start or repair sidecars.
- Keeping phase history in runtime prompt context.

## Prompt Assembly Notes

- Typical set: `index` + `runtime`.
- Add `runtime-task-registry`, `runtime-installer`, or feature packs only when those responsibilities are directly touched.
- Add `logging` for diagnosability-heavy runtime work and `testing` for fixes/refactors.
