# Python Runtime Worker

This directory contains the managed Python sidecar worker.

Endpoints:

- `GET /health`
- `GET /capabilities`
- `POST /models/ensure-downloaded`
- `POST /tasks/execute`

Implemented task:

- `prepare-training-dataset`
  - validates split consistency (`trainRatio > 0`, `testRatio > 0`, and ratios sum to `1.0`)
  - normalizes supported source docs to markdown (`.txt`, `.md`, `.html`, `.pdf`, `.docx`)
  - explicitly rejects legacy `.doc` files (convert to `.docx` or configure skip policy)
  - chunks markdown using recipe chunking config (`character` strategy)
  - auto-downloads missing generation models via `huggingface_hub` before generation
  - generates QA training examples from chunks via local `transformers` model configuration
  - supports generation failure handling policy (`generation.failurePolicy`), defaulting to strict fail-fast unless normalization mode is best-effort
- emits one aggregate dataset artifact in JSONL/JSON/CSV/Parquet using generated-example rows
