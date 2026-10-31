# Python runtime adapter

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

The capabilities mapper preserves only a positive safe integer for the optional
worker-reported accelerator total. Invalid optional telemetry becomes unknown;
it cannot bypass strict runtime identity or capability validation. The observation
comes from the actual authenticated worker, including an attached worker. It is
advisory installed capacity and never model readiness, available VRAM, process
ownership or an offload capability. No JS-host hardware substitution is allowed.

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
The existing output-sample caption is retained. A generic wording clarification
improved one 0.5B development case, but the candidate containing it lost a
previously correct 1.5B constrained case in both phases of the exposed regression.
That broader comparison does not isolate caption causality. The wording was withdrawn;
small-model gains cannot justify a shared-default regression. Prompt experiments
need task/model-specific evidence in addition to unchanged contract tests.
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
- Cancellation reports the selected task's actual lifecycle without stopping the
  shared Python runtime or unrelated tasks. Queued Dataset Preparation can cancel;
  running preparation remains active until observed completion. Other families
  retain their supported cooperative cancellation. Deadlines do not turn an
  unconfirmed cancellation into terminal success or remove resource bounds.

Dataset ownership is reserved before its task POST, including a delayed or lost
acknowledgement. At most 256 such private reservations are retained; capacity or
duplicate identity denies a new dispatch without evicting uncertain work. Unknown,
misidentified or contradictory replies do not release ownership. An exact terminal
read, consistent confirmed cancellation, or the currently owned worker's actual
exit does. A late acknowledgement cannot resurrect a completed task.
Both automatic recovery paths (task cancellation/deadline and direct model-download
timeout) share one admission fence. Recovery cannot restart protected Dataset work;
new starts are refused while recovery runs. Unconfirmed recovery failure keeps
admission fenced while status observation continues. A healthy read alone is not
recovery proof. These controls do not authorize stopping retained offload workers or
relax native shutdown and staging qualification.

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

## Explicit bounded offload

Idle generation unload releases its last cache-iteration reference before garbage
collection and allocator cleanup, including Standard generators. A failed offload
close retains the cache owner. Model unload does not reset process-global CUDA
library state; qualification records initialized runtime floors separately from
model/staging release and confirms actual owned process exit.

Dataset Preparation's default-off `offload-v1` route validates native Qwen2 safe
weights/tokenizer inputs, creates a tied meta-model and admits explicit bounded
CPU/CUDA maps before loading. It does not grant overflow or change precision.
PEFT discovery configuration/weight families, including case variants, deny
before tokenizer/model reads; unsupported local adapters cannot redirect sources.
Forward headroom denials retain the existing insufficient-resource task error
and bounded numeric diagnostics; they never become format failures or poison an
unstarted forward. Placement and execution reserve checks remain unchanged.
The exact versioned capability gates host dispatch; passive reads do not load or
install. Cached-generator leases retain source/staging references across tasks,
serialize forwards, preserve request-specific generation settings and release only
after confirmed reference cleanup. Teardown drops the graph rather than invoking
Accelerate detach hooks that can rematerialize weights. Original inputs are never
deleted. See `docs/operations/optional-low-memory-inference.md` for finite limits,
initial model/template/version support, truthful cancellation and pending physical
qualification.

## Memory admission notifications

Dataset Preparation memory-admission failures use the workspace notification
center in desktop and thin client, without a duplicate inline memory error.
Desktop preflight denial publishes before dispatch; post-start desktop failures
remain in the existing background task activity. Thin-client observed task
failures publish to notification history. Contextual form validation and other
security/readiness blockers keep their existing presentation and enforcement.

The worker projects only the known memory-failure code and a bounded numeric
shortfall: resource kind (RAM, VRAM or combined), required bytes, currently
available bytes and explicitly permitted overflow. API/IPC and UI normalize
these facts again. Guidance rounds the remaining shortfall upward to MiB after
subtracting already permitted overflow. It describes a point-in-time observation,
not a guarantee that a later retry will fit. Unknown or malformed measurements
use safe smaller-model/retry guidance without inventing an amount. No exception
text, model/source details, filesystem paths, prompts or raw logs enter the new
public field. Existing guards, limits, admission, cleanup and offload opt-in
controls remain unchanged; notifications never authorize a denied model load.



## Private guarded low-memory ownership

The worker's private recovery context now reaches the actual cached generator,
pinned loader and offload lease. This is not a task/config/API option. Guarded
requests deny before model/path inspection when native authority is unavailable;
ordinary and guarded cache owners remain distinct. Worker reference release and
parent native retirement are separate, and unknown outcomes retain custody.
No native backend is composed, so actual guarded recovery remains unavailable.
See the worker README and optional low-memory operations guide for scope and tests.


## Private Windows staging implementation

The worker owns the fresh Windows staging Core and concrete guarded-backend
consumer. Dev-tools depends on that adapter direction, never the reverse.
Missing real protected-journal or standalone-worker owners denies readiness
before Core operations. No production composition or capability is added.
See the worker README and optional low-memory operations guide for the synthetic
feature checks and still-pending native, retained-tree and resource evidence.


Actual native preparation also requires a trusted finite execution owner. That
producer remains missing; a synthetic dispatcher supplies no native authority.
Canonical owner checks prevent copied Core/backend/API objects from dispatching.


### Standalone component boundary

The dev-tools fresh Core diagnostic uses exact adapter source with the installed
isolated base Python, one owned inert child and bounded structured reports. It
does not start the application, managed worker, model or normal tasks package.
Portable tests exercise its failure controls with synthetic ABI responses only.
Native fixture evidence, production execution/journal/worker composition, real
resources and final combined qualification remain distinct requirements.


## Protected accounting component

The worker's concrete journal is an adapter-private consumer of the existing
backend port. It owns its native resources independently of Core and requires
the exact Core binding and settled retirement witness. No runtime code imports
dev-tools. The five-record file stays separate from Core's index-only inventory.

An authoritative shared domain and stable mutable-file/namespace fence are
required; no producer is selected here. A numeric snapshot, fresh namespace or
valid record cannot replace those live owners. Unknown usage reserves the full
12 GiB and prevents even journal bootstrap writes. The mandatory finite owner
and standalone-worker recovery also remain pending. The default factory stays
backendless; Standard loading, model guards, accepted accuracy/OCR and old data
are unchanged. See the worker README and operations guide for source tests and
separate native qualification.


## Owned read-session prerequisite

The private worker execution modules now define a persistent, model-free Windows
read session. Its retained CRT controller performs blocking launch and pipe work.
The actual Core, API and execution callback stay together on the child request
thread. A separate timer bounds admission for each operation; idle is not a model
writer deadline. One 120-second budget includes retirement and publication.

This source is a prerequisite, not the production offload factory. The factory
stays backendless. Source tests use synthetic ABI responses; committed-source
native execution requires separate effect and result review. Missing shared
accounting, stable mutation protection, actual model-worker recovery and resource
evidence remain technical work. Standard behavior, all model limits, accepted
accuracy and OCR remain unchanged. See the worker README for exact ownership,
timer, protocol and fixed-record limits.
