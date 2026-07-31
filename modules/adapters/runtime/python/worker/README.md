# Python Runtime Worker

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This directory contains the managed Python sidecar worker.

The worker must be launched by a host supervisor on `127.0.0.1`, `localhost`, or
`::1` with a non-privileged port and a `PYTHON_RUNTIME_AUTH_TOKEN` of at least 32
characters. Startup rejects remote/wildcard binding and missing authentication.
Every endpoint requires `Authorization: Bearer <current-launch-token>`; this
includes health and capabilities. The token is private launch state and must not
be logged or returned.

The host supplies a bounded deadline for every task. The common policy allows
short work two minutes, validation two hours, dataset preparation eight hours,
model downloads twelve hours, and model training twenty-four hours. Model
Management and Dataset Preparation therefore use the same long-running download
behavior. The worker continues to report structured progress and honor task
cancellation; a longer deadline is not an unlimited execution mode.

Endpoints:

- `GET /health`
- `GET /capabilities`
- `POST /models/ensure-downloaded`
- `GET /models/status`
- `POST /models/unload`
- `POST /tasks/start`
- `GET /tasks/{request_id}`
- `POST /tasks/{request_id}/cancel`

Dependency files:

- `requirements.txt` contains startup-safe worker dependencies required to boot the sidecar and support model download/runtime loading.
- `requirements-training.txt` contains heavier training/dataset dependencies that are not required for worker startup.

Optional token-constrained JSON generation uses exact, conditionally installed
pins in `requirements.txt`: Outlines `1.3.2`, Outlines Core `0.2.14`, and
jsonschema `4.26.0`. These packages are installed and probed only for Python
3.10 through 3.13, the Python range supported by this reviewed Outlines release.
Outlines and Outlines Core are Apache-2.0 and jsonschema is MIT licensed. The
worker continues to boot on supported baseline Python versions outside that
range, but omits `dataset-preparation.constrained-json` from `/capabilities`.
Dependency setup repairs missing or mismatched pins; capability reads never
install or repair packages. `npm run security:dependencies` also verifies this
direct decoder inventory, its Package URLs, reviewed licenses, and exact Python
marker; the deployment's full Python environment and container still require
their normal generated SBOM and image scan.

Implemented task:

- `prepare-training-dataset`
  - validates three-way split consistency (`trainRatio > 0`, non-negative validation/test shares, at least one holdout share, and ratios sum to `1.0`)
  - normalizes bounded supported source docs to markdown (`.txt`, `.md`, `.markdown`, `.html`, `.pdf`, `.docx`, `.csv`, `.json`, `.jsonl`) with file, extracted-text, PDF-page, and DOCX-expansion ceilings
  - explicitly rejects legacy `.doc` files (convert to `.docx` or configure skip policy)
  - chunks markdown using bounded character, token, sentence, section, table,
    semantic, or extracted-layout strategies while preserving exact normalized
    artifact/span/region/page lineage; scanned-image OCR is explicitly unavailable
  - uses bounded structured CSV/JSON/JSONL/Parquet rows directly when they already match the selected LLM, diffusion, or vision task schema
  - generates QA-derived task rows for LLM instruction, classification, extraction, embedding-pair, and reranker profiles through local `transformers` model configuration when source documents need generated examples
  - keeps instruction rows structurally distinct: Instruction is the fixed
    configured behavior, Input is the generated user request, Context is the
    unchanged runtime-supplied source section, Output is the desired response,
    and optional Thought remains a separate text-only chain-of-thought field
  - omits Context from the model generation schema, attaches it from the current
    source section before final validation, and rejects model-authored Context;
    the evidence-provider boundary can later accept retrieved context
  - places the compiler-owned schema and schema-valid format example in every
    generated-example prompt and requires exactly one JSON object with no prose,
    Markdown, code fence, unrequested reasoning, or other pre/post output
  - can pass an exact bounded Draft 2020-12 schema to the local causal/chat
    generator; the model-bound Outlines Core processor masks every next-token
    choice, requires EOS at an accepting state, and then parses and validates
    the same schema before returning canonical JSON
  - bounds decoder schemas, properties, choices, output bytes, and a model-local
    four-entry LRU processor cache; processor compilation and public errors
    exclude prompts, source content, generated output, paths, and stack details
  - treats checked and unchecked generation as explicit modes: checked mode
    never falls back after a decoder failure, while unchecked mode retains the
    existing strict post-generation parser and semantic checks
  - shows selected attribution as a locked companion shape in the UI, then adds
    the authoritative source id and available bounded name, sanitized public
    URL, author, and license after validation; model output cannot supply it and
    unselected runs omit it
  - uses `task.textInputMode` and `generation.promptTemplate` to either keep provided text fields or generate labels/captions/questions/answers with the configured local text model
  - emits diffusion LoRA, vision classification, object detection, and segmentation manifest rows from image metadata or structured manifest files; generated image labels/captions use metadata and annotations as text context rather than pixel-level visual understanding
  - supports generation failure handling policy (`generation.failurePolicy`), defaulting to strict fail-fast unless normalization mode is best-effort
  - emits aggregate plus physical train/validation/test artifacts in JSONL/JSON/CSV/Parquet, keeps source groups and exact duplicates together, and derives summary counts from emitted partitions
  - resolves task-schema mappings and applies deterministic field/source/class/language profiling, exact and bounded SimHash duplicate detection, text/language bounds, personal-data and credential screening, explicit unsafe/benchmark gates, and optional license/consent/source-row rules
  - sends rejected provided or generated rows to reversible quarantine with source-row lineage and emits a stable-fingerprint quality report containing only aggregate profiles, reason counts, and bounded sanitized examples
  - optionally performs deterministic bounded semantic duplicate checks,
    per-source caps, source interleaving, coverage measurement, and task-aware
    contrast recommendations before split assignment without persisting row text
    or embedding vectors in the advanced report
  - independently verifies generated candidates for task schema, exact source
    citation, lexical grounding, critic score, safety, duplicate, and diversity
    before admission; rejected candidates remain reviewable in quarantine and all
    admitted candidates still pass the mandatory quality review
  - emits only bounded aggregate diagnostic fields; controlled preparation failures preserve a stable snake-case reason code and one of the four public stage names so the host can show actionable guidance, while source text, prompts, model output, provider payloads, runtime-local paths, and raw exception messages remain excluded
- `train-model`
  - supports causal language model training over text-like datasets
  - accepts the LLM instruction, classification, extraction, embedding-pair, and reranker training tasks
  - formats those row schemas into causal-LM training text when present
  - formats separate Input and Context blocks and includes an optional text-only
    Thought block only when those purposes exist in the prepared schema
  - resolves custom fields only through prepared artifact purpose paths with a
    matching exact schema fingerprint; missing, malformed, or mixed layout
    metadata fails before model loading
  - supports diffusion LoRA training from image-caption manifests using Diffusers and PEFT LoRA adapter output
  - supports vision classification, object detection, and segmentation training from image manifests using Transformers vision model classes
  - supports vision LoRA adapter output and full fine-tuning; LoRA keeps recognized task heads trainable through PEFT `modules_to_save`
  - resolves image manifest artifact IDs through runtime-only staged source path metadata supplied by the application use case
  - records selected training task metadata and task tags on generated model candidates
