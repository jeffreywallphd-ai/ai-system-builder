# Python Runtime Worker

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This directory contains the managed Python sidecar worker.

The worker must be launched by a host supervisor on `127.0.0.1`, `localhost`, or
`::1` with a non-privileged port and a `PYTHON_RUNTIME_AUTH_TOKEN` of at least 32
characters. Startup rejects remote/wildcard binding and missing authentication.
Every endpoint requires `Authorization: Bearer <current-launch-token>`; this
includes health and capabilities. The token is private launch state and must not
be logged or returned.

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

Implemented task:

- `prepare-training-dataset`
  - validates split consistency (`trainRatio > 0`, `testRatio > 0`, and ratios sum to `1.0`)
  - normalizes supported source docs to markdown (`.txt`, `.md`, `.html`, `.pdf`, `.docx`, `.csv`, `.json`, `.jsonl`)
  - explicitly rejects legacy `.doc` files (convert to `.docx` or configure skip policy)
  - chunks markdown using recipe chunking config (`character` strategy)
  - uses structured CSV/JSON/JSONL rows directly when they already match the selected LLM, diffusion, or vision task schema
  - generates QA-derived task rows for LLM instruction, classification, extraction, embedding-pair, and reranker profiles through local `transformers` model configuration when source documents need generated examples
  - uses `task.textInputMode` and `generation.promptTemplate` to either keep provided text fields or generate labels/captions/questions/answers with the configured local text model
  - emits diffusion LoRA, vision classification, object detection, and segmentation manifest rows from image metadata or structured manifest files; generated image labels/captions use metadata and annotations as text context rather than pixel-level visual understanding
  - supports generation failure handling policy (`generation.failurePolicy`), defaulting to strict fail-fast unless normalization mode is best-effort
  - emits one aggregate dataset artifact in JSONL/JSON/CSV/Parquet using the selected task schema
- `train-model`
  - supports causal language model training over text-like datasets
  - accepts the LLM instruction, classification, extraction, embedding-pair, and reranker training tasks
  - formats those row schemas into causal-LM training text when present
  - supports diffusion LoRA training from image-caption manifests using Diffusers and PEFT LoRA adapter output
  - supports vision classification, object detection, and segmentation training from image manifests using Transformers vision model classes
  - supports vision LoRA adapter output and full fine-tuning; LoRA keeps recognized task heads trainable through PEFT `modules_to_save`
  - resolves image manifest artifact IDs through runtime-only staged source path metadata supplied by the application use case
  - records selected training task metadata and task tags on generated model candidates
