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

Dataset preparation contracts include a shared task-profile vocabulary for first-tier training dataset shapes:
LLM instruction tuning, classification, extraction, embedding tuning, reranking, diffusion LoRA, vision classification,
vision detection, and vision segmentation. The Python dataset-preparation worker supports these profiles as dataset
artifact outputs: LLM profiles can emit generated or structured text rows, diffusion/vision profiles emit image
manifest rows from source metadata or structured manifest files. Model-training execution remains a separate runtime
task boundary and must not be inferred from dataset-preparation profile support.

Text-bearing dataset-preparation recipes use `task.textInputMode` to choose provided source text versus generated text,
and `generation.promptTemplate` carries the editable system prompt for generated labels, captions, questions, answers,
or extracted fields. Built-in model presets stay within the 7B limit: quality uses `Qwen/Qwen2.5-7B-Instruct`, while
compact uses `Qwen/Qwen2.5-3B-Instruct`. Task-scoped generation parameter defaults also live here so UI and runtime
request builders do not drift into separate QA-generation, model-override, or duplicated-parameter systems.

Model-training task requests may carry `trainingTask` so runtime adapters can validate task support and annotate
generated model outputs. The current Python trainer supports the LLM text task profiles through causal-LM training,
diffusion LoRA through Diffusers adapter training, and vision classification/detection/segmentation through
task-specific Transformers vision LoRA or full fine-tuning. Image-manifest model training receives runtime-local
source file paths through dataset metadata; runtime workers must not reach back into artifact storage directly.
