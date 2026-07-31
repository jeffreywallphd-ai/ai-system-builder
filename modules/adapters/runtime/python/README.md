# Python runtime adapter

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Foundation for the managed Python sidecar runtime adapter:

- HTTP client
- process supervisor
- protocol mappers
- worker skeleton
- adapter factory composition

## Security boundary

- The client accepts only canonicalizable loopback HTTP endpoints with an
  explicit non-privileged port and no credentials, path, query, or fragment.
- The adapter foundation generates a private 256-bit bearer token, rotates it
  immediately before each spawn, places it only in the child environment, and
  reads the current value for every client request.
- Health/capability probes are authenticated. A newly composed foundation will
  not attach to an ambient localhost service that lacks its launch token.
- Runtime tokens are not caller configuration, persistence, logs, readiness
  metadata, or renderer/API/IPC data.
- The generic task adapter maps `model-download` to the worker's
  `ensure-model-download` task, retains a bounded current-process task index for
  list reads, and projects only allowlisted progress fields. Worker cache
  handles are resolved to host-local paths only through the private
  `ModelDownloadCompletionPort`; public task/API/IPC records never contain the
  handle or resolved path.
- Dataset-preparation mapping preserves the bounded optional advanced recipe and
  returns aggregate capability, structure, semantic, and synthetic-verification
  evidence. It never exposes embeddings, normalized source text, generated
  candidate text, prompts, or runtime-local paths.
- Selected source attribution is runtime-owned enrichment. The worker adds it
  after generation from bounded selected-source metadata, strips non-public URL
  details, and never accepts it from model output. Prepared artifact metadata
  also carries the exact schema fingerprint and purpose paths used later to
  reject mixed training layouts.
- Token-constrained JSON generation is an optional worker capability, not a
  baseline Python-runtime promise. The worker advertises
  `dataset-preparation.constrained-json` only on Python 3.10 through 3.13 when
  the exact reviewed decoder packages are importable. Python 3.9 and 3.14 may
  still run the worker, but must not advertise or silently emulate this
  capability.
- Checked generation is fail-closed: schema, dependency, tokenizer,
  compilation, dead-end, truncation, or validation failures return bounded
  decoder codes and never retry without token constraints. Unchecked generation
  remains a separate compatibility mode and still uses strict parsing and
  semantic validation.
- The task registry assigns an explicit bounded deadline by work class: two
  minutes for short/unknown work, two hours for validation, eight hours for
  dataset preparation, twelve hours for model downloads, and twenty-four hours
  for model training. This shared policy applies to Dataset Preparation, Model
  Management, desktop, thin client, and the direct model-download fallback.
  Callers cannot replace these caps with unbounded renderer values.
- Cancellation ends the selected task but does not stop the shared Python
  runtime or unrelated tasks. Long deadlines reduce false failures; they do not
  remove task progress, cancellation, terminal cleanup, or hard resource bounds.
