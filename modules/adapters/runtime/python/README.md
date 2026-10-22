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
- Context generation maps to `generate-context-artifact`; saved-source
  inspection, bounded LanceDB/context-pack verification, and RAG test queries
  map to `context-artifact-operation`. Exact bytes are privately staged and
  hashed by the host. The adapter returns only safe manifests, topic summaries,
  source readiness, excerpts, scores, and citations; it never returns stored
  embedding vectors or runtime-local paths.
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

Conditional object constraints use complete disjoint branches only when a
required discriminator and exact property subsets prove equivalence. Original
final validation/fingerprints remain authoritative. Both forms count against
unchanged schema/cache budgets; unsupported expansion retains the original.
The pinned backend retains its default JSON formatting policy. An empty
inter-token whitespace override preserved lexical values but regressed actual
held-out model quality and was withdrawn. Grammar equivalence alone cannot
establish model quality; original final validation and all bounds still apply.
Built-in classification shapes constrain bounded configured labels, including
multi-label items, without truncating larger recipes or rewriting saved layouts.
Prompt schema/examples retain the existing sorted canonical presentation and
exact values; changing prompt field order requires real fixed-model regression
evidence. Token constraints and final integrity identities retain their own
semantically equivalent representations.
- The task registry assigns an explicit bounded deadline by work class: two
  minutes for short/unknown work, two hours for validation and Parquet dataset
  review, eight hours for dataset preparation and context generation, twelve hours for model
  downloads, and twenty-four hours for model training. This shared policy
  applies to Dataset Preparation, Dataset Review, Model Management, desktop,
  thin client, and the direct model-download fallback.
  Callers cannot replace these caps with unbounded renderer values.
- Context generation maps to the worker's `generate-context-artifact` task and
  returns only bounded manifests, summaries, lineage, and output evidence.
  Source text, prompts, embedding vectors, model output, and runtime paths stay
  behind the adapter boundary.
- LanceDB is an exact managed Context dependency, not a UI or worker-owned
  installer. Normal managed-runtime setup ensures it before process startup.
  Explicit Context generation, artifact inspection, and query starts repeat the
  same idempotent asynchronous probe/install/re-probe so a removed or mismatched
  install is repaired before dispatch. Concurrent calls share one in-flight
  ensure. Only explicit starts can install; readiness, capability, task status,
  task list, and Context Browser reads remain no-install operations. Installation
  activity is projected through the existing workspace task list with fixed
  path-free messages; package-manager output remains private.
- Parquet dataset review binds every runtime task to the authenticated
  workspace, stages bytes only in a private temporary directory, returns at
  most 50 sanitized row values per read, and requires the exact canonical row
  fingerprint before streaming a rejected-row copy. The adapter always removes
  its temporary directory and never returns runtime paths.
- Cancellation ends the selected task but does not stop the shared Python
  runtime or unrelated tasks. Long deadlines reduce false failures; they do not
  remove task progress, cancellation, terminal cleanup, or hard resource bounds.

Dependency setup publishes only finite `python-dependency-outcomes-v1` outcomes.
`readPythonRuntimeDependencySessionOutcomes` exposes at most the two latest
operation summaries, deeply immutable and session-only. A trusted
`onDiagnosticOutcomes` observer cannot alter setup results. Legacy
`diagnosticsFile` paths are ignored: private persistent sink authority, bounds
and retention require separate qualification. No automatic temporary files are
created; security audit remains separate.

Context embeddings accept optional `cpu`/`cuda`/`auto` placement. CPU remains the
omitted default, and explicit CUDA fails if unavailable or exhausted. Weight and
token tensors move together; GPU tensors/cache are released without cross-request
model/vector caching. Device is absent from saved manifests and uses a separate
retrieval request hint. Model resolution remains local-only and trusted-code-free.
# Owned task loss

The foundation retains bounded terminal results for tasks it accepted. A confirmed
exit from its owned supervisor fails unfinished accepted tasks with a safe retryable
error, including admission/read races. Transport errors alone do not establish
failure. Old process events cannot affect a new generation; observed terminal
results and confirmed cancellation recovery remain authoritative.

