# Runtime Contracts

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Shared runtime execution contracts live in this module.

The contract family is intentionally thin and adapter-oriented:

- runtime target identity (`runtime-kind`, `runtime-target`)
- execution request contract (`runtime-execution-request`)
- execution result + failure contracts (`runtime-execution-result`, `runtime-execution-error`)
- optional progress/output event stream shape (`runtime-execution-event`)
- runtime diagnostics aligned to logging vocabulary (`runtime-execution-diagnostic`)

These contracts support the TypeScript-first model while leaving runtime protocol details evolvable for adapter implementations.

`TaskType.MODEL_DOWNLOAD` participates in the shared start/read/list/cancel
lifecycle. Its public progress uses message/current/total/percent/unit only;
worker-specific progress details and completion cache handles stay behind the
runtime adapter boundary.

`TaskType.CONTEXT_GENERATION` uses the same lifecycle for bounded RAG database
or Markdown context-pack candidates. Its request records exact source digests,
lineage-aware chunk settings, optional bounded manual context, and local-only
model settings. Its result exposes review evidence and a contained output
descriptor, never source content, prompts, embeddings, model output, or runtime
paths.

Dataset preparation contracts include a shared task-profile vocabulary for first-tier training dataset shapes:
LLM instruction tuning, classification, extraction, embedding tuning, reranking, diffusion LoRA, vision classification,
vision detection, and vision segmentation. The Python dataset-preparation worker supports these profiles as dataset
artifact outputs: LLM profiles can emit generated or structured text rows, diffusion/vision profiles emit image
manifest rows from source metadata or structured manifest files. Model-training execution remains a separate runtime
task boundary and must not be inferred from dataset-preparation profile support.

`dataset-preparation-capabilities.ts` is the shared authority for source format
and task compatibility. Consumers must use it for advertised choices and early
denial rather than maintaining host-specific extension lists. The result
contract carries role-tagged aggregate, train, validation, and test outputs;
their physical row counts must match the summary.

`dataset-quality.ts` defines requested and effective quality policy, mandatory
checks, field/mapping/distribution profiles, sanitized review samples, stable
report fingerprints, quarantine lineage, and review state. Hosts own policy
resolution; runtime adapters receive the effective policy and must not weaken its
mandatory controls. Reports never carry raw rejected row values.

`dataset-preparation-adaptive.ts` defines the exact-task input intents,
preparation methods, defaults, active-control sets, execution plan, and safe
legacy normalization. Consumers must resolve it from the selected task and
source capabilities, serialize only active settings, and reject mixed roles or
unsupported methods instead of guessing. One structured dataset uses
validate-and-split, multiple compatible datasets use combine-and-split,
documents default to topic-aware conversion, metadata methods serve caption or
label tasks, and detection/segmentation require existing annotations.

`dataset-preparation-constrained-json.ts` owns the optional constrained-output
preference and the stable capacity recommendation used to initialize it. An
explicit user choice always wins. An omitted preference may be recommended only
when decoder and task-schema support are ready and the selected model fits the
reported CPU or accelerator capacity with a safety reserve. Missing, stale, or
malformed facts resolve unchecked. The contract intentionally excludes hardware
identity, local paths, and volatile utilization so an untouched control cannot
oscillate while work is running.
The same non-identifying capacity resolver governs built-in model defaults:
when the quality preset cannot fit with its reserve, an untouched selection
steps down once to the compact preset. Explicit and saved model choices always
win and remain subject to the runtime's live-memory preflight. The model contract
also owns a closed `none | limited | extended` system-memory overflow policy.
Those values map to 0, 1 GiB, and 4 GiB respectively; renderers cannot submit an
arbitrary byte allowance, and CUDA-only placement cannot use the allowance.

`dataset-preparation-output-shape.ts` is the shared authority for the editable
output layout used by the Generation prompt. It supplies task-compatible defaults,
plain-language training-purpose metadata, bounded visual field definitions and
sample values, deterministic purpose paths, one exact JSON Schema envelope, and
one schema-valid example envelope for prompting, validation, constrained
decoding, and row conversion. Labels are compiled from Step 1 settings rather
than duplicated as visual-field choices. New instruction-tuning defaults keep
Instruction, Input, Context, and Output separate: Instruction is a fixed
configured value, Input is the generated user request, and Context is unchanged
runtime-supplied source data. Optional Thought remains an independent
text-only chain-of-thought field. Envelope fields and required training purposes are
protected from rename/removal. Nested layouts require JSON or Parquet, and the
legacy free-form extraction record remains usable but is explicitly ineligible
for token-level constraints until its fields are defined.

The model-owned schema intentionally excludes `sourceAttribution`. When the
quality policy selects attribution, the shared editor displays a separate
locked companion schema containing the authoritative source artifact id and
optional bounded name, public URI, author, and license fields. The worker adds
that object from trusted source metadata after generation and validation; it is
absent when not selected and cannot be renamed or supplied by model output.

`dataset-preparation-advanced.ts` defines the bounded configuration and evidence
used by the selected adaptive method. Fixed-length, topic-aware, and
structure-aware content strategies have distinct compatible controls.
Generation is an independent mode, not a chunking preset. Consumers must reject
unavailable capabilities and must not admit synthetic rows when review is
absent or disabled.

Text-bearing dataset-preparation recipes use `task.textInputMode` to choose provided source text versus generated text,
and `generation.promptTemplate` carries the editable system prompt instructions for generated examples, labels, captions, or
extracted fields. Mandatory runtime-owned system rules keep source content and task settings in an untrusted-data role,
and chat-capable models receive those rules through the tokenizer's system-message role. Each generation receives an
exact task-bound JSON Schema envelope plus a configured sample. Fixed values are
enforced by schema, runtime-supplied fields are attached outside model generation,
and the model must return exactly one JSON object without prose,
Markdown, code fences, or other pre/post output. Unchecked compatibility parsing
may remove one exact `json` fence containing one bounded object, but rejects
surrounding prose, multiple blocks, malformed/non-object JSON, mismatched, oversized, extra-field,
non-allowlisted, or non-source-span output before deterministically assembling the task profile's row fields for JSON,
CSV, or Parquet.
Detection and segmentation objectives may label existing reviewed annotations but never synthesize boxes or masks.
Built-in model presets stay within the 7B limit: quality uses `Qwen/Qwen2.5-7B-Instruct`, while compact uses
`Qwen/Qwen2.5-3B-Instruct`. Quality is the default only when reported capacity
can support it; tightly constrained hosts default to compact. Task-scoped generation parameter defaults also live here so UI and runtime request builders
do not drift into separate QA-generation, model-override, or duplicated-parameter systems.

Model-training task requests may carry `trainingTask` so runtime adapters can validate task support and annotate
generated model outputs. The current Python trainer supports the LLM text task profiles through causal-LM training,
diffusion LoRA through Diffusers adapter training, and vision classification/detection/segmentation through
task-specific Transformers vision LoRA or full fine-tuning. Image-manifest model training receives runtime-local
source file paths through dataset metadata; runtime workers must not reach back into artifact storage directly.
