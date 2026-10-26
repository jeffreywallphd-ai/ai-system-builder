# Context Management Threat Model

- Status: current
- Scope: Context source selection, private staging, local generation, review,
  save/discard, Data Management handoff, and saved context artifacts
- Related:
  `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md`,
  `docs/adr/ADR-0041-context-management-and-portable-context-artifacts.md`,
  `docs/architecture/context-management.md`

## Protected assets

- Workspace-owned source bytes and exact source identity
- Manual context content
- Source and chunk lineage
- Model prompts, outputs, and local model references
- Embedding vectors
- Private generated output awaiting review
- Saved RAG databases and Markdown context packs
- Artifact object, catalog, and binding integrity
- Workspace, organization, and principal isolation
- Runtime launch authentication and local filesystem paths

## Trust boundaries

1. Renderer and thin client to authenticated host transport
2. Data Management or Artifact Browser handoff to Context page state
3. Application use case to workspace artifact storage and catalog
4. Host private staging to managed Python runtime
5. Untrusted source/manual text to no-summary or model-assisted generation
6. Runtime output back to application review state
7. Reviewed private output to object storage, catalog, and binding persistence
8. Saved LanceDB/ZIP bytes to runtime inspection and RAG query projections
9. Reviewed exact dependency declarations to package distribution and the
   host-selected managed Python environment

Renderer selections, filenames, media types, “already chunked” claims, model
output, citations, output handles, and source content are untrusted. Host
workspace context, storage retrieval, digests, capability checks, and local
model installation state are authoritative at their owning boundaries.

## Threats and controls

Embedding placement accepts only CPU, CUDA or automatic execution intent. It
cannot select a path, provider, model, credential, network destination or portable
artifact authority. CPU is the omitted default. Query placement is separate from
verified manifest model/dimension metadata; injected manifest placement is ignored.
Explicit unavailable CUDA and exhaustion fail without fallback or private detail.
Weights and all inputs use the same device and owned tensors/cache are released.
Tests cover propagation, compatibility, unavailable/exhausted devices, manifest
injection and unchanged cleanup/validation. Real trained-device qualification
uses fixed verified safe files, no remote code/pickle and synthetic sources;
availability or deterministic fixtures alone never qualifies model performance.

| Threat | Control |
| --- | --- |
| Cross-workspace source read or review/save | Host adds workspace context; application authorization requires artifact read/write scopes; task scope includes workspace and available organization/principal; mismatch returns not found. |
| Forged Data Management handoff | Handoff carries only workspace/artifact ids; Context resolves artifact bytes and capability again. |
| Source substitution or stale review | Source and manual bytes receive SHA-256 digests; runtime verifies staged bytes; application validates returned source evidence and re-hashes output before review and save. |
| Path traversal or symlink escape | Host creates private directories; runtime receives absolute staged paths; output handles are basename-only; application resolves canonical containment and requires a single-link regular file. |
| Oversized or malicious document/structured input | Source count, per-source, aggregate, row, archive, extracted-text, chunk, preview, and artifact limits; shared format allowlist; existing bounded PDF/DOCX/Parquet readers. |
| False “already chunked” claim | Worker requires persisted chunk and source-lineage evidence on every row; otherwise it uses bounded extraction and reports `alreadyChunked=false`. |
| Prompt injection in source data | Local-model system prompt states source chunks are untrusted data; constrained schema is used when supported; strict parse and validation always apply; only supplied citation ids are accepted. |
| Malformed Markdown or active HTML in review | Manual and generated Markdown is bounded and validated before packaging; review uses the safe React Markdown projection and never executes raw HTML. |
| Ambient network model retrieval | Embedding and text generation resolve managed local model references and use local-only Transformers loading; runtime generation never downloads a model implicitly. |
| Model-authored or malformed citation | Output schema bounds citation arrays and strings; application accepts only ids from the supplied chunk set. |
| Embedding or protected-content disclosure | Vectors and complete source content stay inside the saved artifact; previews are bounded; catalog, task metadata, logs, and errors omit embeddings, prompts, model output, manual content, and local paths. |
| Partial or misleading saved artifact | Runtime completion remains private and review-required; Save verifies bytes and uses object-then-catalog-then-binding ordering; failures compensate earlier writes. |
| Runtime task denial of service | One managed executor, bounded deadlines, per-chunk progress, cooperative cancellation, task retention limits, and hard generation bounds. |
| Substituted, partial, or raced LanceDB installation | Exact repository-owned pins and Package URLs, fixed pip arguments, supported-host checks, bounded timeout/output, asynchronous one-flight ensure, post-install import/version verification, and fail-closed task dispatch. No caller package, version, index, URL, or command argument is accepted. |
| Installer diagnostic disclosure | Public task progress uses fixed bounded messages and sanitized retryable codes. Package-manager output, environment, command lines, local paths, source content, prompts, and vectors are excluded from transports, notifications, and normal logs. |
| Passive read causes environment mutation | Only normal managed-runtime setup and explicit Context generation/inspection/query starts invoke the ensure. Readiness, capabilities, status/list, Context Browser reads, and notification polling are no-install operations. |
| Archive entry traversal | Context-pack member names are fixed by code. LanceDB packages allow only `manifest.json` and contained regular files beneath `database/`; absolute, traversal, backslash, drive-like, duplicate, link, encrypted, unsupported-compression, and unknown entries are rejected before manual private extraction. |
| Malicious saved LanceDB or ZIP | Exact workspace bytes and catalog digest are verified before runtime parsing. Package compressed/expanded bytes, entry count, file type, manifest, one-table name, exact non-null Arrow schema, row/count/id/ordinal/vector/citation integrity, and source lineage are validated before inspection or query. |
| Retrieval leaks vectors or unrelated rows | Query uses the manifest-recorded local embedding model; only top bounded excerpts, scores, and validated citations return to the host. Vectors never cross the runtime boundary. |
| Transport scope confusion | Electron requires a trusted owned-window sender and independently reconstructs the typed request; API read/write routes are separately allowlisted and centrally scoped. Both inject authoritative principal/workspace context. |
| Unsafe diagnostics | Worker logs event class, task type, bounded error code/stage only; public status maps to bounded generic messages. |
| Notification disclosure or cross-workspace task confusion | The shell bridge lists only authorized workspace tasks; records use stable workspace-scoped ids, bounded progress, and sanitized copy without paths, source text, prompts, model output, or payloads. |

## Denial and failure-path evidence

Focused tests cover:

- mismatched source and output digests,
- cross-workspace task reads,
- invalid settings and oversized inputs,
- unknown model citations,
- source prompt-injection text remaining untrusted,
- cooperative cancellation,
- catalog-write compensation,
- binding-write compensation,
- output cleanup on failure and discard,
- runtime task dispatch and progress mapping.
- exact dependency fast-path/install/re-probe, timeout, unsupported Python,
  unexpected probe, partial/mismatched install, concurrent one-flight behavior,
  sanitized task failure, and passive-read no-install behavior.
- malformed LanceDB/ZIP, archive traversal/link/duplicate/expansion attempts,
  schema/vector/citation mismatch, digest/media mismatch, untrusted IPC sender,
  unauthenticated API request, and read/write route confusion.
- malformed manual/generated Markdown, safe formatted review, Standard/Strict
  cleaning, No Summarization preservation, and notification task projection.

## Residual risk and qualification

Host reconciliation retains only accepted task callbacks and immutable scope,
preserving organization context across asynchronous observation. It does not
discover tasks or save review output. A transient read failure cannot delete
inputs still owned by a worker. Public reads reauthorize before using the same
single-flight completion path; cleanup retains ownership until removal succeeds.

- LanceDB and context-pack ZIP artifacts intentionally contain derived source content and must
  retain the same workspace access and deletion posture as their sources.
- Compensation is best effort across independent object, catalog, and binding
  stores. Operators still need orphan reconciliation when a backing service is
  unavailable during cleanup.
- Physical qualification must exercise representative local embedding and
  text-generation models on supported CPU and CUDA profiles. Tests use injected
  providers and do not prove every third-party model's numerical quality.
- Existing document parsers and local model libraries remain dependency
  supply-chain inputs covered by the repository dependency and SBOM controls.
- A first managed installation requires the approved package source and can
  fail offline. Exact native-wheel behavior still requires release-platform
  qualification; a successful install is always re-probed before Context work.

> AI documentation reminder: changes to Context inputs, models, output formats,
> publication, system use, or public transports require this threat model to be
> revisited.

Task lifecycle delta: status reads and explicit review actions serialize per
accepted scope, preventing concurrent save/discard from publishing duplicate
artifacts. Reconciliation preserves accepting organization context and does not
grant renderer write authority. Transient status failures retain staging;
confirmed terminal results or worker stop permit cleanup. Failed worker stops
or cleanup retain ownership and persistence for retry. Local deterministic
denial, duplicate-save and no-renderer lifecycle tests cover these controls;
physical worker shutdown and unavailable hardware qualification remain pending.

Allocation delta: all table vectors remain mandatory validation inputs. Native
Arrow finite/null/dimension checks run in batches of at most 256 rows, followed
by the existing per-row identity, ordinal, text and citation checks. Only
validated metadata is retained for exact result verification. Cancellation
interrupts scanning before embedding/search, closes the native reader and
removes private materialization; it cannot leave a reusable partially validated
database. Package ceilings, catalog digests and exact index-bypassed search are
unchanged. Late-batch corruption and cancellation/retry regressions exercise
this boundary. Synthetic RSS/timing evidence cannot substitute for representative
local-model CPU/accelerator and retrieval-quality qualification.

## Renderer asynchronous ownership

Protected presentation assets include workspace source/manual content, accepted
task identity, task-recovery storage, saved-artifact selection and notifications.
A late workspace/client reply, duplicate action or substituted source/task/result
can confuse those assets even when the host independently authorizes requests.
Committed layout retirement fences page and shell task-list sessions. Typed client
checks precede dispatch and follow await; reply identity is checked before use.

A synchronous action owner prevents duplicate generation, save/discard, rebuild
and delete before React renders busy state. Accepted generation ownership stays
through review and unconfirmed cancellation; terminal evidence releases it. Save
requires a matching saved result and returned artifact, never a success claim from
a nonterminal response. Newer detail/list reads retire earlier presentation.
Raw transport exceptions never become UI diagnostic copy; local Markdown
validation emits only its fixed messages. Application authorization, bounded
staging, model isolation, review authority and host task observation remain.

The focused shared-renderer cases include real pre-fix race failures, mismatched
source/task/artifact denial, duplicate actions, delayed replies, cancellation,
review and saved-artifact readback. Their client fixtures do not qualify physical
RAG semantics, host transports, provider access or native cleanup. Existing model
quality and OCR evidence is retained; unknown offload objects are untouched.

Each accepted generation has a local observation epoch. Later cancellation or
poll replies cannot replace a confirmed terminal or ready-for-review state. A
fresh explicit acceptance resets presentation for the next generation without
reviving the old observation. This is renderer ownership, not runtime authority.

Delete confirmation binds the selected artifact ID and verified storage key.
Only an acknowledgement of that exact key can clear the confirmation, refresh
the list or report deletion. A different key leaves the selected view intact.

### Manual pack content and lineage consistency

A readable package with a correct outer digest can still declare a manual digest
that does not match `context.md`, or claim missing/extra entries or source lineage.
Manual inspection now enforces the same one-entry/no-source shape as generation
and hashes exact bounded member bytes before accepting their text interpretation.
Fixed failures omit contents, digests and local paths. Existing path, outer-byte,
archive and UTF-8/Markdown checks remain mandatory; this check grants no author
authenticity. Positive Unicode/line-ending cases and substituted bytes, stale
digests, invalid shape and invalid text cases exercise the production operation.
These local fixtures do not qualify actual hosts, model semantics or native
ownership. Rollback must retain denial of inconsistent manual packages.

### Fixed manual Context app-journey support

The private provided-data fixture also permits one declared manual pack and
bounded pack inspection through production tasks. Its current candidate/run/temp
bindings, regular immediate staging, one-entry bytes and no-model/no-source rules
prevent fixture scope expansion. Existing native quotas and ownership stay intact.
The UI journey uses only public controls for mutation and scoped bounded reads
for identity, validated manifest and exact stored-byte oracles. Error/report data
exclude credentials, content and local paths. Local fixture/oracle/collection
checks do not qualify app selectors, host execution, native retirement or a parent.
