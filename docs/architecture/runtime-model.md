# Runtime Model

- Status: current
- Related decisions: `docs/adr/ADR-0002-typescript-first-runtime-model.md`, `docs/adr/ADR-0010-python-runtime.md`, `docs/adr/ADR-0011-runtime-task-registry.md`, `docs/adr/ADR-0012-image-generation-runtime.md`, `docs/adr/ADR-0013-host-owned-runtime-execution-and-feature-placement.md`, `docs/adr/ADR-0014-runtime-installer.md`
- Verification: `docs/architecture/architecture-verification.md`

## Asset Kernel relationship

Assets may declare runtime requirements, but they must not create a parallel runtime readiness model. Asset requirements should reference shared `RuntimeCapabilityId` values and can be structurally validated before execution or composition. Runtime readiness remains the transport-neutral answer to whether a required capability is currently available, and validation must not execute runtimes or probe heavy sidecars.

## Runtime posture

`ai-system-builder` is **TypeScript-first**.

- Node.js + TypeScript is the native/default runtime path.
- Core architecture (domain, application, contracts, host composition) is designed around this default.

This is a deliberate constraint to keep early implementation coherent and maintainable.

## Why support multiple runtimes at all

Some capabilities are best sourced from non-Node ecosystems (for example, Python-based tools or libraries).

The architecture therefore allows runtime plurality, but in a controlled way:

- external runtimes are integrated through explicit runtime contracts,
- external runtime execution sits in adapter space,
- core use cases remain in application/domain.

## Python position

Python is the first expected external runtime integration path.

Important boundary statement:

- Python is an adapter concern, **not** a co-equal architectural center.
- The system should work with zero Python dependencies for core behavior not requiring runtime adapters.

## Runtime layer responsibilities

Runtime adapters (under `modules/adapters/runtime/`) may own:

- process/session orchestration for external runtime execution,
- request/response translation to runtime contracts,
- error mapping, timeout/retry behavior at the boundary,
- runtime environment checks and adapter-level observability.

Runtime adapters should not own:

- business policy decisions,
- cross-use-case orchestration that belongs in application,
- domain invariants.

Declarative system and foundation-asset previews are non-executing runtime
views. Preview input is bounded before tree construction and rendering: system
composition limits instances, placements, roots, total tree nodes, depth,
configuration depth/keys/array entries/text, while foundation surfaces bound
regions, options, table rows/columns, and text. Values beyond those budgets are
truncated or omitted deterministically. Preview code must not execute authored
HTML, scripts, handlers, workflows, or imported backing resources.

## Contract-first runtime integration

Runtime interactions must be described by explicit contracts (via `modules/contracts/`), such as:

- invocation payload shapes,
- expected result envelopes,
- error categories and normalization expectations.

Current baseline runtime contract family:

- `modules/contracts/runtime/runtime-target.ts` for runtime kind/target selection.
- `modules/contracts/runtime/runtime-execution-request.ts` for request envelope and execution options.
- `modules/contracts/runtime/runtime-execution-result.ts` and `runtime-execution-error.ts` for shared success/failure envelopes.
- `modules/contracts/runtime/runtime-execution-event.ts` and `runtime-execution-diagnostic.ts` for optional progress/output/diagnostic streaming.
- `modules/contracts/runtime/runtime-capability-id.ts`, `runtime-readiness-status.ts`, `runtime-readiness-action.ts`, `runtime-capability-status.ts`, and `runtime-readiness-snapshot.ts` for transport-neutral runtime readiness vocabulary.
- `modules/application/ports/runtime/runtime-execution.port.ts` as the application-facing runtime execution seam.
- `modules/application/services/runtime/runtime-readiness.service.ts` and `modules/application/ports/runtime/runtime-readiness.port.ts` as the application-level seam that maps host-owned runtime lifecycle signals into shared readiness snapshots.

## Runtime readiness contracts

Runtime readiness contracts describe host-owned capability availability before and around runtime task execution. They are shared contracts, not IPC/API/UI contracts and not Python or ComfyUI protocol models.

The readiness vocabulary covers these capability ids: `python-runtime`, `comfyui-runtime`, `image-generation`, `dataset-preparation`, `model-training`, `model-validation`, and `model-publishing`. Readiness statuses are `unknown`, `unavailable`, `not-installed`, `installing`, `starting`, `ready`, `degraded`, and `failed`. Recovery/action hints are `wait`, `start`, `install`, `repair`, `configure`, `retry`, and `view-logs`.

Readiness snapshots may include `capabilityId`, `status`, `healthy`, `available`, `summary`, structured `reason`, `recommendedActions`, generic `details`, `updatedAt`, dependency statuses, and optional host identity metadata. Snapshot scope is host-composed: a host should report only the capabilities it intentionally composes, unless it explicitly asks for every globally known capability. A missing-provider `unknown` status is appropriate for a direct `getCapabilityStatus()` call or an explicitly scoped snapshot capability without a provider; it should not be emitted for every known capability a host intentionally does not support. Within one snapshot read, dependency statuses used by derived feature capabilities must come from the same snapshot-scoped resolution as top-level capability entries so snapshots stay internally coherent and avoid repeated runtime/installer/supervisor reads. Runtime-specific mechanics such as Python protocol payloads, ComfyUI workflow/server details, local filesystem paths, temporary paths, process environment, secrets, tokens, raw exception messages, command lines, and HTTP internals must remain adapter-layer details and are not required shared readiness fields. Readiness provider exceptions are represented as sanitized failed capability statuses using `runtime.readiness.provider-failed`, retry/view-logs actions, and safe structured details such as `failureKind` and `capabilityId` only.

Runtime-backed feature starts must use an application-layer readiness guard for the derived feature capability when one exists (for example `image-generation`, `dataset-preparation`, `model-training`, `model-validation`, or runtime-backed `model-publishing`). The guard reads `RuntimeReadinessPort`, allows `ready` (and `degraded` only when explicitly configured by the caller), and rejects other statuses with transport-neutral unavailable details. For an explicit state-changing execution request, host composition may inject a bounded capability-activation port that starts an eligible host-owned local runtime after an initial unavailable result; the guard must then re-read readiness and fail closed unless the capability becomes allowed. Activation must not install, repair, or bypass readiness, and activation/readiness failures must not expose raw runtime exceptions. Readiness/status/list/cancel operations never receive or invoke this activation port. Transports map guarded-start rejections to IPC `unavailable` or API HTTP 503 failure envelopes with safe capability details, while task status, cancel, finalize-read, artifact, settings, and browse flows continue to use their existing semantics. Model publishing readiness is intentionally composed as an explicit `unavailable`/not-implemented capability on desktop and server until a runtime task implementation is added; guarded publish starts must fail before calling the Runtime Task Registry.

Readiness does not replace `RuntimeTaskRegistryPort`. Readiness answers whether a host-owned capability appears available; the Runtime Task Registry still owns long-running task lifecycle operations (`startTask`, `getTaskStatus`, `cancelTask`, and listing/retention). Runtime installer contracts still own install/discovery/repair/update status. Runtime supervisors still own concrete process lifecycle and health checks. The application readiness service is transport-neutral and UI-neutral: it reads composed provider signals, maps known supervisor/installer states into the shared readiness vocabulary, derives feature capability status from runtime dependencies, reuses snapshot-scoped dependency statuses for derived capabilities, and must not start, stop, install, repair, probe, or execute runtimes. Host composition provides concrete provider closures/readers and may combine multiple same-capability signals (for example installer status plus supervisor health) into one readiness capability. Provider-level failures should be represented as sanitized readiness status objects when the readiness service can isolate them; raw provider messages must not be copied into snapshots or capability reasons. Installer status remains generic `details` context such as `installStatus`; it does not replace supervisor process readiness. When install status is `unknown` while the supervisor is `ready`, the combined readiness status is `degraded` so callers see that execution appears available but install state is unresolved. Desktop IPC and server API routes expose host-scoped readiness snapshots and per-capability status by wrapping the shared readiness contracts in transport envelopes; they must not duplicate readiness shapes or start/stop/install/repair/probe runtimes during reads. Python-specific runtime IPC remains a detailed control and diagnostic surface, not the generic readiness model.

Runtime Task Registry reads are read-side lifecycle operations, not readiness checks. `getTaskStatus`, `cancelTask`, and `listTasks` must not start Python, start ComfyUI, install, repair, or perform heavy sidecar probes. Router-level task correlation may use current-process `requestId` indexes and safe delegate reads to recover missing correlation, but missing tasks must produce explicit unknown/not-found status (including `recordType: "not-found"` when no task family is known) or structured task errors rather than synthetic records that imply accepted work. Unknown/not-found task status must not fake an invalid `TaskType`; use the explicit `recordType: "not-found"` status contract when the task family is genuinely unknown, or a valid task family when a delegate knows it. `listTasks` is best-effort across task families: adapters that track current-process records should return them, and adapters without a safe list endpoint or delegates that fail during listing should report sanitized unsupported task-family metadata or warnings without breaking unrelated delegate listings. Delegate warning details may include delegate name, requested task types, and `failureKind`, but not raw exception messages or environment/path/protocol details. Readiness-guard-rejected starts happen before task creation; transports should return unavailable start failures and no pollable task id, and later status reads for that caller correlation id should remain unknown/not-found unless a task was actually accepted.

Model downloads use `TaskType.MODEL_DOWNLOAD` and the same start/read/list/cancel
lifecycle in desktop and server hosts. Start requests return promptly; UI and
compatibility clients poll through short requests. The application-owned model
download lifecycle validates workspace ownership, projects allowlisted public
progress, and performs model-registry finalization exactly once after runtime
success. Python cache handles and resolved host paths remain private completion
data: they may be passed to the model registry but must not enter generic task
records, API/IPC/preload responses, notification state, or logs.

## Dataset Preparation and Model Training Task Profiles

Dataset preparation is the dataset-producing contract boundary. Model training is the model-producing runtime task boundary. Dataset preparation requests may declare a task profile that describes the dataset shape being prepared for a training family. Model training requests may carry the selected training task so the runtime can validate task support and tag generated model records, but model training remains responsible for base model selection, training method, hyperparameters, output registration, and validation.

The shared runtime contracts define first-tier dataset preparation task types for LLM instruction tuning, LLM classification, LLM extraction, LLM embedding tuning, LLM reranking, diffusion LoRA, vision classification, vision detection, and vision segmentation. Each profile declares model family, expected output schema, supported file formats, required/optional fields, compatible training methods, and runtime support status. This profile vocabulary is intentionally contract-level metadata; it does not by itself imply that every runtime adapter can execute every profile.

Current Python runtime execution support for dataset preparation covers the first-tier task profiles. The shared capability registry truthfully advertises CSV, JSON, JSON Lines, Parquet, text, Markdown, HTML, PDF, DOCX, and supported image sources according to task compatibility. LLM profiles can use supported structured sources when expected fields already exist, or normalize supported documents to markdown, chunk them, and emit task-shaped rows from task-specific structured generations. Diffusion LoRA and vision profiles emit image manifest rows from image artifact metadata or structured manifest files; object detection and segmentation require existing box or mask annotations and fail with a task-specific error when annotations are missing.

Dataset preparation materializes an aggregate dataset and configured physical train, validation, and test outputs. A deterministic component partition keeps rows from the same source/group and exact task-content duplicates in one split. Reported counts are validated against physical output roles before application materialization. See data-management.md for the end-to-end boundary and ../security/data-management-threat-model.md for required controls.

Dataset preparation tasks with textual training inputs declare whether text fields come from provided source data or are generated by a local text-generation model. The recipe carries this as `task.textInputMode` plus `generation.promptTemplate` for the editable task objective used to create examples, labels, captions, or extracted text. Runtime-owned mandatory system rules remain higher priority than that editable objective, treat source/task context as untrusted data, prohibit unsupported facts and instruction disclosure, and require a task-bound JSON Schema envelope with an explicit `ok` or `skip` status. Chat-capable Transformers models receive separate system and user messages through their model chat template; non-chat models receive an equivalent role-labeled prompt. The worker validates exact envelope and example fields, bounds text and extraction depth/size, requires exact allowlisted labels and source spans where applicable, and only then maps generated values to the profile row contract used by JSON, CSV, and Parquet writers. Built-in prompt/model defaults live in the runtime contracts: the quality preset uses `Qwen/Qwen2.5-7B-Instruct`, and the compact preset uses `Qwen/Qwen2.5-3B-Instruct`. Runtime contracts also own task-scoped generation parameter defaults, with Qwen model-card sampling defaults (`temperature` 0.7, `topP` 0.8) used for instruction-style generation and lower temperatures used for labeling, extraction, and annotation tasks where consistency matters. UI surfaces may offer a same-flow model download action for these generation models, but downloads must still route through model-management use cases so model records and lifecycle state stay consistent. Image-manifest text generation uses file names, metadata, annotations, trigger tokens, and allowed labels as context; it does not perform pixel-level visual understanding unless a future multimodal runtime explicitly adds that capability, and it never synthesizes detection boxes or segmentation masks.

Token-constrained JSON is an optional Python-adapter capability for local causal
and chat generation. The shared output-shape compiler remains the authority: its
canonical exact schema is used for prompting, the model-bound next-token
processor, parsing, validation, and later role mapping. The adapter accepts only
a bounded non-recursive schema subset, keeps a bounded model-local LRU of
compiled processors, resets a reused processor before each generation, and
requires EOS after an accepting state. Checked mode fails closed on dependency,
schema, tokenizer, compilation, generation, truncation, parsing, or validation
failure and never retries without constraints. Unchecked mode remains explicit
and must retain strict parsing plus every semantic, grounding, safety,
quarantine, and approval check.

The worker advertises `dataset-preparation.constrained-json` only when exact
reviewed Outlines, Outlines Core, and jsonschema pins are available on Python
3.10 through 3.13. Baseline worker support outside that conditional range does
not imply decoder support. Capability reads are bounded import/version checks;
they do not install dependencies, load a model, or compile a schema.

The model schema contains only fields the model may generate. If source
attribution is selected, the UI displays its locked companion fields, and the
worker appends them after generation from trusted selected-source metadata.
Training consumes the prepared artifact's exact schema fingerprint and
training-purpose paths; selected datasets with missing, malformed, or different
layout metadata fail before model loading.

Dataset preparation UI should present task choices before lower-level settings, keep nonessential settings collapsed by default, and group prompt/model/parameter controls under automated data-formatting language rather than a hardcoded QA-generation or model-override concept. Saved training settings are a renderer convenience for reloading preparation choices such as task, formatting, model, split, and output options; they must not silently preserve selected source artifacts or replace runtime contracts. Source artifact lists should be filtered by the selected task family so LLM tasks show text/document/structured sources and diffusion/vision tasks show image sources plus structured manifests.

Current Python model training support includes causal language model training over text-like dataset files using LoRA, QLoRA, or full fine-tuning through Transformers. The text training path accepts the LLM instruction, classification, extraction, embedding-pair, and reranker training tasks, formats those row schemas into causal-LM training text, and records task tags/metadata on generated model candidates. The multimodal training path accepts diffusion LoRA, vision classification, vision detection, and vision segmentation manifests. Diffusion training supports LoRA adapter output for Diffusers-compatible text-to-image models. Vision training supports LoRA adapter output and full fine-tuning for image classification, object detection, and semantic segmentation models through Transformers image processors and task-specific model classes. Vision LoRA uses PEFT adapter serialization and preserves recognized task heads as trainable modules when the selected model exposes them. For image manifests generated from workspace artifacts, the application model-training use case stages referenced source artifact bytes into runtime-local files and passes runtime-only source path metadata to the Python worker.

## Resource-Backed Asset Registry Boundary

Resource-backed Asset Registry providers do not use runtime readiness or Runtime Task Registry reads as inventory. Image/generated-output, dataset/model, and external-repository views are descriptor projections only; missing seams must return safe Asset Registry diagnostics rather than discovering outputs through task status/list calls, starting/probing runtimes, finalizing images, preparing datasets, training/validating/publishing models, or executing workflows.

Runtime diagnostic normalization rule:

- `RuntimeExecutionDiagnostic` is a runtime specialization of shared structured logging vocabulary.
- Runtime diagnostics use the shared level/verbosity/outcome/error semantics from `modules/contracts/logging`.
- Runtime diagnostic event names use the `runtime.*` namespace and can be mechanically mapped to `StructuredLogEvent` without ad hoc field translation.
- Controlled task failures may carry a bounded stable snake-case reason code and an allowlisted public stage. Adapters and UI clients must preserve those fields for actionable guidance while discarding raw worker exception messages, source content, prompts, generated output, paths, identifiers not explicitly approved for diagnostics, and stack details.

Runtime family normalization rules:

- Runtime operation names must use shared operation identity formatting (`lowercase.dot.segments`) via runtime/shared helpers, not ad hoc string conventions.
- Runtime diagnostics must be additive to logging contracts (for example `executionId` and `stage`) and must not redefine level/verbosity/error semantics.
- Runtime contract exports must stay family-local (`modules/contracts/runtime/index.ts`) and avoid re-exporting non-runtime families.
- Runtime contract tests must protect operation identity normalization and diagnostic-to-structured-log mapping behavior.
- Application runtime orchestration should depend on runtime and logging ports as separate seams; do not collapse runtime execution and logging concerns into one port surface.

This prevents feature teams from creating one-off runtime integration styles per feature.

## What is not finalized yet

The following runtime details are intentionally **not yet standardized**:

- exact wire protocol format across all runtime adapters,
- final process model (for example, long-lived worker vs. per-invocation process in each scenario),
- universal runtime capability discovery/version negotiation mechanism,
- final developer ergonomics for local/runtime adapter tooling.

Contributors should avoid hard-coding assumptions as if these are settled. Use contracts and isolate adapter logic so evolution remains low-cost.

## Practical guidance for contributors

When adding runtime-related functionality:

1. Define/extend a runtime contract first.
2. Implement runtime specifics in `modules/adapters/runtime/`.
3. Keep application use cases runtime-agnostic (depend on ports/contracts).
4. Keep domain unaware of runtime mechanics.
5. Record significant runtime decisions in ADRs when they affect long-term architecture.

## Host-owned runtime instances

Runtime contracts and adapters are shared; runtime instances are owned by the executing host. Runtime task records describe lifecycle semantics, not physical runtime location.

Desktop and server may both use ComfyUI adapters, but each host owns its own process/install/cache state by default. Runtime roots store sidecar installs, managed Python environments, dependency state, caches, and temp outputs. Artifact storage stores durable user/system artifacts.

ComfyUI reference-image preparation resolves workspace-owned catalog artifacts
through the bounded artifact-view retrieval seam. Only signature-verified PNG,
JPEG, or WebP content within the configured byte ceiling may be staged into the
contained ComfyUI input root. Randomized staging names are deleted after
terminal task status and after preparation, submission, or runtime-read
failures; callers cannot supply host paths or staging filenames.

Configured shared model storage is host-owned runtime-adjacent input, not a runtime install root and not workspace persistence. The model registry/checkpoint resolver may scan the configured host-local folder for Hugging Face cache directories and checkpoint files, then resolve selected shared models for the executing host's ComfyUI/Python runtime. Desktop uses the desktop machine's configured folder; server/thin-client mode uses a folder readable by the server process. Thin clients must not assume the browser's local filesystem path is usable by the server.

`SERVER_RUNTIME_ROOT` and `SERVER_STORAGE_ROOT` should be separate. Remote execution placement should be implemented in host composition through adapter/client substitution, not by changing application/domain logic.

The managed Python sidecar is a host-private process boundary, not a general
network service. Desktop and server composition canonicalize its bind and client
endpoint to `http://127.0.0.1:<host-selected-port>` and reject wildcard, LAN,
public, credentialed, HTTPS, path-bearing, query-bearing, fragment-bearing, or
privileged-port configuration. `PYTHON_RUNTIME_BASE_URL`,
`PYTHON_RUNTIME_HOST`, and `PYTHON_RUNTIME_PORT` may select only a consistent
loopback endpoint; they cannot convert the managed sidecar into a remote runtime.

Each supervisor spawn receives a new cryptographically random launch token in
the child-only `PYTHON_RUNTIME_AUTH_TOKEN` environment. The HTTP client reads the
current token for every request and sends it as a bearer credential. The worker
authenticates every endpoint, including health and capability probes, using a
constant-time comparison and fails startup when its token is absent. The token
must never enter logs, readiness snapshots, public diagnostics, renderer state,
or process-wide environment mutation. A newly composed foundation therefore
cannot attach to an ambient or spoofed loopback service that does not possess
its launch identity.

ADR-0013 is the canonical cross-host runtime ownership ADR.

## Runtime security guidance

Runtime adapters must harden process invocation against command injection, control/redact runtime environment variables, and avoid exposing runtime temp paths to clients. Python/ComfyUI runtime logs must redact secrets. Model/plugin/download flows are supply-chain inputs and need explicit risk controls. Runtime security is part of the system security architecture, but runtime code remains in runtime adapters rather than being moved into a monolithic security module. See ADR-0015.

## Server runtime readiness API

- The server API exposes host-scoped runtime readiness through the application `RuntimeReadinessService` at `GET /api/runtime/readiness` and `GET /api/runtime/capabilities/:capabilityId`.
- These reads wrap the shared `RuntimeReadinessSnapshot`, `RuntimeCapabilityStatus`, and `RuntimeCapabilityId` contracts; API-specific files must not duplicate the readiness shape.
- Readiness reads are no-start/no-install/no-repair operations: they may read bounded supervisor/installer status, but they must not start Python or ComfyUI, call feature-specific generation/model endpoints, install, repair, or probe runtime sidecars as a general readiness check.
- Feature-specific endpoints remain execution APIs, not general runtime readiness probes. Desktop IPC readiness exposure remains a separate transport surface from the server API, and thin-client UI consumption is deferred to later UI prompts.

User/workspace-owned image asset records, generated-output descriptors/finalization, dataset preparation outputs, model inventory records, and runtime task outputs created from workspace actions require an explicit workspace id. Missing workspace context must fail safely and must not fall back to global records. Workspace-owned records from one workspace must not be listed or read as another workspace. Generated-output finalization validates source workspace ownership before writing finalized image assets or Asset Kernel instances, and finalized provenance/metadata carries workspace context. Legacy global image/model/dataset/generated-output records are not silently assigned to a hidden/default workspace and are not auto-migrated; any import/migration flow must be explicit. Global runtime readiness, installed-runtime/model diagnostics, and provider configuration diagnostics may remain global, but they must not be presented as workspace-owned resource records. User Library and cross-workspace reuse remain governed by their own canonical docs.

## Workspace Runtime/Resource Boundary

Runtime readiness and host/system diagnostics may remain global. Workspace-owned runtime task outputs created by workspace actions require explicit workspace context where implemented and must not be listed or read as records for another workspace. Global readiness, installed-runtime/model diagnostics, and provider configuration diagnostics must not be presented as workspace model records or workspace task outputs.

User Library and cross-workspace reuse must not change runtime readiness into a workspace-owned record and should preserve explicit provenance/link policy when copied or linked assets depend on runtime-produced outputs.

## Execution Plan Preparation Boundary

Execution plan preparation introduces a non-executing planning layer that depends on runtime readiness outputs and produces safe execution plan candidates/previews. Runtime/provider invocation remains owned by explicit execution boundaries.

## Controlled Conversational Execution

Controlled conversational execution is gated by explicit approval and supported text-generation adapters; execution plan preparation remains non-executing.
