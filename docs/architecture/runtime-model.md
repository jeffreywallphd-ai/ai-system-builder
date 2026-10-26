# Runtime Model

The Python worker's direct script entrypoint binds relative imports to its own
deployment directory through a fixed private package. The flat packaged worker
does not depend on repository ancestor paths or modify `sys.path`. A conflicting
private package or cached submodule fails startup. Every reused private module
must match its exact deployed file or namespace directory. Package-mode imports and the existing authenticated
loopback launch configuration remain unchanged.

Generation's optional accelerator total originates in the authenticated worker's
existing capability response, not the JS host's device namespace. The worker uses
a lazy fixed read-only system-driver query with bounded public waiting/output,
worker-local cache and one active probe retained through actual exit/output
retirement. Unsupported or ambiguous visibility and MIG configurations stay
unknown. Hosts copy only the current sanitized positive-safe-integer fact.
This advisory total establishes neither free VRAM, Torch compatibility, process
ownership nor task admission. Existing model, memory and offload guards remain
authoritative; telemetry never imports a model or changes runtime topology.

Standard CPU admission retains a narrowly calibrated estimate for two
user-approved pinned safe-weight trials:3GiB available physical RAM for
Qwen2.5-0.5B Float32 (at most2GiB estimated loaded weights), and3.5GiB for
Qwen2.5-1.5B BF16 (at most3GiB loaded weights). Explicit CPU/chat/Standard mode,
no adapter, regular safe-weight/config files and their exact approved SHA256 are
required; other inputs retain the conservative estimate. Available RAM is checked
after verification. This estimate changes no precision, loading mode, overflow
policy, native ownership or execution deadline. It is an empirical qualification
candidate, not a physical quota or evidence of successful inference. New model
measurements and sampled4GiB qualification-process limits remain independent.

Desktop compilation follows ADR-0044: the pinned Forge Vite pipeline emits a
self-contained Node/Electron main, independent sandbox-compatible CJS preloads
and separate product/published-runtime renderers. Relative asset URLs and the
packaged worker resource preserve installed behavior; development file serving
is confined to source/dependency roots on loopback.

- Status: current
- Related decisions: `docs/adr/ADR-0002-typescript-first-runtime-model.md`, `docs/adr/ADR-0010-python-runtime.md`, `docs/adr/ADR-0011-runtime-task-registry.md`, `docs/adr/ADR-0012-image-generation-runtime.md`, `docs/adr/ADR-0013-host-owned-runtime-execution-and-feature-placement.md`, `docs/adr/ADR-0014-runtime-installer.md`
- Verification: `docs/architecture/architecture-verification.md`

## Asset Kernel relationship

Assets may declare runtime requirements, but they must not create a parallel runtime readiness model. Asset requirements should reference shared `RuntimeCapabilityId` values and can be structurally validated before execution or composition. Runtime readiness remains the transport-neutral answer to whether a required capability is currently available, and validation must not execute runtimes or probe heavy sidecars.

## Runtime posture

Accepted downloads, Context, dataset preparation, training and image work register a bounded
host-owned lifecycle lease. Reconciliation runs without renderer polling, is
single-flight per owned request, and retains transient failures for retry. Host
callbacks preserve the accepting organization context. Review-required data stays
available for explicit save/discard while active power releases. Preparation
review staging remains owned until its explicit review action; training input
staging can release while its separate generated candidate stays available.
Shutdown closes admission before cancellation, stops the workers, then settles
owned cleanup before persistence closes. A confirmed worker stop is required for
forced terminal cleanup; network errors and historical log text are insufficient.
Each worker stop is attempted independently. Failed stops, delayed admissions
and cleanup failures retain ownership and keep persistence open for retry.
Supervisor starts share one preparation flight and reject launch after a stop
changes the lifecycle generation. Server shutdown starts its task fence before
waiting for active HTTP requests to close.

Owned Python/ComfyUI termination waits at most five seconds for exit/close or
existing terminal process properties. A signal request, generic error, refused
signal or timeout cannot release process/task ownership. Shared stop flights
retain failures for explicit retry; late health, capability, preparation and old
process callbacks cannot change a replacement's status. Failed spawn ownership
can retire on close. ComfyUI startup timeout also preserves an unconfirmed child.
An externally attached Python worker cannot be reported stopped without owned
termination authority; even idle attachment can leave host shutdown pending for
external coordination. This local contract proves only the direct owned child;
descendant/launcher-tree and physical runtime qualification remain pending.
Failed external health/capability reads retain the attachment classification and
cannot authorize spawning a replacement. A later healthy attachment may recover
readiness while termination remains an external obligation.

Image start reserves persisted workspace and organization ownership before
dispatch. Read, cancel and finalize recheck workspace authorization and the
accepted task owner before runtime I/O or cached completion. Caller correlation
IDs cannot select the runtime task identity. Finalization serializes concurrent
calls and preserves each successful persistence/registration step across partial
retries. Its 1024-request session receipt bound refuses new work at capacity;
receipts are never evicted into a replayable state. This is session recovery,
not a durable crash-recovery protocol. Artifact-backed output arrays must be
complete and unchanged; raw and artifact-backed completions share evidence rules.

The shell's session-owned observer coalesces equal task reads and serializes
families within a workspace. Downloads, Context, training, dataset preparation
and images share scoped observation with one-second active reads,
bounded idle/error backoff, immediate explicit invalidation and hidden-window
suspension. Unsubscription and reader replacement reject late results. Neither
observer state nor cached completion grants resource authority. Training,
preparation and image pages retain opaque session recovery IDs; thin-client
image drafts and desktop preparation drafts are bounded per workspace. Image
finalization has an explicit retry action that preserves the generation ID.

ComfyUI queue deletion acknowledges a request even when a prompt is running.
Cancellation is confirmed only for removal of a previously queued prompt, with
no remaining queue or history entry. Running cancellation remains pending; no
global interruption is used. The adapter's default 30-minute execution deadline
requests cancellation and retains inputs if termination cannot be confirmed.
A lost submission reply retains potentially consumed inputs at the bounded
active-task limit until confirmed worker stop. Known safe failed cleanup retries
without a renderer. See the upstream [queue endpoint](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py)
and [queue implementation](https://github.com/Comfy-Org/ComfyUI/blob/master/execution.py).

Context save/discard/cancel serialize with status reconciliation. Duplicate saves
return the saved session receipt. Dataset approvals coalesce only identical
scope-bound review decisions; changed fingerprints or names conflict. Training
retains successful storage, publication and registration steps through supported
session retries, and retries outstanding cleanup before lifecycle completion.
These session receipts do not qualify durable multi-store crash recovery or
unavailable physical runtime environments.

Standalone model publishing remains explicitly unavailable because no publishing
worker is implemented. A readiness hint cannot admit that unsupported task.
The supported explicit training save workflow retains its existing publishing
port and approval semantics.

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

Managed Context execution has one narrower pre-dispatch dependency stage.
`lancedb==0.34.0` and `pyarrow==25.0.0` are installed from the packaged exact
`requirements-context.txt` during normal Python runtime setup. An explicit RAG
generation, saved-artifact inspection, or query start repeats an asynchronous
idempotent probe/install/re-probe before worker acceptance; concurrent requests
for the same managed command and worker directory share one in-flight ensure.
When installation is needed, the host-side task record exposes only fixed
installing/completed or sanitized retryable-failure progress so workspace
notifications remain live while the event loop continues serving reads.
Package-manager output, commands, environment, and paths stay adapter-private.
This exception applies only to an explicit state-changing Context start:
readiness, capability, task status/list, Context list, and ordinary detail
metadata reads never invoke the ensure.

Model downloads use `TaskType.MODEL_DOWNLOAD` and the same start/read/list/cancel
lifecycle in desktop and server hosts. Start requests return promptly; UI and
compatibility clients poll through short requests. The application-owned model
download lifecycle validates workspace ownership, projects allowlisted public
progress, and performs model-registry finalization exactly once after runtime
success. Python cache handles and resolved host paths remain private completion
data: they may be passed to the model registry but must not enter generic task
records, API/IPC/preload responses, notification state, or logs.

## Dataset Preparation and Model Training Task Profiles

The text-training adapter resolves the required base-model reference before
loading datasets. The fixed local-format allowlist maps JSON Lines to the
Datasets `json` builder, retaining local file paths and split roles. It never
uses the `jsonl` format label as a remote dataset identifier. Saved-model
validation rejects malformed or unreadable safetensors and invalid or empty
shard indexes. Native reader failures discard partial tensor facts and return
fixed invalid-result errors. Missing reader dependencies keep the separate
normal-warning and publish-denial behavior. Validation reports identify the
registered model through an opaque reference instead of its local path.

Dataset preparation is the dataset-producing contract boundary. Model training is the model-producing runtime task boundary. Dataset preparation requests may declare a task profile that describes the dataset shape being prepared for a training family. Model training requests may carry the selected training task so the runtime can validate task support and tag generated model records, but model training remains responsible for base model selection, training method, hyperparameters, output registration, and validation.

The shared runtime contracts define first-tier dataset preparation task types for LLM instruction tuning, LLM classification, LLM extraction, LLM embedding tuning, LLM reranking, diffusion LoRA, vision classification, vision detection, and vision segmentation. Each profile declares model family, expected output schema, supported file formats, required/optional fields, compatible training methods, and runtime support status. This profile vocabulary is intentionally contract-level metadata; it does not by itself imply that every runtime adapter can execute every profile.

Current Python runtime execution support for dataset preparation covers the first-tier task profiles. The shared capability registry truthfully advertises CSV, JSON, JSON Lines, Parquet, text, Markdown, HTML, PDF, DOCX, and supported image sources according to task compatibility. LLM profiles can use supported structured sources when expected fields already exist, or normalize supported documents to markdown, chunk them, and emit task-shaped rows from task-specific structured generations. Diffusion LoRA and vision profiles emit image manifest rows from image artifact metadata or structured manifest files; object detection and segmentation require existing box or mask annotations and fail with a task-specific error when annotations are missing.

Dataset preparation materializes an aggregate dataset and configured physical train, validation, and test outputs. A deterministic component partition keeps rows from the same source/group and exact task-content duplicates in one split. Reported counts are validated against physical output roles before application materialization. See data-management.md for the end-to-end boundary and ../security/data-management-threat-model.md for required controls.

Dataset preparation tasks with textual training inputs declare whether text fields come from provided source data or are generated by a local text-generation model. The recipe carries this as `task.textInputMode` plus `generation.promptTemplate` for the editable task objective used to create examples, labels, captions, or extracted text. Runtime-owned mandatory system rules remain higher priority than that editable objective, treat source/task context as untrusted data, prohibit unsupported facts and instruction disclosure, and require a task-bound JSON Schema envelope with an explicit `ok` or `skip` status. Chat-capable Transformers models receive separate system and user messages through their model chat template; non-chat models receive an equivalent role-labeled prompt. The worker validates exact envelope and example fields, bounds text and extraction depth/size, requires exact allowlisted labels and source spans where applicable, and only then maps generated values to the profile row contract used by JSON, CSV, and Parquet writers. Built-in prompt/model defaults live in the runtime contracts: the quality preset uses `Qwen/Qwen2.5-7B-Instruct`, and the compact preset uses `Qwen/Qwen2.5-3B-Instruct`. Runtime contracts also own task-scoped generation parameter defaults, with Qwen model-card sampling defaults (`temperature` 0.7, `topP` 0.8) used for instruction-style generation and lower temperatures used for labeling, extraction, and annotation tasks where consistency matters. UI surfaces may offer a same-flow model download action for these generation models, but downloads must still route through model-management use cases so model records and lifecycle state stay consistent. Image-manifest text generation uses file names, metadata, annotations, trigger tokens, and allowed labels as context; it does not perform pixel-level visual understanding unless a future multimodal runtime explicitly adds that capability, and it never synthesizes detection boxes or segmentation masks.

Token-constrained JSON is an optional Python-adapter capability for local causal
and chat generation. The shared output-shape compiler remains the authority: its
canonical exact schema governs prompting, parsing, validation and later role
mapping. The model-bound next-token processor may use a proven equivalent
encoding of disjoint conditional object branches: a required string discriminator
must have distinct constants, and replaced properties must be exact known
subsets. Every other root rule is retained in each complete branch. Original and
expanded forms share the existing combined byte/node/property/choice bounds and
cache accounting; unsupported or over-budget lowering keeps the original form.
The original schema and fingerprint remain the final validation authority.
The pinned constrained backend retains its default whitespace policy. A compact
formatting experiment preserved parsed values but regressed held-out model
quality and was withdrawn. Lexical equivalence does not establish unchanged
sampled outcomes. Original validation and cache/resource bounds remain authoritative.
Prompt schema/examples preserve the existing sorted canonical presentation and
exact values. Experimental prompt ordering was withdrawn after a fixed-model
quality regression; it is not an interface contract or a qualification shortcut.
Token constraint representation and sorted integrity identity remain separate.
Built-in classification shapes constrain a finite configured label set when it
fits the existing choice limits; larger recipes retain their prior bounded
parsing/semantic policy. Existing saved schemas are never rewritten.
The adapter accepts only
a bounded non-recursive schema subset, keeps a bounded model-local LRU of
compiled processors, resets a reused processor before each generation, and
requires EOS after an accepting state. Checked mode fails closed on dependency,
schema, tokenizer, compilation, generation, truncation, parsing, or validation
failure and never retries without constraints. Unchecked mode remains explicit
and must retain strict parsing plus every semantic, grounding, safety,
quarantine, and approval check.

The worker advertises `dataset-preparation.constrained-json` only when exact
reviewed Outlines, Outlines Core, jsonschema and LLGuidance pins are available on Python
3.10 through 3.13. Baseline worker support outside that conditional range does
not imply decoder support. Capability reads are bounded import/version checks;
they do not install dependencies, load a model, or compile a schema.

The private lazy token-mask compiler shares one projected tokenizer per loaded
model. It preserves Core's singleton-token conversion, excludes EOS aliases and
vocabulary holes, and masks padded model-score positions. It accepts at most
1,048,576 vocabulary entries/IDs, 64 MiB of projected bytes, 64 KiB per token,
256 KiB of regex and 512 KiB of generated grammar. Vocabulary bounds precede
native tokenizer construction; regex bounds precede grammar conversion, and
generated-grammar bounds precede matcher construction. The existing four-processor/256 KiB schema cache remains. Each
processor permits at most eight batch rows; the current dataset host uses one.
Explicit native limits allow 2,000 items per row, 1,000,000 initial lexer fuel,
200,000 step fuel, 50,000 step items, 65,536 lexer states and 500,000 grammar
symbols. Large lexemes are not precomputed. These are complexity limits, not a
hard process RAM guarantee or a replacement for model-memory admission.

Native log level is zero and verbose errors are disabled. Constructor, consume
and mask errors fail before sampling with fixed public codes. EOS additionally
requires a healthy accepting state. The processor imports no compiled mask
kernel and uses owned byte masks with ordinary eager Torch operations. This
changes no inference engine, prompt, schema language, whitespace rule, final
validator, worker topology, offload authority or model-loading policy.
Tokenizer-only comparisons and footprint checks do not qualify model accuracy,
GPU memory, retained staging or parent roadmap completion.


The model schema contains only fields the model may generate. If source
attribution is selected, the UI displays its locked companion fields, and the
worker appends them after generation from trusted selected-source metadata.
Training consumes the prepared artifact's exact schema fingerprint and
training-purpose paths when available. Legacy artifacts without retained
descriptor metadata may use only established task-schema aliases such as
`instruction`/`question`/`answer`; malformed or mixed layout metadata still
fails before model loading. The desktop task boundary keeps text-training
dependencies out of ordinary worker startup, then probes exact reviewed
Datasets and PEFT pins and performs a bounded install/re-probe before admitting
a text-training task.
The desktop Train Model workflow enumerates candidate dataset artifacts only
through the active workspace-scoped artifact browser. Prepared Parquet outputs
remain selectable when their opaque storage key has no extension because the
canonical Parquet media type and bounded original file name are both recognized;
the workflow presents those bounded readable names in an explicit checkbox list.
The eventual training use case remains authoritative for artifact ownership,
local backing, schema, and fingerprint validation.

Dataset preparation UI should present task choices before lower-level settings, keep nonessential settings collapsed by default, and group prompt/model/parameter controls under automated data-formatting language rather than a hardcoded QA-generation or model-override concept. Saved training settings are a renderer convenience for reloading preparation choices such as task, formatting, model, split, and output options; they may retain selected artifact identities only in a bounded, per-workspace in-memory session draft. Restored identities must be revalidated against the current authorized catalog before use; drafts must not persist artifact payloads, grant authority, cross workspace boundaries, or replace runtime contracts. Source artifact lists should be filtered by the selected task family so LLM tasks show text/document/structured sources and diffusion/vision tasks show image sources plus structured manifests.

Current Python model training support includes causal language model training over text-like dataset files using LoRA, QLoRA, or full fine-tuning through Transformers. The text training path accepts the LLM instruction, classification, extraction, embedding-pair, and reranker training tasks, formats those row schemas into causal-LM training text, and records task tags/metadata on generated model candidates. The multimodal training path accepts diffusion LoRA, vision classification, vision detection, and vision segmentation manifests. Diffusion training supports LoRA adapter output for Diffusers-compatible text-to-image models. Vision training supports LoRA adapter output and full fine-tuning for image classification, object detection, and semantic segmentation models through Transformers image processors and task-specific model classes. Vision LoRA uses PEFT adapter serialization and preserves recognized task heads as trainable modules when the selected model exposes them. For image manifests generated from workspace artifacts, the application model-training use case stages referenced source artifact bytes into runtime-local files and passes runtime-only source path metadata to the Python worker.

Model training reports structured progress after every completed microbatch and
remains cancellable through the shared task lifecycle. Every desktop status,
cancel, save, and discard request is bound to the workspace recorded at start.
After a training run reaches any terminal state, the desktop may offer one
runtime unload action for that run. Its visibility must not depend on the
generation-model cache inventory because training models are task-local and do
not appear in that inventory; the existing unload boundary still rejects active
tasks, clears cached generators, and requests Python/CUDA memory reclamation.
Runtime success produces a staged, path-sanitized review result rather than an
automatically registered model. Explicit save finalizes the configured local or
Hugging Face destination using the request's output model name; discard removes
the staged runtime output. Runtime paths, checkpoints, logs, and validation
report paths stay out of IPC, preload, renderer, and notification state.
Saved PEFT adapter configuration replaces any runtime-local base snapshot
reference with the authority-owned base model id before validation and staging;
the generated model record also retains that base id and its model-record id.

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

Configured shared model storage is host-owned runtime-adjacent input, not a runtime install root and not workspace persistence. The model registry/checkpoint resolver may scan the configured host-local folder for Hugging Face cache directories and checkpoint files, then resolve selected shared models for the executing host's ComfyUI/Python runtime. Desktop uses the desktop machine's configured folder; server/thin-client mode uses a folder readable by the server process. Thin clients must not assume the browser's local filesystem path is usable by the server. An explicitly confirmed desktop model deletion may remove the stored model's local files only through an adapter that canonicalizes the target beneath the generated-model cache or configured shared model root, rejects links and root/outside/traversal targets, and fails before removing the registry record when file deletion is unsafe or unsuccessful. Hugging Face snapshot deletion removes the owning models cache repository directory so unreferenced snapshot blobs are not left behind; a standalone checkpoint record deletes only its recorded checkpoint file.

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

Dataset cancellation transport success is not terminal lifecycle evidence.
Desktop preserves the exact cancel identity, flag and status; both UIs retain
the active task and continue observing after requested, refused, unknown or
failed cancellation. Only a terminal task read determines the final UI outcome;
late cancellation replies cannot overwrite it or another workspace/session.
Pending quality reviews remain owned until discard is explicitly confirmed.
Running dataset preparation currently cannot be force-cancelled through the
worker contract; the UI must not stop its shared Python worker as a workaround.

ComfyUI and Git repair require explicit host `allowUpdate: true` before status,
filesystem, Git or dependency commands. Missing permission and `false` fail with
`update-not-authorized`; `forceRepair` expresses intent and cannot grant update
authority. Every targeted, missing-install and full repair fallback preserves
the normalized host request. Desktop repair approval also requires its configured
pinned ref. Automatic supervisor repair carries no update approval and therefore
fails closed with operator recovery required. Initial `ensureInstalled` remains a
distinct installation operation; this repair control does not qualify unmanaged
checkout provenance, dependency reproducibility or physical runtime behavior.

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
The approved model is validated in the host-owned local cache and loaded on the
first turn after Python startup when it is not already resident. This cold-load
path is local-only, preserves exact model-record authority, and shares the
bounded two-minute short-task deadline between the Python task and its caller.
A selected LoRA record is not treated as a standalone generation model. Runtime
resolution requires its exact same-workspace full base-model record, submits the
base and adapter identities together, validates the adapter's declared base
association and contained local snapshot, and attaches it with the exact
reviewed PEFT runtime dependency. Warm reuse also matches the adapter revision.

An asynchronous Python spawn error followed by exit/close retires the owned child
without converting its failed startup outcome into a successful stopped state.
The diagnostic failure remains observable until explicit stop or a valid retry;
explicit stop still requires and records confirmed termination separately.

Desktop task controllers for image generation, dataset preparation and Context are
lazy retained for the host lifetime. Their private reviews, in-flight starts,
partial finalization and completed receipts remain available after runtime
completion and navigation. Workspace-required public task listings cannot prove
host-wide disposal eligibility. Heavy runtime owners retain explicit stop/unload
controls. Other disposable features serialize disposal with provider reuse and
retain the same owner on guard or cleanup uncertainty.

Nonempty unmanaged Git install roots are never adopted from editable origin
configuration. Managed reuse requires matching target, normalized install root
and requested canonical repository URL. ComfyUI repair checks installed/missing
status and exact target/root before fallback or targeted Python/pip effects;
unknown or failed authority denies. Explicit update approval remains necessary.
Missing/empty roots can use the separate initial installation operation.
These marker consistency checks are not proof of current tree bytes, immutable
source provenance or native filesystem identity; those qualifications remain
pending. Recovery must not relabel or overwrite an unmanaged tree in place.

Only ENOENT establishes a missing filesystem entry. Permission, I/O, invalid
directory and indeterminate read failures return unavailable/failed authority
and cannot enter initial clone, directory creation or metadata-write effects.
Repair preflight also requires the canonical repository identity returned by
the installer; absent or substituted source identity denies before execution.

Image-generation request bounds are pure shared contracts used by the application
and ComfyUI runtime/mapper. Effective selected host defaults are checked before
supervisor startup, reference preparation or prompt submission. Existing limits
remain:10000-character positive/negative text,64..4096 dimensions,16777216 pixels,
1..200 steps,1..8 images, finite CFG(0,50] and denoise[0,1], at most3 face references.
Invalid batches are rejected rather than floored. Primitive/descriptor checks reject
coercion and accessors; engine hints are bounded JSON data, and seeds are safe
integers. Workspace authority, queue/history limits, deadlines and truthful
cancellation remain intact. These caps do not prove combined workload GPU capacity,
per-actor fairness or physical model qualification; those remain pending.
Admission consumes one detached descriptor-safe request snapshot before authority,
model, runtime-start or reference-preparation awaits. Nested reference collections,
reference identities and hint data cannot change through caller-owned aliases after
validation. Prompts retain their exact allowed content; display sanitization is not
used to construct runtime input.

Python dependency setup diagnostics use the explicit `python-dependency-outcomes-v1`
projection: finite operation/platform/backend/stage outcomes, safe exit codes,
grouped retry/failure counts and explicit overall success. They retain no command,
argument, path, index URL, environment inspection, output or exception transcript.
Repeated stages are grouped by their finite stage/backend identities. Raw results
remain local to operational parsing/retry/failure paths. At most the latest worker
and model-training summaries are retained in immutable session memory. Trusted
observers receive the same minimized immutable summaries; observer failures cannot
change setup outcomes. No automatic filesystem persistence occurs, and legacy
`diagnosticsFile` paths are ignored. Optional persistent sinks remain unavailable
until private storage authority, bounds, retention and physical qualification are
established. Security audit records remain separately governed.

Model download task reads and explicit completion require returned registry records
to match the exact requested task id, task type and workspace before projection or
registration. Listing independently filters task type instead of relying on the
adapter filter alone. Cancellation confirms only an acknowledgement for the exact
requested id; substituted acknowledgements fail without reporting cancellation
success. These checks supplement frozen organization/principal/workspace and
current write authority, and do not qualify native provenance or durable recovery.
# Confirmed worker exit and task recovery

The Python foundation fails only its accepted unfinished tasks after the owned
supervisor confirms process exit. It fences admission and in-flight read races,
retains observed terminal results in a bounded private cache, and preserves
explicit cancellation recovery. A network failure remains transport uncertainty.
UI notifications retain bounded identities of live work across workspace changes
so returning reconciles its terminal outcome without replaying unrelated history.

## Optional bounded generation profile

ADR-0045 adds the explicit Dataset Preparation `offload-v1` profile. Standard
remains default. Exact worker capability checks precede staging/start, and loaded
model status preserves the profile identity through HTTP/IPC. The shared runtime
does not silently reuse the profile for conversation, training or Context.

The native Qwen2 path independently checks safe-weight/tokenizer source bindings,
meta-model tensor shapes/ties and finite CPU/CUDA placement. Admission separates
weight residency, source/conversion transients, largest-layer execution, bounded
prefill/KV/runtime headroom and owned disk staging. One exclusive cached-generator
slot owns original-input references and private staging; task completion alone
does not remove referenced files. Per-request views retain distinct generation
parameters. Atomic unload/task-admission fencing and serialized model execution
prevent teardown racing another user of the same cached model. Unconfirmed cleanup
retains ownership, with exact removal-progress retry and no ambient slot adoption.
The owning limits, support matrix and qualification boundaries are in
`docs/operations/optional-low-memory-inference.md`. These cooperative controls do
not qualify pending native filesystem/ACL races or impose a kernel memory quota.

## Automatic recovery and admission ordering

Reserve non-cancellable Dataset admission before its HTTP POST. An uncertain
acknowledgement retains that bounded owner until an exact terminal observation,
consistent cancellation or actual owned exit; unknown responses and elapsed time
are not release evidence. Task and direct-download automatic recovery share one
synchronous admission fence. No Dataset owner may exist when recovery commits,
and new starts cannot enter its stop/start interval. Unconfirmed recovery failure
continues to deny admission while allowing status reads. Actual owned lifecycle
recovery, rather than a healthy read, clears the fence. Existing native ownership
and offload staging requirements remain separate.

### Browser model controls and asynchronous replies

Models uses a committed workspace/API-client session for browse, inventory,
reference, download, details, file and registry-delete actions. A replaced or closed
session cannot dispatch follow-up inventory work or apply old completion state.
The optional default client is stable for that mounted session. Inventory reads
retain the 12-second bound and clear owned timers after settlement or retirement.

Reference save, download start and record delete share synchronous pending-action
admission. A download reply must identify the requested workspace/model/task;
legacy completed downloads and saved references must match the requested model.
Host-owned accepted downloads stay observable through the notification subsystem.
Page retirement never asserts cancellation or worker exit. Registry deletion
requires exact confirmed record acknowledgement and requests deleteLocalFiles=false.

File dialogs use selected record identity and a local request sequence. Close,
selection or workspace/client replacement invalidates earlier file results. Model
files load only after explicit selection of Show model files. Unexpected exceptions
are not public diagnostic payloads. Focused renderer/client tests do not qualify
physical downloads, real model execution, native ownership or the final UI matrix.

### Desktop training presentation ownership

The training hook creates a committed workspace/model-client session. Layout
retirement invalidates old action replies, input follow-ups, model-status reads
and settings callbacks. The replacement clears selected input identities and
reconciles an opaque saved run through the current client. Leaving the page never
asserts task cancellation or physical worker termination. A recovered run keeps
Start disabled and Stop available until current status proves its outcome.

A synchronous session action owner covers start/stop/review/unload before busy
render. Only the accepted run may update observation or cancellation. A separate
review-run identity admits explicit save/discard once, retaining review after
unconfirmed, foreign or nonterminal results. Save requires a matching succeeded
result without pending review and a registered output model; discard requires a
matching cancelled result without pending review. Inventory refresh failure after
a confirmed save cannot turn that save into failure.

Seed and LoRA dropout use explicit numeric values rather than truthiness, so zero
is preserved. Other runtime/resource/provider policies are unchanged. Public
action failures use fixed Notifications copy; active progress remains in the form.
Nine rendered task variants assert model identity, Parquet train plus JSONL
validation input, method and explicit review without executing a model. The
provider-default settings panel is outside those new form oracles. Actual
training, host/native and final combined qualification remain separate.

Recovery storage writes also require the current committed session. A delayed
Start reply cannot replace a newer saved run. Once observation proves terminal
review, a pending Stop reply or rejection cannot restore active-run state.
An uncertain Stop retains observation and controls and publishes a fixed error
through Notifications without converting the active task to failed.
