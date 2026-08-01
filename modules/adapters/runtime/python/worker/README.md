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
short work two minutes, validation two hours, dataset preparation and context generation eight hours,
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

- `requirements.txt` contains worker dependencies required to boot the sidecar,
  support model download/runtime loading, and safely read or write bounded
  Parquet data. Accelerate is pinned to `1.14.0` for automatic model placement,
  and PyArrow is pinned to `25.0.0`, which supports the worker's Python 3.10
  through 3.14 range and includes the fixes required for untrusted Parquet
  input. PEFT is pinned to `0.15.2` in the baseline worker so a saved LoRA can be
  attached to its validated base model during conversation inference. Startup
  repairs any missing or mismatched core pin before the worker is ready.
- `requirements-training-text.txt` contains exact reviewed Datasets and PEFT
  pins for causal text training. The baseline already provides the same PEFT
  pin for inference; the desktop training boundary additionally probes both
  packages and installs the text-training set only when that probe needs repair.
  A successful install is re-probed before the task may start.
- `requirements-training.txt` retains the broader optional multimodal training
  dependency declaration, including SciPy for object-detection assignment;
  those packages are not part of ordinary worker startup or the bounded
  text-training repair path.

Optional token-constrained JSON generation uses exact, conditionally installed
pins in `requirements.txt`: Outlines `1.3.2`, Outlines Core `0.2.14`, and
jsonschema `4.26.0`. These packages are installed and probed only for Python
3.10 through 3.13, the Python range supported by this reviewed Outlines release.
Outlines and Outlines Core are Apache-2.0 and jsonschema is MIT licensed. The
worker continues to boot on supported baseline Python versions outside that
range, but omits `dataset-preparation.constrained-json` from `/capabilities`.
When no explicit `PYTHON_RUNTIME_COMMAND` is configured, the desktop host
performs a bounded local version probe and prefers an installed Python 3.10
through 3.13 executable over an unsupported platform default. Explicit
operator configuration still wins. If no decoder-compatible interpreter is
installed, the baseline worker remains available and the UI keeps the
token-formatting control unavailable instead of sending a known-unsupported
request.
Dependency setup repairs missing or mismatched pins; capability reads never
install or repair packages. `npm run security:dependencies` also verifies this
direct decoder inventory, its Package URLs, reviewed licenses, and exact Python
marker; the deployment's full Python environment and container still require
their normal generated SBOM and image scan.

Implemented task:

- `generate-context-artifact`
  - accepts bounded workspace-staged text, Markdown, HTML, PDF, DOCX, CSV,
    JSON, JSON Lines, or Parquet sources plus bounded manual context;
  - reuses already-chunked structured rows only when each row has valid
    `chunkIndex` and `sourceLineage`, preserving exact row/source lineage;
  - otherwise performs bounded fixed, sentence, section, or structure-aware
    extraction and reports progress after every completed chunk;
  - emits either a local SQLite retrieval database with float32 embeddings or a
    fixed-member Markdown context-pack ZIP;
  - validates and preserves manual Markdown exactly, or semantically chunks,
    groups, and applies Standard/Strict cleaning to source material before No
    Summarization preservation or selected local-model summarization;
  - treats source content as untrusted model data, validates local-model topic
    output and maximum lines against a strict allowlist, and keeps source text,
    prompts, vectors, model output, and runtime paths out of public task state.
  - has opt-in AI E2E coverage for raw-source and persisted-chunk RAG database
    creation with a generated tiny local embedding model, plus model-assisted
    source-material Context Pack creation with a generated tiny constrained
    local model and structural Markdown validation.
- `context-artifact-operation`
  - inspects bounded staged sources using the same extraction and persisted
    chunk-lineage rules as generation;
  - opens RAG SQLite in read-only mode, verifies integrity, schema, manifest,
    counts, and digest, and parses context-pack ZIPs only through the fixed
    entry allowlist and aggregate byte/count ceilings;
  - embeds a bounded test query with the exact manifest-recorded local model,
    ranks cosine similarity inside the worker, and returns only bounded
    excerpts, scores, and citations; stored vectors never leave the worker;
  - cooperatively observes cancellation between validation, embedding, and
    ranking phases and reports only sanitized task failures.
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
  - preserves the desired example's field order when serializing the grammar
    while retaining an order-independent fingerprint; on Windows it uses the
    pinned Outlines kernel's identical eager callable so end-user hosts do not
    invoke Torch's optional MSVC compilation probe
  - bounds decoder schemas, properties, choices, output bytes, and a model-local
    four-entry LRU processor cache; processor compilation and public errors
    exclude prompts, source content, generated output, paths, and stack details
  - treats checked and unchecked generation as explicit modes: one bounded
    correction attempt preserves the selected mode and never converts a checked
    request to unconstrained generation. Both attempts use the same strict
    parser and semantic checks. For small-model
    compatibility, unchecked parsing may remove one exact `json` code-fence
    wrapper around one bounded object; any surrounding prose, extra fence,
    malformed object, schema mismatch, or semantic mismatch still fails
  - shows selected attribution as a locked companion shape in the UI, then adds
    the authoritative source id and available bounded name, sanitized public
    URL, author, and license after validation; model output cannot supply it and
    unselected runs omit it
  - uses `task.textInputMode` and `generation.promptTemplate` to either keep provided text fields or generate labels/captions/questions/answers with the configured local text model
  - emits diffusion LoRA, vision classification, object detection, and segmentation manifest rows from image metadata or structured manifest files; generated image labels/captions use metadata and annotations as text context rather than pixel-level visual understanding
  - treats `generation.failurePolicy=skip` as a data-only omission policy:
    an explicit model `skip`/no-candidate result or a final per-section output-
    format failure after correction omits only that source section and records a
    warning; model loading, decoder, inference, dependency, resource, and
    unexpected runtime errors still stop with a sanitized reason code, and a
    run with no valid examples still fails
  - validates generic Transformers snapshots before use with a local-only
    readiness check that never starts network acquisition during preparation:
    configuration,
    complete single or indexed weight files, every referenced shard, and a
    usable tokenizer must be present; transient transfer or late validation
    failures receive three bounded attempts and retain incomplete caches for a
    resumable explicit model-download task. Only containment or configured
    file/byte-bound failures clean the affected cache, and incomplete files are
    never accepted as downloaded models. Terminal responses use distinct
    sanitized interrupted-versus-invalid-snapshot codes without paths, tokens, or
    provider exception text
  - estimates local model weight memory before construction; validates the closed
    memory-only, 1 GiB, or 4 GiB system-memory overflow policy; never applies it
    to CUDA-only placement; and rejects larger shortfalls with a distinct,
    sanitized resource code that never becomes a skippable data omission
  - emits a bounded `memory-overflow` task phase only when the live preflight
    actually needs an allowed disk/swap fallback, enabling the app shell to warn
    that generation may run more slowly
  - keeps model-status reads nonblocking during construction so host resource
    telemetry and the global loading notification continue to refresh
  - emits dataset-generation completion progress after every source chunk while
    retaining the configured multi-chunk generation batch; progress contains
    only bounded counts and safe phase messages
  - suppresses tqdm stderr rendering and throttles structured file-download
    progress to at most two updates per second, while still emitting immediate
    initial, completed, and terminal task states
  - emits aggregate plus physical train/validation/test artifacts in JSONL/JSON/CSV/Parquet, keeps source groups and exact duplicates together, and derives summary counts from emitted partitions
  - resolves task-schema mappings and applies deterministic field/source/class/language profiling, exact and bounded SimHash duplicate detection, text/language bounds, personal-data and credential screening, explicit unsafe/benchmark gates, and optional license/consent/source-row rules
  - sends rejected provided or generated rows to reversible quarantine with source-row lineage and emits a stable-fingerprint quality report containing only aggregate profiles, reason counts, and bounded sanitized examples
  - writes a separate temporary JSON Lines review stream for accepted rows so
    authorized report-line review can page through actual records without
    placing row values in the aggregate report; quarantine remains the
    corresponding source for set-aside and reason-matched pages; the application
    copies the accepted stream into integrity-checked workspace-local temporary
    artifact storage and removes this runtime copy before preview reads
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
  - emits structured training progress after every completed microbatch,
    including gradient-accumulation substeps, so task status and notifications
    do not wait for multiple batches
  - cooperatively stops a running training task at the next batch progress
    boundary and removes worker-owned staged output before reporting cancellation
  - accepts the LLM instruction, classification, extraction, embedding-pair, and reranker training tasks
  - formats those row schemas into causal-LM training text when present,
    including the conventional `question`/`answer` aliases used by prepared
    instruction datasets when exact purpose metadata is unavailable
  - formats separate Input and Context blocks and includes an optional text-only
    Thought block only when those purposes exist in the prepared schema
  - resolves custom fields through prepared artifact purpose paths with a
    matching exact schema fingerprint; legacy artifacts without that metadata
    may use only established task-schema aliases, while malformed or mixed
    layout metadata fails before model loading
  - supports diffusion LoRA training from image-caption manifests using Diffusers and PEFT LoRA adapter output
  - supports vision classification, object detection, and segmentation training from image manifests using Transformers vision model classes
  - supports vision LoRA adapter output and full fine-tuning; LoRA keeps recognized task heads trainable through PEFT `modules_to_save`
  - resolves image manifest artifact IDs through runtime-only staged source path metadata supplied by the application use case
  - records selected training task metadata and task tags on generated model candidates
  - rewrites saved PEFT adapter configuration to the authority-owned base model
    id so generated LoRAs retain an exact portable association without a local
    snapshot path
  - has a named physical qualification command,
    `npm run test:model-training:e2e`, that trains all nine task types with two
    synthetic rows and one epoch against fixed tiny model revisions, verifies
    the staged Save/Discard candidate, and deliberately does not save or
    register it; the command is excluded from ordinary, E2E, AI, and aggregate
    test suites
- `conversation-text-generation`
  - accepts only the application-authorized runtime model id and bounded
    protected conversation messages
  - validates the exact complete snapshot in the host-owned local Hugging Face
    cache, without network acquisition, before a cold first-turn load
  - reuses a resident generator only when its model id matches exactly and does
    not depend on another feature having loaded a model earlier
  - resolves a selected LoRA as its exact same-workspace full base model plus
    adapter, validates the contained local adapter snapshot and declared base
    association, accepts only the exact worker-resolved local base reference for
    legacy adapters, attaches it with PEFT, and matches its revision for warm reuse
  - returns bounded assistant text through the task result while failures and
    lifecycle diagnostics remain free of model ids, prompts, paths, and raw
    provider/runtime errors
