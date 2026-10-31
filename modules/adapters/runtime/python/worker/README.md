# Python Runtime Worker

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

When the decoder is ready, `/capabilities` may report a minimized accelerator
total from `generation_capacity.py`. The lazy read uses only the trusted system
NVIDIA tool with a fixed memory/MIG query, no shell, a fixed working directory,
a minimal environment and no inherited provider/runtime credentials.
Windows resolves the required `ProgramFiles` value through the OS folder API;
it never copies an inherited folder value or searches the caller's `PATH`.
The probe imports neither Torch nor a model. Public waiting is at most one second;
the child-process wait has a 750 ms deadline. Output capture stops at 4097 bytes
for a 4096-byte frame.
A timeout requests termination but never proves it. One active probe remains
reserved until actual child exit and output retirement; uncertain exit cannot
start a successor. Known and unknown completed observations are cached for
30 seconds and device-visibility settings are checked before cache reuse.

Only one reported GPU and unambiguous unset or zero-index visibility are supported.
Empty/UUID/MIG/multiple-index masks, MPS, multiple devices, enabled or pending MIG,
inconsistent MIG states, errors and malformed output report no total. NVIDIA's
`N/A` marker is supported for non-MIG device fields; a total remains advisory and
does not establish CUDA compatibility or free VRAM. Unsupported platforms and
missing drivers stay unknown. Existing memory admission and offload guards remain
authoritative. No driver install or model work occurs during this read. See
[NVIDIA SMI](https://docs.nvidia.com/deploy/nvidia-smi/index.html) and
[CUDA visibility](https://docs.nvidia.com/cuda/cuda-programming-guide/05-appendices/environment-variables.html).

This directory contains the managed Python sidecar worker.

Semantic curation runs before split assignment. Its enabled curation algorithm
version `2` retains the `hashed-token-v1` embedding and applies
`maxComparisonsPerRow` separately to duplicate filtering and to coverage/contrast
recommendations. The second pass visits at most that many subsequent accepted-row
indices, wrapping once at the end; same-source skips consume candidate slots.
It never scans the full collection to find more cross-source matches.
`comparedPairCount` includes actual cosine comparisons from both passes, bounded
by twice the input row count times the configured comparison limit. Existing
version `1` reports remain historical; disabled curation keeps its unchanged
zero-comparison path and original rows.

This is an approximate bounded search, not a guarantee of a global nearest
example. Candidate order can affect recommendations. Embedding storage still
grows with accepted rows; a comparison bound does not prove native memory or
whole-app qualification. Reports retain aggregate metrics and at most 20 lineage
examples without row text or vectors. Existing source caps, split leakage checks,
quarantine and explicit approval remain in force. If a correction must be
withdrawn, disable optional semantic curation rather than restore an unbounded
recommendation loop. The `dataset-semantic-curation` source-owned profile includes
the semantic, advanced-preparation and dataset-quality unit files; it does not
run model accuracy or qualify a parent roadmap.

The model-free semantic reference tests use fixed 128-row and 1,024-row
token-permutation cohorts. They compare the disabled baseline with optional
curation, preserve each known unique row, source and label, verify source mixing
and resolve contrast recommendations to another selected source. The measured
curation call has prospective 60-second and 64 MiB traced-Python-allocation
assertions. The allocation measurement starts after fixture creation and stops
in `finally`; neither assertion enforces a native process or whole-app limit.
These known token permutations do not measure general natural-language recall.

The real provided-row preparation test uses 1,024 rows over 16 source files,
including 512 known reordered duplicates. It runs baseline, advanced and repeated
advanced preparation with the existing recommended mandatory quality checks.
The recommended baseline already removes all 512 known duplicates through its
fuzzy check. Advanced processing removes them through semantic curation before
the unchanged mandatory checks. This cohort proves compatibility rather than
additional end-to-end quality improvement beyond that effective baseline.
It verifies exact accepted/quarantined content, source and label counts, review
requirements, source-disjoint train/test groups and identical replay output
bytes. Model readiness and generation raise if called. Each pipeline call has
a prospective 120-second observed-duration assertion; this is not a hard deadline.
Owned temporary files are removed on success or failure. Printed measurements
contain only counts, time and allocation totals. Model accuracy, OCR, provider,
mounted UI and native resource qualification remain separate.

Scanned-PDF preparation uses the host-only `staged-pdf-ocr-v1` source map and an
explicit installed Windows recognition language. `ocr/task_sources.py` validates
the complete map before source/model/output access. Normalization captures exact
bound bytes through native read leases; display titles cannot select another
parser. Standard extraction loads no OCR supplier or native capture. The Windows
capability means protocol support, not installed-engine readiness. Actual tasks
check the reader/language and report only measured provider/page/line facts.
Running cancellation remains pending until the current operation unwinds; native
retirement must be confirmed. Existing quality, review and model guards stay active.
Long-line spans count Unicode code points; token counts remain word estimates,
with separate actual tokenizer limits in generation. See
[ADR-0046](../../../../../docs/adr/ADR-0046-replaceable-local-document-ocr.md).

Direct script startup loads `app` and its relative modules from the directory
that contains `main.py`. It uses one fixed private package and does not add
ancestor directories to the interpreter search path or require a repository
checkout. Conflicting or orphan private cached modules are refused. Existing
private modules must match their exact deployed file or namespace directory
before reuse. This prevents accidental cache adoption; it does not defend against
Python code that can forge all module metadata in the same process. Normal package-mode
imports remain supported. The same entrypoint is used in the flat desktop
resource directory; launch authentication, loopback binding and port checks
apply before serving requests.

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
- `requirements-context.txt` contains the exact reviewed LanceDB `0.34.0`
  and PyArrow `25.0.0` pins. Baseline `requirements.txt` includes this file so
  normal managed-runtime setup installs the vector database by default. The host
  also uses a context-specific asynchronous probe/install/re-probe before
  explicit RAG create, inspect, or query work. The worker itself never runs pip.

Text training requires a base-model reference before loading its datasets.
Local JSON Lines files use Datasets' built-in `json` reader; `jsonl` is a file
format, not a Hub dataset name. CSV, JSON and Parquet keep their existing readers.
Safetensors validation returns an invalid result for unreadable weights or an
invalid or empty shard index. Native read failures use fixed messages and discard
partial tensor observations. A missing reader dependency remains a warning in
normal validation and an error for publication; it is distinct from corrupt data.
Reports retain the opaque registered-model reference and omit the model path.

Optional token-constrained JSON generation uses exact, conditionally installed
pins in `requirements.txt`: Outlines `1.3.2`, Outlines Core `0.2.14`,
jsonschema `4.26.0`, and LLGuidance `1.9.1`. These packages are installed and probed only for Python
3.10 through 3.13, the Python range supported by this reviewed Outlines release.
Outlines and Outlines Core are Apache-2.0; jsonschema and LLGuidance are MIT licensed. The
worker continues to boot on supported baseline Python versions outside that
range, but omits `dataset-preparation.constrained-json` from `/capabilities`.
When no explicit `PYTHON_RUNTIME_COMMAND` is configured, the desktop host
performs a bounded local version probe and prefers an installed Python 3.10
through 3.13 executable over an unsupported platform default. Explicit
operator configuration still wins. If no decoder-compatible interpreter is
installed, the baseline worker remains available and the UI keeps the
token-formatting control unavailable instead of sending a known-unsupported
request.
LLGuidance installation is wheel-only. If no compatible wheel exists, setup
fails safely rather than building native source. Other packages keep their
existing format policy. Dependency setup repairs missing or mismatched pins; capability reads never
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
  - emits either one portable LanceDB ZIP with a manifest, exact-schema chunks
    table, and fixed-size float32 embeddings, or a fixed-member Markdown
    context-pack ZIP;
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
  - manually materializes a RAG LanceDB package only after rejecting traversal,
    links, duplicate/unknown entries, and expansion-limit violations; then
    verifies the manifest, one-table exact schema, counts, ordinals, ids,
    finite vector dimensions, citations, source lineage, and digest;
  - scans every vector with native Arrow operations in at most 256-row batches,
    retaining validated metadata without a full Python vector graph; checks
    cancellation during scanning and closes the reader on all exits;
  - preserves exact search and citations with no shared extraction/model cache.
    The synthetic comparison helper is
    `dev-tools/scripts/qualification/run_context_efficiency_qualification.py`.
    It compares a hash-verified baseline with current source in isolated native
    processes, records cold/warm stages and RSS, and retains failed attempts.
    Its deterministic embeddings do not qualify real model quality or hardware;
  - parses context-pack ZIPs only through the fixed entry allowlist and
    aggregate byte/count ceilings;
  - embeds a bounded test query with the exact manifest-recorded local model,
    runs exact cosine search in embedded LanceDB inside the worker, and returns only bounded
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
    generator; the model-bound lazy Outlines adapter masks every next-token
    choice, requires EOS at an accepting state, and then parses and validates
    the same schema before returning canonical JSON
  - preserves the desired example's field order when serializing the grammar
    while retaining an order-independent fingerprint; it preserves the pinned
    Core regex, default whitespace and token-to-string projection. Bounded
    LLGuidance matchers disable forced canonical tokenization. Eager Torch
    byte-mask operations avoid both native backends' compiled kernel imports
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

Parquet dataset review propagates the existing64MiB artifact retrieval maximum and
checks actual returned source bytes before runtime admission. The Python adapter
rejects oversized source before staging, the worker checks staged size before
Parquet parsing, and revised output uses one bounded file-handle read with a growth
probe instead of unbounded readFile. Application output bounds precede hashing
or storage. Output I/O failures have static outward messages. Worker Parquet
handles close explicitly. Footer row counts select only overlapping row groups;
preceding batches use num_rows, and only page slices convert to Python rows.
Exact row fingerprints, curation semantics and workspace authorization remain.
Small installed-PyArrow fixtures qualify these local controls. Compressed-source
limits and display budgets do not bound decoded-cell memory; adversarial decode
memory, host admission fairness, private-stage filesystem identity and physical
resource qualification remain pending. Existing worker queue/deadline controls
remain in force, including the two-hour dataset-review deadline. No new expanded
memory budget, model/provider download or runtime authority is introduced.

Dataset preparation output names are validated in the Python model and again at
task entry, before planning/source/model/generation/output effects. The worker
mirrors the existing host save-name rule: ECMAScript whitespace trimming,128
UTF-16 code units, no path punctuation/control characters, dot/dot-dot or trailing
period. Blank names keep the existing default; safe spaces/Unicode remain valid.
A captured primitive name feeds both row and JSON-report emitters even if a
callback mutates the request. Rejections use static text. The worker's canonical
absolute/non-symlink output-directory check remains in force. These controls do
not qualify source-path authority, parent substitution, identity-preserving native
file operations or controlled resource behavior; those R30 gaps remain pending.
Rollback retains stronger naming denial.

## Replaceable OCR provider contract

`ocr/protocol.py` defines immutable bounded source requests, explicit readiness,
and page/line results for optional text recognition. It uses only the standard
library and has no Windows, process, file or provider-client imports. The existing
application runtime/task ports remain the inward boundary.

A result must match the request's exact byte digest, language and selected original
pages, and the ready provider/version. Geometry must be finite and inside the
bounded decoded page. Aggregate page, line and text limits apply across the
result. Source bytes and recognized line text are excluded from representations;
contract errors contain one fixed message. Empty recognition remains empty.
There is no fabricated OCR confidence or accuracy score.

The initial Windows provider direction is accepted in
[ADR-0046](../../../../../docs/adr/ADR-0046-replaceable-local-document-ocr.md).
The protocol does not install or start a provider and does not make OCR ready.
Native helper/build/lifetime, normalization, capability and UI integration still
need actual qualification. Standard extraction and accepted model accuracy are
unchanged. Future adapters require the same bounds and separate supplier/egress
review; the protocol grants no arbitrary executable or service configuration.

## Private OCR messages and Windows helper source

`ocr/wire.py` enforces strict versioned private JSON frames: a four-byte
little-endian byte length, at most 23000000 request bytes and 2 MiB of response
bytes before parsing. It rejects duplicate or unknown fields, malformed UTF-8,
non-finite values, invalid types, geometry and global line/text overflow. A parsed
result still needs `check_result`; parsing is neither source authorization nor
provider readiness. The fixed portable profile runs five OCR test modules,
including resource-identity and process failure semantics.

`ocr/native/WindowsOcrHelper.cs` implements the installed Windows engine behind
that protocol. It accepts bytes instead of caller paths; selected original PDF
pages and rendered pixel geometry remain explicit. Its source can be compiled
with an installed SDK, without a supplier/model/language download. Source and
compilation do not establish native-process isolation, actual engine operation,
trusted packaged-resource identity or product availability. OCR remains
unavailable until the managed native owner, actual image/PDF and failure checks,
normalization, capability and both-host UI work qualify. See the native README
for framing, limits and remaining obligations. Standard extraction is unchanged.

The private Windows native owner now bounds a single fixed helper exchange with
creation-time Job membership, 512 MiB process/job ceilings, explicit pipes,
cancellation, a 120-second deadline and strict native retirement. Trusted local
resource files and ancestors stay pinned through retirement; missing or changed
resources fail closed. Failed closes retain ownership and deny successors.
The model-free Windows qualification operator is separate from ordinary portable
tests. This process/resource component does not enable OCR: trusted packaging,
provider composition, actual document results and host wiring still need work.

The replaceable provider now composes strict framing, fresh exact-language
readiness and source/page/provider-bound results over the fixed Windows owner.
Construction does not probe or launch. No command/path/supplier selector,
implicit language installation, fallback or confidence value is added.
The explicit `tests/qualification_ocr_documents.py --native` module exercises
only new synthetic image/scanned-PDF bundles using installed fixture tools.
It is not ordinary test discovery or a product readiness gate. Trusted packaged
resources, normalization and actual desktop/browser delivery still need their
own checks before OCR can be advertised. Standard extraction stays unchanged.

The fixed development/package builder lives in
`dev-tools/scripts/native/build_windows_ocr.py`, outside worker execution. Forge
invokes it before x64 Windows start/package, with isolated Python and only the
installed fixed compiler/SDK. It publishes the helper and a source/binary-bound
manifest into `ocr/native/build`; the desktop's existing worker resource copy
includes them. Missing tools preserve Standard startup and explicit OCR
unavailability. Runtime code never compiles. See the native README for input
leases, publication, interruption recovery and the trusted-compiler scope.
Normalization, capability and actual host checks remain separate requirements.

## Private scanned-PDF normalization support

`ocr/recognition.py` uses only `OcrProvider` and neutral records. It recognizes
page one to establish the total count, then every remaining original page with
the same immutable source and ready identity. More than 16 pages is an error,
never a partial success. Combined page, line, text and neutral encoded-byte
limits apply. The validation representation is compact ASCII JSON of the
dataclass fields; its 2 MiB cap is separate from the Windows wire-frame cap.

`normalize_sources_to_markdown` accepts private keyword arguments `ocr_language`
and `cancelled`. An explicit language opts existing PDF sources into recognition;
other formats retain Standard extraction and images are not newly supported.
Standard imports and calls do not import or probe the supplier. One bounded
16 MiB byte snapshot feeds all recognition calls. Regular-file metadata is
checked for observed changes; application authorization and native source-path
race qualification remain separate requirements.

Recognized lines retain exact Python character offsets, original pages and
finite rendered geometry in `ocr_document`. Blank pages remain in that metadata
without invented text. OCR region confidence is `None`; extraction quality
measures text hygiene, not recognition accuracy. Content-bearing normalized
fields are excluded from diagnostic representations. OCR admission, read,
identity, supplier and cancellation failures cannot become unsupported-file skips.
This private support does not enable public OCR. Contract/capability, task
cancellation, actual source staging and desktop/browser journeys still need work.

## Private staged-PDF snapshot

`ocr/source_snapshot.py` privately captures one exact direct-child PDF from a
task-owned local stage. Its binding carries the artifact, generated file name,
expected byte count and SHA256; upstream application authorization must supply
those values from the authorized retrieved byte copy. A binding is not authority.
Windows read leases pin non-reparse ancestors and a single-link regular file,
deny file write/delete and ancestor deletion, and retain uncertain closes.
Cancellation is observed between 64 KiB synchronous reads, without claiming a
hard deadline for an operating-system disk call. Bytes return only after exact
integrity checks and acknowledged retirement. The fixed resource factory stays
fixed. This component does not advertise OCR or qualify task/host integration.
The separate `tests/qualification_ocr_source_snapshot.py --native` operator uses
only fresh synthetic trees and the current fixed product resource; it never
builds, downloads, inspects old staging or reruns model accuracy.
Extra qualification probe handles have their own retained-owner ledger. A failed
or interrupted close denies further probes and never retries an uncertain handle.

Capture queries the explicit drive root with typed `GetDriveTypeW` before any
file acquisition. Only fixed local media is admitted; remote, removable, unknown
and failed drive queries deny without opening a source.

## Actual app OCR qualification fixture

The separate fixed test entry in `dev-tools/scripts/qualification/visual-composer/`
loads the newly packaged worker and retains its real authentication, task, source
capture, OCR, review and output paths. It replaces only generation for known
synthetic documents and denies actual model/provider operations. It is not copied
into or selected by the product worker. A second fixed synthetic identifier waits
at most 15 seconds for the real task's cancellation callback and emits no rows.

Both host dependency preparers remain active. Validate copied helper source,
manifest and binary before actual host qualification; a successful package can
still have OCR unavailable. Portable form/fixture tests, real native OCR, full
app delivery and model quality remain separate evidence.


## Guarded offload lifecycle integration

The private `offload_recovery.py` owner connects the real generator, loader and
`OwnedOffloadLease` guarded branch. Missing native support denies before model
inspection/import or staging. Explicit missing/serialized contexts cannot become
ordinary mode. Omitted ordinary empty-root behavior and Standard stay unchanged.
Cache reuse and each forward recheck the original live context; another context
or ordinary owner cannot alias it. A supplier interruption retains that owner.

The parent view retains the backend and lease before callbacks. Native reserve
acknowledgement must precede writing; seal must establish real protection before
reuse. Worker close signals reference release once and keeps cleanup pending.
Only the distinct parent view may request native retirement, which must confirm
owned exit, readers/IRPs, closes and durable charge removal. It cannot stop the
shared worker or infer exit from a task result. Unknown outcomes stay retained.

No production native backend is composed. The fixed `offload-resource-lifecycle`
profile uses eleven model-free unit files and explicitly synthetic fresh-domain
ports. It neither qualifies native protection nor reruns accepted accuracy.


OCR process and resource handles now keep a strong owner before close dispatch.
Each exact handle has one close attempt. An unknown native return, interruption
or bookkeeping failure retains the owner and denies unsafe reuse; cleanup never
retries that numeric handle. In-flight custody is separate from terminal
uncertainty, so a successful pipe-writer close does not block normal resume.
Resource retirement serializes synchronous reads and refuses later acquisition
or reads after cancellation-callback reentry. Pipe joins occur outside the close
lock. Fixed OCR process limits, trusted installation paths, public errors and
source-bound cancellation remain unchanged. Portable fault tests cover these
contracts; actual Windows locking, launch and crash qualification remain separate.


## Private fresh Windows staging Core

`tasks/windows_offload_core.py` implements actual Windows handle-relative fresh
namespace/leaf creation, private DACL checks, bounded identity/stream/inventory
queries, RH requests and one-attempt retirement. Constructors do no I/O. Explicit
private preparation pins a fixed local NTFS ancestor chain. Existing namespaces,
unexpected entries, links, named streams and changed guards are refused.

`tasks/windows_offload_backend.py` consumes this Core through the existing guarded
lease. Protected-journal and exact standalone-worker producers are mandatory;
neither has a successful placeholder. Durable reservation precedes creation,
writer quiescence precedes sealing, and parent-native retirement precedes fresh
held-object cleanup and charge credit. Unknown replies retain custody.

The production factory stays backendless. Source tests inject synthetic native,
journal and worker facts and exercise the real lease. They supply no native
qualification. This initial Core handles only its own new protected-current-user
namespace and one optional index file. Inherited/retained trees, saved protected
accounting, owned-worker/crash composition and actual model resources remain
pending. Accepted model quality stays closed.


The Core also requires a separate trusted finite execution owner before native
preparation or dispatch. No real producer is supplied yet. Its strict callback
admission refuses skipped, duplicate, early or foreign-thread execution. Locks
do not span execution-owner callbacks. Canonical Core/API/backend origin checks
refuse shallow copies before callbacks. Guard retirement requires actual aborted
completion; a raced successful break remains pending and cannot authorize deletion.
The fixed1500ms guard wait does not bound synchronous native calls by itself.


### Separate fresh Core diagnostic

The qualification helper under dev-tools now constructs an isolated fixed
parent/child diagnostic. Its private execution port admits the actual Core only
after real Job limits, parent membership readback and a child handshake. It loads
the four exact adapter source files in a private package without importing the
ordinary framework package. This is component evidence only; it does not qualify
normal managed-runtime startup or supply a production finite-execution producer.

The versioned `docs/operations/windows-offload-component-qualification.json`
records four actual schema2 cases on its exact earlier source. Empty/index
cleanup and timer-control exit were observed; the created collision folder was
retained. This does not qualify the later accounting binding, journal or
production recovery. Accepted accuracy/OCR, the backendless factory, retained
data charge and all model limits are unchanged.


## Fresh protected accounting source

`tasks/windows_offload_journal.py` implements the private journal port with a
real Windows API and a fixed sibling accounting namespace. It reuses Core's
native primitives with independent handle, allocation, call and IRP custody.
An exact Core binding permits one anchor duplicate during the Core dispatch.
Its canonical retirement witness requires settled, acknowledged Core cleanup;
the journal can then credit through its own surviving anchor.

Five fixed 512-byte records cover genesis, reserve, seal, reference release and
credit. The domain must precharge the complete 128 KiB journal bound within the
same 12 GiB limit. Supported allocation units are checked before file creation.
Write completion, a separate flush and exact held-file readback precede each
acknowledgement. Pending IO, short transfers, changed guards, unknown closes or
lost acknowledgements retain custody and charge. History files remain after
handle retirement; a new root/process or a parsed prefix cannot grant capacity.

The real shared-domain and stable mutable-fence producer is not supplied.
Before/after metadata checks alone are not that fence. Finite native execution
and exact worker/crash composition remain mandatory and unqualified. Default
construction and the production factory stay unavailable without file/model
effects. Explicit synthetic domain, IO and worker fixtures exercise the real
journal/backend/lease; they are source evidence only. The eleven-file model-free
profile keeps actual native, retained-tree, resource and final combined checks
separate. Accepted model accuracy and OCR stay closed.


### Journal diagnostic scope

Dev-tools adds a separate exact-source low-level journal diagnostic to the
eleven-file model-free lifecycle profile. It reuses the existing bounded
standalone Job/source/timer controller, with its own immutable profile and strict
reports. The old Core entry remains separate. No runtime code imports dev-tools.

A fixture-only context owns the actual journal API, inherited read-chain and
independent anchor; it cannot construct production accounting authority or a
lease. Five small frames and eight repeated reads exercise write completion,
flush/readback, unchanged guards and exact resource retirement. All uncertain
state stays pinned. Source tests use explicit synthetic replies; an actual run
requires a later committed-source effect review and independent result review.
Production domain/fence/finite/worker/retained recovery and model outcomes remain
pending. Existing defaults, guards, accepted accuracy and OCR are unchanged.
