# Data Management Threat Model

The private provided-data version fixture accepts only its small synthetic
provided-row classification source and production review path. It denies
generation, OCR, downloads, other tasks and linked or external source paths.
It retains authentication, offline dependency preparation and Standard native
limits. Restart qualification requires complete resource close/reopen, fresh
per-session evidence and exclusive closed-phase shutdown records. A readiness
response, old acknowledgment or source test cannot supply a restart pass.
Uncertain shutdown prevents another owner. Reports exclude inputs, credentials
and supplier exception text. Actual host evidence and parent review remain
separate from portable source checks.

## Current preparation source-list admission

Desktop retires source reads with an exact workspace/client scope and a monotonic
request identity. Thin-client source effects capture their own lifetime rather
than accepting the current value of a mutable mounted flag. Scope changes,
superseding reads and unmount prevent old success and failure replies from
changing source data, current selections, readiness or task status. Loading,
failed and successfully empty source lists remain distinct, with contextual retry.
Neither host dispatches preparation without a current ready list. Both forms
reject malformed source arrays exposed by their clients; duplicate source matches
are retained for later exact replay validation. Desktop malformed source and
version-list envelopes no longer become empty results. The shared thin-client
HTTP source client rejects missing or nonarray items with fixed safe text; actual
client-to-form tests cover retry to a genuine empty response.
Fixed failure copy exposes no supplier exceptions or private paths.
Application authorization remains authoritative. These local controls do not
qualify one-use saved setup replay or actual provider, model, native or scale work.

## Saved-version Browser response and consent controls

Both Browser detail views associate history only through an exact unique
complete-dataset artifact key in normalized workspace-qualified records.
Ambiguous, duplicate, foreign, malformed and mismatched version responses are
denied. Scope-keyed sessions retire late reads and action replies on selection,
workspace or service replacement. List and comparison errors use fixed inline
retry text; publication failures use fixed notification text and do not claim
that a dispatched remote operation was cancelled or rolled back.

Explicit publication captures the current workspace, version, repository,
visibility and creation choice. A synchronous guard prevents duplicate dispatch.
Public consent resets when any relevant input changes and after dispatch. Only
an exact matching normalized publication response produces success. Application
authorization, provider credentials and immutable-byte verification remain below
the UI. Local component tests do not qualify real provider availability or the
later page-owned setup reuse, source freshness and edit-preservation boundary.

The direct Python worker entrypoint loads relative application and task modules
only from its own deployment directory, using a fixed private package. It does
not search repository ancestors or change the interpreter search path. A missing
deployed app, conflicting private package or orphan private submodule fails
startup. Cached private files and namespace directories must match their exact
deployed locations before reuse. This does not isolate arbitrary code running
inside the Python process. A cached repository
app is not a fallback. Flat-deployment subprocess tests cover these denials.
Loopback-only binding, launch authentication and nonprivileged port validation
remain mandatory. A model-free packaged-start observation is separate from
model execution, free-memory admission and native/offload qualification.

Accelerator-capacity recommendations accept only a minimized positive-safe-integer
total from the authenticated worker. Optional malformed facts become unknown
without weakening core capability validation. A lazy fixed system-driver query
uses no shell or caller executable, excludes inherited credentials, caps output
and public waiting, and retains its single active probe until actual child exit
and output retirement. Ambiguous visibility, MPS, multiple devices and MIG changes
deny a total. No raw driver output, device identity or path enters public status.
The fact is advisory installed capacity: live memory admission, decoder readiness,
model authorization and native/offload ownership remain authoritative. A synthetic
UI capacity profile is never physical hardware or model qualification.

## Scope

The text-training local reader admits only the supported format allowlist and
maps JSON Lines to the built-in JSON builder. A missing base-model reference
fails before dataset or model loading. Corrupt safetensors, tensor-read failures
and malformed or empty shard indexes produce invalid validation results.
Reader failures discard partial tensor keys and shapes and expose only fixed
messages, without native exceptions or paths. Missing reader dependencies remain
an explicit incomplete check and deny publish-bound validation. These controls
do not establish model quality, native file ownership or physical training
qualification; offline synthetic tests and actual local-file reads are separate
from those checks.

This model covers workspace source selection, local and Hugging Face staging, structured and document parsing, optional local-model generation, quality policy resolution, curation and quarantine, split creation, human approval, task lifecycle transport, result materialization, immutable dataset versions, publication evidence, warnings, and diagnostics. Artifact Browser handoffs into Context Management are additionally governed by `docs/security/context-management-threat-model.md`.

## Protected assets

- Source artifacts, rows, documents, annotations, prompts, generated examples, and prepared split contents
- Workspace and organization ownership, artifact identifiers, repository revisions, and lineage
- Provider and model credentials
- Runtime working directories, host paths, logs, and adapter payloads
- Integrity of recipes, effective quality policy, reports, review fingerprints, quarantine lineage, split membership, immutable version digests, publication revisions, counts, destinations, and completed results

## Trust boundaries and controls

| Boundary                             | Primary threats                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Required controls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI to IPC or HTTP                    | forged workspace/task identifiers, oversized body, guessed task reads                                                                                                                                                                                                                                                                                                                                                                                                                                                      | deny-by-default route policy, authenticated principal and organization context, normalized workspace context, bounded requests, opaque not-found denial, no UI-only authorization                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Resumable acquisition task           | dishonest progress, reordered or replayed chunks, whole-file memory pressure, stale checkpoints, cancellation/finalization race                                                                                                                                                                                                                                                                                                                                                                                            | bounded chunk/file/batch totals, per-chunk digest and exact offset, authoritative persisted progress, idempotent last-chunk retry, streaming finalization, optimistic revision, atomic task/snapshot commit, durable 24-hour checkpoint cleanup intent, retained uncertain local-file publication effects without adoption or destructive compensation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Artifact catalog/bindings to staging | cross-workspace reads, unscoped records hidden after apparent success, mutable substitution, traversal, source-type confusion                                                                                                                                                                                                                                                                                                                                                                                              | authoritative task workspace persisted on both catalog record and imported-source binding before success, workspace-scoped port context, contained storage locators, catalog name/media-type reconciliation when byte descriptors omit metadata, immutable provider revisions, early capability guard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Provider retrieval                   | credential disclosure, mutable revision, unsafe payload, unbounded transfer, cross-workspace localization                                                                                                                                                                                                                                                                                                                                                                                                                  | repository port, organization-scoped credentials, explicit revision, bounded localization, authoritative workspace context on binding read/provider retrieval/local object and catalog write/binding update, sanitized failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Artifact preview rendering           | script execution, active HTML/PDF features, dangerous URL schemes, remote tracking content, hostile parser input, oversized renderer work, internal build metadata disclosure                                                                                                                                                                                                                                                                                                                                              | bounded byte/line/character previews, React element construction without raw-HTML injection, conservative Markdown allowlist, raw HTML escaped, only credential-free HTTP(S) links, opener isolation, remote Markdown images omitted, exact pinned PDF.js rasterization of one bounded page with active annotations/XFA/eval disabled, workspace-authorized 10-row Parquet reads, and the internal system-build namespace plus every `+json` filename/media type excluded from user lists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Governed website capture             | SSRF, DNS rebinding, unsafe redirects, credential forwarding, ignored robots policy, recursive crawl, oversized or hostile HTML/XML, fabricated extraction                                                                                                                                                                                                                                                                                                                                                                 | shared secure-egress broker, all-address public DNS checks and redirect revalidation, same-origin sitemap/page redirects, credential stripping, no robots override, explicit page/sitemap scope, zero recursive depth, sequential pages, byte/type/time/redirect limits, immutable raw response plus separate derived text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Runtime working directory            | traversal, stale files, partial outputs, local-path disclosure                                                                                                                                                                                                                                                                                                                                                                                                                                                             | generated contained directory, validated relative output handles, format validation, terminal and cancellation cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Model training review                | guessed run id, cross-workspace status or review action, automatic persistence/publication, staged path disclosure, stale staged output                                                                                                                                                                                                                                                                                                                                                                                      | workspace ownership recorded at start and required for status/cancel/save/discard, generic not-found denial, path-free pending result, explicit save before registration/storage/publication, explicit discard cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Desktop model cache deletion         | corrupted registry path, root or outside-cache deletion, traversal, link escape, incomplete Hugging Face cleanup, registry removal after file-denial                                                                                                                                                                                                                                                                                                                                                                         | typed destructive confirmation, record-derived target, adapter-owned canonical approved roots, strict descendant checks, link/root/traversal denial, whole model cache repository or exact checkpoint deletion, local deletion before registry removal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Cross-page preparation progress      | task-id injection, cross-workspace status disclosure, raw runtime error leakage, fabricated terminal state                                                                                                                                                                                                                                                                                                                                                                                                                 | accepted-start event with validated bounded task id and workspace, workspace-scoped authoritative status reads, fixed/sanitized messages, bounded structured counts, no raw runtime payloads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Parser and generator                 | malformed or oversized input, vulnerable native parser, incomplete model cache falsely marked ready or silently starting network work during preparation, transient download failure deleting resumable data, corrupt or policy-escaping cache retention, missing or substituted model-placement dependency, infrastructure errors hidden by a broad skip policy, invalid model output entering training rows, indirect prompt injection, task/schema substitution, prompt/content leakage, arbitrary exception disclosure | file/row/chunk bounds, exact patched PyArrow and reviewed Accelerate pins with startup probes, local-only complete configuration/weight-shard/tokenizer readiness validation, incomplete-cache acquisition restricted to the explicit resumable download task, three bounded transfer/validation attempts, partial-cache preservation for ordinary retryable failures, cleanup on containment or configured byte/file-bound failure, separate sanitized interrupted/invalid-snapshot codes, rate-limited structured progress with stderr rendering suppressed, fail-closed generation dependency preflight, explicit skip policy may reject and warn one source section after bounded output correction while zero-valid-example runs fail, model-cache/load/decoder/inference/dependency/resource/runtime failures remain fail-fast, separate trusted system and untrusted data roles, task-bound strict JSON envelopes, exact-field/allowlist/source-span validation, fail-closed row parsing, no raw exception/source/prompt/output logging |
| Token-constrained decoder            | schema substitution, unsupported or recursive schema, native dependency compromise, unbounded compilation/cache, tokenizer mismatch, dead end, truncation, silent unconstrained fallback, sensitive exception disclosure                                                                                                                                                                                                                                                                                                   | compiler-owned exact schema, strict schema subset and size/depth/node/property/choice bounds, exact conditional dependency pins, truthful capability advertisement, model-local bounded LRU, processor reset, accepting EOS requirement, at most one same-mode correction attempt with no checked-mode fallback, sanitized stable codes, mandatory post-validation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Source attribution enrichment        | model-invented attribution, lineage substitution, credential-bearing URL disclosure, oversized metadata, attribution appearing when not selected                                                                                                                                                                                                                                                                                                                                                                           | separate explicit quality-policy choice, locked UI companion fields, post-validation trusted-source enrichment, authoritative artifact id, bounded allowlisted text, HTTP(S)-only public URL with credentials/query/fragment removed, absent companion object when unselected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Split stage                          | duplicate or source leakage, fabricated counts, nondeterminism                                                                                                                                                                                                                                                                                                                                                                                                                                                             | deterministic component partitioning, source/group and exact-content isolation, physical outputs, count invariants                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Quality policy and curation          | permissive fallback, unbounded duplicate work, hidden row loss, sensitive review samples                                                                                                                                                                                                                                                                                                                                                                                                                                   | host-owned fail-closed policy resolution, mandatory controls, bounded candidate checks, reversible quarantine, count invariants, sanitized bounded samples                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Advanced processing and generation   | fabricated OCR or capability readiness, unbounded pair comparison, source-free generated content, single-pass self-approval, sensitive embeddings or examples in evidence                                                                                                                                                                                                                                                                                                                                                  | explicit capability status and fail-closed denial, bounded local comparison, exact normalized-span citations, independent schema/grounding/critic/safety/diversity verification, mandatory quarantine and approval, aggregate-only evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Adaptive task recipe                 | renderer-selected incompatible method, optimistic total-memory recommendation under current memory pressure, unbounded disk/swap pressure, shared-host utilization disclosure, ignored controls, mixed source roles, unsafe legacy migration, misleading image inspection claims                                                                                                                                                                                                                                           | contract-owned task/source resolution, sanitized available-memory facts in desktop and server, installed-memory reserve only when that fact is absent, ordered 7B/3B/1.5B fallback for untouched choices, explicit/saved choice preservation, closed 0/1/4 GiB CPU-overflow policy, mandatory worker live-memory preflight, CUDA overflow denial, application and worker reconciliation, inactive-field rejection, deterministic safe migration, exact inspected-surface evidence, explicit unavailable pixel/OCR/face capabilities                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Long-running runtime task            | premature model-download failure, semantic over-fragmentation causing excessive inference, opaque first-batch model loading, unbounded worker occupation, cancellation of unrelated work                                                                                                                                                                                                                                                                                                                                   | central task-class deadlines, twelve-hour model-download and twenty-four-hour training caps, minimum semantic section size plus maximum token/span limits, explicit global loading-model phase followed by bounded section progress, task-scoped cancellation, terminal cleanup, no renderer-controlled unlimited timeout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Review and approval                  | guessed task, stale or replayed approval, altered report, cross-workspace row disclosure, oversized or malicious row values, blocked dataset admission                                                                                                                                                                                                                                                                                                                                                                     | recorded workspace/organization/principal scope, validated effective policy/report, timing-safe exact fingerprint comparison, fixed 10-row pages, bounded stream/line/value/depth/field limits, prototype-key removal, one-time pending state, explicit whole-ready-set approval, application-owned approvalAllowed denial                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Materialization/publication          | wrong destination, path-like user save name, partial or unverifiable result, cross-workspace output                                                                                                                                                                                                                                                                                                                                                                                                                        | withhold final outputs before approval, validate and bound the optional filename-like save name at UI and application boundaries, explicit destination, workspace metadata/context, result validation, partial-write compensation, later version-level atomicity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Dataset version persistence          | partial visibility, mutable substitution, malformed or oversized metadata, cross-scope reads                                                                                                                                                                                                                                                                                                                                                                                                                               | artifact-first/record-last visibility, exact SHA-256 references, bounded schema validation, insert-only idempotency, organization partition, workspace-qualified key, and application workspace authorization on history/comparison/reproduction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Publication evidence                 | publication against a missing or substituted version, mutable destination inference, accidental public access, credential disclosure                                                                                                                                                                                                                                                                                                                                                                                       | require an existing exact version, authorize exact workspace/provider scopes, verify every artifact digest, private default, separate public confirmation, bounded one-commit publication, append-only immutable revision evidence, adapter-owned credentials, no provider payload persistence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Status and cancellation              | guessed request id, cross-workspace or cross-organization observation or cancellation, retained review files                                                                                                                                                                                                                                                                                                                                                                                                               | workspace and optional organization ownership recorded at start and checked on every read/approve/cancel, generic not-found response, evidence and runtime cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Source snapshot and refresh history  | mutable source substitution, missing change event, partial task/lineage visibility, stale validator trust                                                                                                                                                                                                                                                                                                                                                                                                                  | immutable content digests or exact provider revisions, bounded validators, atomic task/snapshot and changed-refresh/snapshot transactions, append-only refresh outcomes, workspace/organization partitioning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Abuse and failure cases

- Missing, malformed, unsupported, deeply nested, oversized, or over-row-limit input fails before unbounded work.
- Empty, oversized, out-of-order, stale-offset, digest-mismatched, or over-count acquisition chunks fail before task progress advances. A repeated last accepted chunk succeeds only when its size and digest are identical.
- A guessed task or source identifier in another workspace or organization returns no record and cannot observe, resume, refresh, cancel, or clean the target.
- Website URLs containing credentials, local names, private/reserved addresses, unsafe redirects, cross-origin sitemap entries, disallowed robots rules, nested sitemap indexes, unsupported media types, or over-limit bodies fail closed.
- A cancellation that wins the final commit cannot create a source snapshot; raw and derived artifacts written by the losing operation are compensating-deleted.
- A source registered in one workspace cannot be prepared, observed, or
  cancelled through another workspace context; managed tasks also require their
  recorded organization context.
- A remote-only source without a usable immutable backing fails with a corrective action; it is not silently replaced by a mutable default revision.
- Provider namespace and file-list reads remain bounded and adapter-owned.
  Checkbox selection is not authorization, selected files retain only the
  adapter-returned immutable revision, and provider browse failures cannot
  expose credentials, provider payloads, or local paths in the UI.
- A provider namespace such as `OpenFinAL` remains source provenance and cannot
  select or replace the application's organization. The host injects the
  authoritative active organization and principal into acquisition commands;
  missing or conflicting context fails before a task record is written.
- A provider task cannot report success for an unscoped catalog or backing
  write. Both records retain the authoritative task workspace, and normal
  workspace-filtered Artifact Browser reads remain fail-closed.
- Provider localization cannot read a binding, retrieve bytes, write the local
  object/catalog record, or update source and primary bindings without the same
  authoritative workspace context. Missing scope fails before provider access.
- The Step 2 token card updates the existing host-owned Hugging Face credential
  setting only. The raw token is accepted through a password field, is never
  placed in an acquisition command or public diagnostic, and remains subject to
  the existing credential-store and route authorization controls.
- A successful acquisition opens only the existing bounded task activity before
  clearing renderer form selections. Failure and cancellation retain retry
  state, and the form reset neither exposes nor clears the host-owned provider
  credential.
- Runtime output handles containing absolute paths or traversal are rejected.
- A `Convert to RAG database` navigation handoff carries only an artifact
  identifier and is not authorization. Context Management repeats the
  authenticated workspace read, shared capability check, digest verification,
  and contained staging. Chunk boundaries are trusted as already processed
  only when every row has valid chunk index and source lineage metadata.
- A missing quality-policy provider, malformed report, policy mismatch, blocked report, wrong-scope approval, stale fingerprint, or replayed approval fails closed.
- Aggregate review reads expose bounded sanitized summaries and descriptors.
  Exact report-line row reads are separately authorized, fixed to 10 rows,
  bounded by file/line/value/depth/field limits, and bound to the recorded task
  scope plus report fingerprint. They never expose runtime paths or copy row
  values into diagnostics or structured persistence.
- A requested split with insufficient independent groups preserves isolation and reports a bounded warning.
- An unavailable advanced capability, including scanned-image text recognition,
  fails before processing or presents a corrective action; it is never reported
  as completed.
- An explicit dataset-preparation start may ask the host-owned Python supervisor
  to start, but the execution guard re-reads capability readiness afterward and
  fails closed before task creation unless it is ready. Passive readiness and
  task reads never start the runtime, and startup failures expose only bounded
  capability codes and corrective actions.
- An adaptive recipe whose intent, method, source kind, generation mode, or
  active controls contradict the actual staged inputs and exact task fails in
  both the application and worker boundaries. Ambiguous legacy recipes are not
  silently migrated.
- Image checks report metadata and annotation coverage separately from pixels.
  They cannot claim pixel-level personal-data, credential, face, or OCR checks
  when no reviewed visual inspection capability ran.
- Semantic comparisons are capped and run before split assignment. Reports may
  contain aggregate scores and bounded artifact/row lineage pairs but never row
  text or embedding vectors.
- Generated examples that lack the required task schema, exact source citation,
  source support, critic acceptance, diversity, or safety acceptance enter
  reversible quarantine. A generator cannot approve its own output and no
  generated candidate bypasses mandatory human review.
- Source content or metadata that asks the model to ignore task rules remains
  untrusted data. A mismatched task/version, unexpected field, invalid JSON,
  oversized value, unknown configured label, or non-source passage fails before
  row materialization; diagnostics expose only bounded counts and error classes,
  never the source, prompt, or generated response.
- User-authored output layouts and sample values are untrusted configuration.
  The host accepts only bounded visual fields, built-in value kinds, and
  schema-valid sample values; it rejects unsafe or runtime-owned names,
  duplicate identities, excessive depth/count/choices, missing or duplicated
  task purposes, incompatible purpose types, and nested CSV before generation.
  Labels come only from the Step 1 allowlist. Users cannot supply raw schema
  keywords, references, executable validators, or envelope substitutions.
- Attribution is never accepted from model output. When selected, the worker
  adds it only after candidate validation from the selected source record,
  bounds every field, removes URL credentials, query, and fragment, and rejects
  non-public URL schemes. When unselected, no attribution companion is added.
- Prompting, constrained decoding, validation, and row mapping consume the same
  deterministically compiled schema, schema-valid example, and protected purpose
  paths under one fingerprint. Runtime-owned system rules require exactly one
  JSON object and reject prose, unrequested reasoning, or other pre/post output.
  Unchecked compatibility parsing may remove exactly one complete `json`
  fence around one bounded object, then applies the same exact schema and
  semantic validation; partial fences, multiple blocks, and surrounding text
  fail closed. A bounded dynamic extraction record can use
  prompt-guided validation but cannot be advertised as token-constrained until
  explicit fields make its shape exact.
- New instruction-tuning layouts keep the user Input separate from Context. The
  schema fixes Instruction to the user-configured behavior text. Context is
  omitted from the model generation contract and attached unchanged from the
  current untrusted source section before final schema validation, preventing
  model-authored behavioral instructions or supporting evidence. Optional
  text-only Thought remains a distinct training field.
  Legacy saved layouts without Context retain their prior exact-span Input
  validation instead of receiving a weaker compatibility fallback.
- Checked constrained generation cannot be accepted merely because the decoder
  package imports. The worker advertises the capability only for the reviewed
  Python and exact-package range; schema compilation, processor attachment,
  accepting EOS, parsing, and exact validation must all succeed in the same
  attempt. A recoverable failure may invoke one correction attempt with the
  same schema and constraints; failure never invokes an unconstrained retry.
  Grammar serialization preserves the intended field order without weakening
  the order-independent integrity fingerprint. Conditional object lowering is
  limited to required distinct string discriminators and exact known property
  subsets, retaining all other root constraints in each complete branch.
  Combined original/expanded schema and cache budgets apply without increases;
  unsupported or over-budget forms retain the original constraint. Original
  final validation remains authoritative. Built-in bounded label choices follow
  the configured task policy; old saved schemas retain their identity.
  The pinned backend default whitespace policy is retained. A compact-formatting
  experiment passed lexical checks but failed actual model quality and was
  withdrawn; semantic model outcomes require separate verification. Original
  string values, validation and byte/cache limits remain enforced. Callers
  cannot supply a regex or request a weaker fallback.
  Prompt schema/sample serialization preserves existing sorted canonical
  presentation, exact values and source-data quoting; an experimental ordering
  change was withdrawn after real quality regression. Grammar representation
  never replaces the original sorted integrity fingerprint or final validation.
  Windows uses the pinned
  Outlines kernel's eager callable to avoid an optional compiler probe and
  retains the same token mask and mandatory post-validation. Desktop startup uses
  only fixed bounded version probes to prefer an installed decoder-compatible
  Python when the operator did not configure one; explicit configuration wins,
  and the UI disables the control whenever authoritative capability remains
  unavailable.
- Model training accepts recorded purpose paths only with a valid exact schema
  fingerprint and rejects selected datasets whose mappings or fingerprints do
  not match before model loading.
- Train Model candidate browsing requires the active workspace context and
  recognizes Parquet from bounded catalog metadata without treating display
  names or renderer selection as ownership evidence. Missing scope performs no
  browse, and the application still authorizes and validates every selected
  artifact before reading bytes or loading a model.
- Dataset preparation reuses the exact fingerprint-validated purpose paths for
  generation, quality admission, report mapping, and output. Custom field names
  are never reinterpreted through legacy defaults; synthetic and semantic
  quarantine findings remain denial reasons without masquerading as mapping
  failures.
- Dataset generation estimates physical model-weight memory before construction.
  Its closed overflow policy permits 0, 1 GiB, or 4 GiB of system-managed
  disk/swap pressure for CPU/automatic placement and rejects larger shortfalls;
  CUDA-only placement never receives this allowance. Desktop defaults to the
  1 GiB choice, while an omitted policy fails closed to memory-only. The renderer
  cannot supply arbitrary limits. Actual overflow emits bounded task progress and
  a deduplicated slowdown warning without paths or host identity. Both hosts use a sanitized current available-memory fact for untouched defaults;
  only a missing fact permits the installed-memory reserve. A reported zero
  remains zero. Neither path can override an explicit or saved model.
- Parser, provider, and model failures cannot place raw content, prompts, model output, credentials, provider payloads, or local paths into public errors or logs.
- Cancellation and terminal reads clean staged runtime files; cleanup failure must not broaden access.
- A dataset-version identifier cannot be reused with different normalized
  content, publication cannot be recorded for a missing version, and a malformed
  stored record fails closed.
- Version and publication records contain bounded metadata and logical artifact
  references only; source rows, prompts, credentials, raw reports, provider
  payloads, and host paths are excluded.
- History, comparison, and reproduction return no version data when workspace
  membership or required read scope is absent. Reproduction verifies the
  recipe bytes against the persisted digest before returning bounded settings.
- Dataset row review requires authenticated workspace read or write scope,
  accepts only locally readable cataloged or exact version-bound Parquet
  artifacts, and limits
  each response to 10, 25, or 50 rows. Rejection and editing bind the selected
  version, artifact key, row index, and canonical SHA-256 row fingerprint;
  stale, cross-workspace, mismatched-version, malformed, invalid-schema, or
  last-row rejection requests fail before version visibility. Edited values
  are bounded and type-checked by the Parquet schema. Runtime paths and row
  values never enter version records, public errors, or diagnostics.
  Rows whose complete JSON-compatible values do not fit the edit boundary are
  marked read-only so a truncated preview can never overwrite source data.
- Repository-only or stale catalog records are excluded from Dataset Review
  until localization establishes readable workspace-owned bytes. A storage
  disappearance after listing still fails with a bounded corrective error.
- Revised Parquet bytes use artifact-first, record-last finalization. Failure
  compensates newly stored content where possible and never mutates or deletes
  the parent version. The worker resolves both input and output beneath its
  private temporary directory and removes that directory on every terminal
  adapter path.
- Accepted generated rows used for pre-approval preview are copied from the
  runtime directory into workspace-scoped temporary artifact storage. Every
  read verifies the recorded SHA-256 digest, cross-workspace reads fail before
  retrieval, and approval, cancellation, or discard deletes the preview copy.

## Residual risk

Automated schema, language, duplicate, semantic similarity, source-support,
critic, diversity, personal-data, credential, safety, license, consent, benchmark,
robots parsing, and readable-text extraction can produce false positives or
false negatives; human approval does not replace organizational policy or legal
review. The deterministic hashed-token semantic method and grounding critic are
bounded safeguards, not claims of human-level meaning or factuality. Artifact
storage and structured persistence are not one distributed transaction, so
compensation can still require operator attention if the storage deletion
adapter itself fails. Live PostgreSQL contention, controlled ingestion scale,
representative website behavior, private-provider access, controlled local-model
hardware, accessibility/reduced-motion behavior, and controlled provider
publication remain required qualification evidence. Long-running model downloads
and training can occupy bounded worker capacity until cancellation or their hard
deadline; deployment monitoring still needs to account for that controlled
resource use. The decoder's native processor memory cannot be measured exactly
from canonical schema bytes; schema complexity, retained schema bytes, and cache
entry count therefore provide hard indirect bounds, while representative CPU and
accelerator memory/latency qualification remains required.


## Dataset source staging authority

Preparation reads bindings with the authoritative workspace and request context,
verifies every returned artifact/workspace identity, and rejects absent or
conflicting bindings before object reads, provider retrieval or task start.
An artifact id is never an unbound local storage key. A remote-only binding goes
directly through authorized provider localization; localization allocates a new
opaque storage key with overwrite disabled and persists that returned key in the
same workspace binding. Equal logical source ids in two workspaces cannot replace
one another's localized objects. Original file metadata uses the storage adapter's
`originalFileName` field so supported formats remain usable. Rollback keeps these
checks or disables staging; it cannot restore guessed-key fallback.

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

## Optional offload delta

The explicit `offload-v1` mode adds a settings-to-worker resource boundary and
private host-cache staging. Default Standard behavior and existing workspace/task
authority remain. An exact versioned capability check precedes staging/start;
unknown or malformed saved profiles cannot downgrade silently. Native Qwen2
configuration, safe-weight indexes/offsets/shapes, tokenizer paths/classes and the
inspected bounded chat template are checked before supplier loading. Parsed bytes
are bound to full-file digests; source rebind/drift denies cached reuse/forward.
Adapter configuration and weight-name families are rejected case-insensitively
before supplier reads: native model classes can otherwise discover installed
PEFT support and redirect the base path despite explicit local-only configuration.
No remote code, pickle, network, implicit overflow or precision fallback is used.

Placement is not a process-memory or disk quota. Separate admission covers
loading source/conversion transients, execution/KV/prefill/runtime headroom and
finite owned staging. Specific insufficient-resource failures retain bounded numeric
observations without prompts, outputs or paths. An unstarted forward retains
safe retry ownership. One exclusive slot, cached-input leases, serialized request
views, native task-admission/unload fencing, weak-reference release and recorded
per-file cleanup progress preserve ownership through load/OOM/decoder/deletion
failures. Stale or foreign slots and recreated files are retained and denied,
not adopted or recursively deleted. Queued cancellation and unsupported running
Dataset Preparation cancellation remain truthful; the shared worker is not killed.

Focused failure-path/UI evidence is local control evidence. Actual installed-model
resource/quality qualification, native parent-substitution/ACL recovery and other
hardware profiles remain distinct; cooperative identity/hash observations do not
prove native immutability. Rollback withdraws only optional support and retains
stronger loading/ownership/cleanup controls and failed evidence. The exact support
and prospective measurement protocol are in
`docs/operations/optional-low-memory-inference.md`.

Composed-host tests exposed fresh uploaded catalog entries without the explicit
local binding now required by source staging. Desktop/server storage composition
therefore injects a binding writer at the verified write origin for newly generated
workspace upload keys only. Workspace/catalog presence is checked before I/O;
no-overwrite creation precedes the primary binding and catalog success. Persisted
binding/catalog identity must be absent before publication and again before
binding; metadata-only collisions deny. Key/workspace/overwrite snapshots cannot
be changed by an asynchronous producer. Distinct conditional metadata operations
repeat absence checks inside their owning revision CAS and preserve competing
records; JSON compatibility refuses those operations. No unassigned organization
is invented. Failed
binding persistence fails closed. Explicit keys and existing missing/foreign
bindings are not adopted, and preparation retains its pre-I/O denial. Failed
or uncertain metadata acknowledgement can retain unregistered owned bytes; the operation reports
failure and does not delete another file. This is not an atomic publication or a
replacement for pending native ACL/reparse qualification. Rollback preserves the
missing-binding denial even if upload availability is reduced.

## Ingestion commit acknowledgement uncertainty

Security impact: security-relevant data-loss and recovery authority. Uploaded-file
and provider task finalization previously attempted artifact deletion when the
task/snapshot transaction threw, even if it had committed. Those error paths now
retain the returned artifact. Exact readback verifies original owner/workspace,
task identity/kind/definition, monotonic revision, complete finalized file/output,
source/snapshot IDs, key, size, media, digest/provider revision and locator. A new
commit additionally compares the complete normalized original snapshot. Existing
later task progress cannot substitute a different file/output. Unknown or foreign
readback has no adoption, compensation or success fallback. Errors remain bounded.

Completed retries validate the requested digest and existing snapshot relationship
before any checkpoint effect. Succeeded tasks are immutable; failed/cancelled task
states cannot be revived by cleanup. Exact cleanup-completion commit readback can
reconcile lost acknowledgement. An explicit cancellation winning finalization
remains cancellation and does not authorize artifact deletion.

Real disposable upload/checkpoint and structured repository tests cover prior
failure reproduction, commit-then-throw, unavailable/uncommitted/foreign/changed
readback, missing/changed snapshots, retained physical bytes, explicit cancellation,
cleanup failure/retry, immutable success and fake-provider acknowledgement loss.
No provider/network/model request is made. Rollback preserves non-destructive
uncertainty and immutable succeeded state.

The resumable file publisher now owns a private bounded intent: reserved, writing,
bytes-acknowledged, origin-issued, origin-complete and committed. Checkpoint inspection rejects
invalid content before reservation; a corrected checksum can resume safely.
Only the exact returned writing CAS permits one opaque no-overwrite target. The
dedicated writer validates digest/size before final linking, copies chunks before
hash/write awaits, and never deletes a published candidate. Lost writing or byte
acknowledgement retains ambiguity; it cannot authorize a retry or fresh candidate.

Only the exact successful origin-issued CAS acknowledgement after durable bytes
permits one conditional binding/catalog attempt. Lost issuance acknowledgement
grants no creation authority. Retries verify complete exact existing origin only;
missing, partial or deleted metadata is never recreated. This includes actual
registered deletion, whose adapters physically remove rows rather than retaining
tombstones. Synthetic tombstone denial does not substitute for that regression.
Complete exact readback reconciles metadata acknowledgements. Substituted origins deny.
The task/source transaction requires the exact origin-complete private record,
matching document revision, immutable owner/checkpoint/output tuple and capture
time, then commits all three records. Generic task saves cannot finalize local
files, and finalized outputs cannot change. Completed retry only verifies its
committed private receipt and origin; it never repairs a missing legacy receipt.
Preparation metadata reads include workspace/key and reject foreign returned data.

Actual disposable-byte, CAS concurrency, metadata fault/tombstone/substitution and
composed desktop Add data-to-staging tests cover these controls. The latter uses
a fake runtime and supplies no generation or full UI qualification. Residuals
remain for content after publication, filesystem/metadata atomicity, protected
crash recovery, unknown-byte cleanup, hostile native races and parent closure.
Legacy/missing bindings remain denied. Website acquisition retains its separate
owner, compensating cleanup and qualification boundary.

## Opt-in private-provider restart qualification

The contributor-only private-provider operator retains synthetic version and
publication metadata in a fresh exclusively allocated UUID run using the
production SQLite adapter. Artifact bytes and credentials are not stored in this
database. Existing human authorization for the exact private provider destination
remains mandatory; neither configuration nor a replay record supplies authority.
Existing bounded Hub transport, secure download egress, private visibility,
immutable revisions, no remote deletion and credential redaction remain intact.

After the first database connection closes, a fixed new Node child reopens only
that run. Admission checks a bounded ownership marker and nonce, strict run IDs,
contained nonlinked directories, the exact database file inventory and 1 MiB
per-file limits. The child has fixed source/argv, bounded secret-free input,
4 KiB per output stream and a 20-second parent timeout. Explicit inert Windows
identity/PATH settings prevent automatic ambient inheritance. No provider adapter
or credential store is loaded by the child. Artifact and publisher calls refuse;
successful replay requires both call counts to stay zero, the same version digest
and revision, one publication record, actual database close and actual child exit.
Failure paths use fixed safe codes and retain the small synthetic metadata.

Focused real SQLite/new-process tests cover successful reuse, saved-version
preservation after provider failure, later retry, changed ownership, excess bytes,
unexpected files, links, malformed input and secret non-inheritance. These are
cooperative contributor checks. They do not prove hostile native check/use race
protection, app-wide crash recovery, mounted UI, provider page rendering, retained
offload staging, protected accounting or whole-roadmap qualification.

## Memory-denial diagnostic delta

Notification history is a public diagnostic sink. On the exact
`generation_insufficient_resources` code, the worker/transport/UI allowlist only
the RAM/VRAM/combined resource enum and nonnegative safe-integer required,
available and permitted-overflow byte counts, bounded to 1 PiB. Reject
contradictory/nonfinite facts and VRAM overflow; discard unrelated fields.
Only fixed copy and those numeric facts reach memory notifications. Unknown
measurements do not invent an amount. The existing model-admission decision,
workspace authority, runtime/source containment, resource limits and retained
offload ownership are unchanged. Automated denial, numeric-bound, private-field
non-disclosure and two-host notification tests cover this delta. Native staging
protection and actual optional offload qualification retain their separate gaps.

## Admission and saved-profile failure handling

A Dataset POST can have taken effect before its response is delivered. The runtime
foundation retains bounded private ownership before dispatch and after transport,
parse or identity uncertainty. No automatic sibling cancellation/deadline or
model-download recovery may stop that protected worker. A shared recovery fence
also rejects new dispatch during stop/start and after unconfirmed recovery failure.
Exact task/type/generation observations and actual owned exit govern release;
contradictory cancellation, unknown status and late acknowledgements cannot erase
or resurrect ownership. Deterministic deferred-response and fake-child tests cover
these timelines without accessing retained offload staging or claiming native proof.

Saved-version reuse validates the memory mode before any form setters. Unsupported
profiles produce fixed validation and leave the visible original setup unchanged,
without dispatch. Explicit valid profiles and omitted legacy Standard remain
supported; invalid mode input never silently substitutes an earlier selection.


## Lazy constrained-decoder token masks

Security-relevant: native parsing and dependency execution protect worker
availability, exact output intent and qualification integrity. Compiler-owned
bounded schemas and already admitted local tokenizers cross into a native
matcher; generated text remains untrusted until the original schema validates.
The eager Core all-state token index exhausted memory on an ordinary instruction
layout. Replace only that private index with bounded reached-state matching.
Preserve the original regex, whitespace, token projection and EOS-alias removal;
disable forced canonical tokenization. Reject excessive IDs, sparse extremes,
projected bytes before native tokenizer construction. Bound regex input before
conversion, generated grammar before matcher construction, and batch count
before per-row matcher copies.
Enforce wheel-only installation for the exact optional native pin. Use explicit
parser limits, silent native logging, nonverbose errors, checked
constructor/consume/mask results, healthy accepting EOS and fixed public errors.
Mask holes, aliases and padded score positions. Use safe owned byte masks and
eager Torch operations; never import the compiled native mask kernels.

Verification includes malformed/oversized vocabulary and grammar denial,
native error/consume/mask failure, reset/cache isolation, invalid prefixes,
EOS and empty finite-score denial, full-token comparisons for small layouts,
and the original full instruction tokenizer-only case with observed owned-child
memory/exit. These controls bound complexity, not physical process memory.
Model admission, final validation and fail-closed behavior remain required.
No provider authority, credential access, retained staging, offload lease,
restricted Assets review or accepted model-accuracy rerun is authorized here.
Actual model/native/GPU/parent qualification remains separate.

## Closed owned-worker lifetime fixture

Security impact: security-relevant process ownership and qualification integrity.
The control-plane qualification helper creates only its own fixed model-free
Python worker and descendant. An unnamed noninheritable kill-on-close job uses
creation-time job-list assignment; no post-creation assignment crash window or
breakaway permission is allowed. Exact limits and pre-resume membership are read
back. Native job members and minimal read-only duplicated process handles prove
exit across normal and forced guardian shutdown. No caller command, existing
process action, privilege change, protected payload or ambient credentials cross
this boundary. IPC, process count, commit and observation time are bounded.
The supervisor pulls handles from the exact Popen-created guardian into its own
process and records each duplicate before verification; no remote target or
parent PID lookup exists. Failed thread closure preserves ownership. A shared
strict exit-code/count oracle rejects natural expiry and errors; an actual fixed
expiry negative control tests that rejection through the same native handle.

Admission, native API, identity, protocol and cleanup uncertainty grant no pass
or release. The fixture supplies no retained-tree protection, durable accounting,
actual offload-worker integration or malicious same-user isolation. It never
accesses retained staging, changes the unknown 12 GiB charge, reopens accepted
accuracy or conducts the restricted Assets assessment. Physical evidence is
explicitly opt-in; a skip is not qualification or a parent roadmap pass.

## Selected-file ambiguity and real host qualification

Use the contract normalizer's filename for both uniqueness and transfer lookup.
Leading/trailing spaces are removed by that contract; comparing raw File names
would allow a collision and could select the first source twice. Normalize the
whole selection, reject duplicate canonical name/size pairs before create/resume,
and select original bytes by that exact map. Reject ambiguous saved task entries
before transfer. No independent UI filename-normalization policy is introduced.

Security impact: security-relevant source integrity and bounded evidence. The
shared Add data panel matches task files by name and size during transfer/resume.
Reject duplicate pairs before any task creation, byte read or host mutation,
including pairs with different modification times. Keep the user's selection
and provide a fixed rename-and-select correction. Distinct sizes remain valid.
This prevents choosing the first file twice and silently importing the wrong
source. Server checks, checksum verification, acknowledged publication and
workspace/organization authorization still apply independently.

Model-free real desktop/browser journeys use only isolated synthetic files and
production IPC/HTTP controls. They observe numeric slice sizes and progress;
whole-file reads, ambiguous admission, missing outputs and failed source discovery
cannot pass. Bearer-bearing traces, screenshots and video are disabled. No saved
credential, provider request, model or retained staging is needed. These checks
are not protected native/crash, real provider, whole-process memory or parent
qualification; they never reopen accepted model accuracy.

The separately admitted exact `POST /api/ingestion/tasks/execute` uses existing
`artifact:write` coarse scope for every action, including read/list. It does not
infer ownership from the request body. Normal authentication and dedicated-tenant
checks run before JSON parsing; application authorization repeats the active
organization, workspace and exact task/file checks before effects. Missing or
invalid credentials, reader-only scope and another organization cannot reach
parsing or acquisition. A task from another workspace stays not found. Malformed
commands cannot run an effect. Unknown paths/methods and other unsupported API
families remain denied. Real HTTP tests use synthetic token verification and
real composed local publication; the host UI separately uses its generated
device credential. These tests supply no broader route, provider or native pass.
Rollback denies this route and retains the application's authority checks.

The server composes ingestion only with organization-scoped documents and an
authoritative context provider. An injected scoped store receives the same
authenticated request context as PostgreSQL storage. A store name or body field
cannot supply authority. Missing context returns unavailable before acquisition;
organization mismatch remains denied. Unscoped stores never become a fallback.

## Replaceable OCR request and result contract

The approved Windows provider direction is documented in
[ADR-0046](../adr/ADR-0046-replaceable-local-document-ocr.md). This first boundary
is pure managed-runtime data validation; it adds no process, file, model,
language-pack, credential or network operation and does not advertise readiness.

Protected assets are source content and identity, original page lineage, resource
availability and safe diagnostics. Inputs and provider results can be oversized,
mutable, duplicated, swapped, malformed, non-finite or instruction-bearing.
Immutable bytes/tuples and frozen records, exact digest/provider/version/language/
page matching, strictly ordered original pages, finite contained rectangles,
per-page pixel limits and aggregate line/text limits fail closed. Booleans are
not accepted as numeric dimensions or page numbers. Recognized line control and
surrogate characters are rejected; content is not copied into error messages or
representations. Empty recognition remains empty and no confidence is fabricated.

Application workspace/source authorization is still required before a provider
call. Text remains untrusted data when later consumed by generation. These
portable checks do not qualify a Windows parser, native isolation, trusted helper
identity, timeouts, cancellation, cleanup, model quality or host UI. Those controls
and measured failure paths remain required before enabling actual OCR. No cloud
fallback, arbitrary executable/path or supplier download is authorized here.

## Private OCR helper framing and recognition source

Protected content crosses only a length-prefixed private byte stream. The
Python codec enforces the response byte cap before JSON parsing; duplicate keys,
unknown fields, invalid UTF-8, type confusion, non-finite coordinates and global
line/text overflow fail with one fixed error. Parsed records alone grant no
source authorization: exact source/provider/language/page binding remains
mandatory. Recognized content stays data and is excluded from error text.

Windows helper source accepts bounded source bytes, never caller paths or URLs.
It checks that the actual engine language tag exactly matches the requested
installed canonical tag, refusing Windows resolution substitutions or aliases.
It never downloads a language; caps original PDF page
count/selected pages, raster dimensions and decoded pixel product before native
bitmap extraction/rendering; limits global lines and Unicode scalar text; and
refuses overflow instead of truncating. Output is one bounded versioned response
with source digest and rendered pixel-page geometry, without invented confidence.
Helper code emits no exception or diagnostic payload; a future native owner must
also discard/bound system diagnostics. Its managed input/work wait is finite.

Compilation proves source compatibility only. Native allocation/memory, pipe
retirement, creation-time Job ownership, deadline/cancellation, trusted compiled
resource identity and crash cleanup remain unqualified. No helper launch or
product OCR availability follows from this component. Actual malformed-image,
scanned-PDF, native denial/failure and product/UI checks remain pending; existing
source authorization, accepted model accuracy and retained offload data stay
unchanged. This helper is not a sandbox against a hostile same-user deployment.

## Bounded native OCR process and resource lease

The runtime's private Windows owner protects source privacy, executable identity,
resource availability and ownership. It accepts only a fixed resource; requests
cannot select commands, paths, environments or services. A bounded trusted-build
manifest binds current source and x64 binary bytes. Native file/ancestor leases
reject reparse points and deny file write/delete and ancestor deletion through
retirement. This detects stale/substituted resources within a trusted installation;
it is not a signature, AppContainer, network sandbox or defense against a party
who can rewrite the installed application or its build metadata. No process or
file authority crosses into application/domain modules.

Directory leases require list-directory plus read-attributes access, without
enumerating entries. Attribute-only handles proved insufficient for Windows
delete-sharing denial in the new synthetic resource test. This protects the
named ancestor identity; it is not a child-creation fence or retained-tree proof.

Creation-time JobList membership, suspended start and exact native limit readback
precede resume. The one-member job and process each cap commit at 512 MiB; only
three stdio handles are inherited. The job handle and runtime secrets are not
inherited. Input/result use bounded private pipes. Stderr is counted/discarded;
any stderr, overflow, I/O failure, nonzero exit or observed native limit denies
success. A finite 120-second parent deadline and cancellation terminate only this
new owned Job. The helper's own 110-second wait is not used as cleanup proof.
The parent requires a signalled native root, zero active members, stopped pipe
threads and acknowledged native closes. False or raised close results retain
exact handles/owners and deny successors. The qualification operator likewise
retains failed guardian/observer ownership and stops after a failed test.

Actual new-owned native failure/crash evidence is separate from portable protocol
checks. The read-only crash observer duplicates a process handle, never a Job
handle; kill-on-last-owner-close must end the newly created helper. Neither this
component nor its tests inspect or change unknown retained offload trees, repeat
accepted model accuracy, qualify legacy restricted Assets or enable OCR. Trusted
packaging, actual document recognition/lineage, provider/readiness and host UI
integration remain required. Ordinary Canvas startup does not probe this engine.

## OCR provider exchange binding

The concrete adapter protects source/page identity and private content across
two separately retired exchanges: fresh exact-language readiness, then bounded
recognition. The parsed document must match immutable authorized source bytes,
selected original pages and the actual ready provider/version/language. No ready
cache, provider fallback, path/command selector or language download is permitted.
Absent resources return fixed unavailable reasons; corrupted responses fail the
contract. Cancellation and unsafe retirement remain failures and never produce
partial documents. Existing native resource/process limits remain in force.

Synthetic local document checks cover actual image/PDF content and denial paths,
without private sources, credentials, models or retained files. Fixture Pillow
and Arial are qualification tools, not runtime provider dependencies. Packaging,
normalization, source authorization and actual host delivery remain required;
this component does not advertise OCR or qualify the parent roadmap.

## Trusted OCR build inputs and publication

The build protects source/executable integrity, private environment and resource
availability. Only fixed repository helper source, builder and hook, the installed
compiler and literal SDK/framework references are accepted. Native file/ancestor
leases reject redirects and deny file write/delete sharing. Only those fixed
system toolchain files allow servicing hard links; repository/runtime single-link
guards remain strict. Each installed file is at most 64 MiB, all inputs 128 MiB.

The builder copies pinned source into a fresh ignored UUID directory. Its compiler
environment contains only OS directory values and new private temporary paths.
There is no shell, caller-selected command/source/flag, credential forwarding or
download. The trusted compiler is limited to 120 seconds and 64 KiB saved output
per stream; any stderr, overflow, failure or uncertain native root/pipe/handle
retirement denies publication. A detached handle remains strongly owned when exit
cannot be proved. This does not claim compiler process-tree containment or defend
against a hostile compiler/installation writer. Runtime recognition retains its
separate native Job and resource limits.

An exclusive OS-owned file lock serializes builds and releases on termination.
No old PID, run or retained model slot is adopted. Only the fixed generated exe
and manifest are replaced, manifest last; native resource validation binds current
source and executable digests, PE identity and size before reuse. Interrupted
publication leaves a detectable mismatch and a fresh attempt can rebuild without
deleting historical evidence. Optional build failure preserves Standard startup,
while missing/stale resources remain unavailable. Build/copy evidence does not
grant application or parent qualification. Actual document normalization, source
authorization and both-host delivery still require separate checks.

## Complete OCR normalization boundary

Private PDF bytes, recognized text and source/page lineage remain untrusted.
The provider-neutral orchestrator validates readiness, exact source digest,
provider/version/language, every original page and a consistent total count.
It rejects totals above 16 and applies aggregate line, character and neutral
encoded-byte limits to the combined result. Partial recognition is not success.
Supplier exceptions use fixed public text without retained content in diagnostics.

The normalizer bounds one immutable PDF read at 16 MiB, rejects non-regular or
observed redirected sources, checks compatible path/handle metadata and compares
open-handle change time before and after reading. It does not authorize a source
or establish native protection against a hostile same-user path/content writer;
those source-staging and R30 native-race requirements remain pending. No new
executable, service, path selector, file format or implicit language install is
introduced. OCR failure/cancellation cannot be hidden by unsupported-file skip.
Normalized text and private paths are excluded from representations. Geometry
and original page metadata remain exact; no OCR confidence is invented.
Portable and actual fixed-resource synthetic normalization evidence supports this
adapter only. Public task/capability, native source authority, both-host delivery
and parent qualification remain separate. Old offload and accepted model quality
are unchanged. Rollback must preserve denial rather than silently drop OCR options.

## Bound staged-PDF capture

Private PDF bytes and source lineage cross a native file boundary. The private
snapshot adapter checks canonical local task-stage and direct-child syntax,
exact artifact/context coherence, bounded expected length and SHA256. These are
integrity checks, not source authorization: the application must compile the
binding from its authorized retrieved byte copy before public OCR integration.

Read leases reject reparse points, non-regular files and multiple hard links;
pin ancestors before descendants; deny file write/delete and ancestor deletion;
and compare one immutable bounded capture with the expected bytes. Cancellation
is checked between 64 KiB synchronous reads. It does not promise an asynchronous
hard deadline for a blocked operating-system call or a directory child fence.
Every acquired close is attempted independently. Unknown retirement retains the
exact owner and denies later capture without resetting or retrying stale handles.
Errors and representations exclude private identifiers, paths and source text.
Actual synthetic sharing/reparse/content checks support this private slice only;
upstream authorization, task/capability/UI delivery and broader R30 qualification
remain required. No historical offload tree or restricted legacy work is touched.

A mapped network drive can have a canonical drive letter and disk-file type.
The snapshot adapter therefore requires a typed `GetDriveTypeW` result of
`DRIVE_FIXED` for the explicit anchor before opening files. All other or failed
queries deny; no current-drive fallback or network-share probe is performed.

## OCR application-to-runtime source identity

Protect source authorization and byte identity against forged caller maps,
cross-workspace bindings, misleading metadata, adapter buffer reuse and ignored
options on an old worker. Public runtime/source-map fields deny. The application
requires strict opt-in/language/method coherence, an independent hasher and the
exact versioned worker protocol before source I/O. Binding identity remains
authority; catalog records must match the workspace/key and cannot authorize a
different source.

Copy final retrieved bytes before further awaited work. Derive the bounded PDF
map and staged file from that copy; validate `sha256:` plus 64 lowercase hex
before passing the raw hash to native capture. Both hosts compose the port even
without version storage. Fixed short ordinal names avoid display-title leakage
and needless long paths. Invalid, empty, excessive or non-PDF inputs cannot
dispatch. Hashing, capability-check and task-start exceptions use fixed public
errors; private paths, source maps and native details cannot enter those errors.

An allocation or recursive removal can fail after partial effects. Register a
private OCR owner before invoking the operation, retain its exact promise/attempt
on uncertainty and deny successors across use-case instances. A cleanup attempt
is terminal; repeat reads cannot retry removal or discard task/stage maps without
confirmation. A rejected start RPC is not evidence that a worker did not run.
OCR therefore issues its own fresh task identity and requires an exact request-id
echo. An ambiguous acknowledgement retains the stage, exact start attempt and
actual task reservation. Passive reconciliation cannot cancel, retry or retire
this unknown task. There is no old-tree inspection, adoption, reset or retry interface.
The ledger is process-local; durable crash and native/task reconciliation remain
qualification work. Filesystem cleanup alone supplies no worker-retirement pass.

These source-map controls do not qualify both-host UI or full packaging. The
managed task now consumes the map as described below. No engine is probed on
ordinary startup and no model-quality test is rerun. Existing retained-offload,
unknown-start recovery and broader security gaps remain separate. Rollback must
keep OCR denied, not silently ignore a requested map.

## OCR managed task consumption

Reject malformed or inactive maps, unbounded or reordered sources, mismatched
identities/paths and incompatible method/language settings before task I/O. Validate
raw OCR/layout booleans strictly. Repeat map admission before API output-root
resolution and direct preparation. Immutable bindings select native PDF capture;
display names cannot redirect into CSV/JSON loading or a Standard/skip fallback.
Absent MIME does not replace the host identity; explicit incompatible MIME denies.

Use the qualified native capture and fixed PDF decoder. Native read/recognition
retirement guards remain authoritative. Propagate unavailable language/reader and
capture failures without partial success. Public errors contain fixed useful
actions, no raw supplier errors, source paths or map payloads. Reports mark OCR
ready only after actual complete recognition and contain aggregate facts, not text,
source hashes, paths, invented confidence or inferred accuracy.

Cooperative preparation cancellation checks run between completed operations.
The asynchronous API returns running/requested until execution unwinds. Unknown
native retirement overrides cancellation rather than supplying an exit pass.
Preserve Standard behavior and all existing generation, quality, review and memory
controls. Local task fixtures, even with actual OCR, do not qualify model accuracy,
whole-host UI, package delivery, unknown-start recovery or durable crash recovery.

### Scanned-PDF form and saved-setting controls

Treat renderer choices and browser storage as untrusted. A strict shared contract
rejects non-boolean activation, missing or invalid language, incompatible methods,
missing source-format entries, mixed source types and selections over 256 files.
The forms and request builders apply the check before dispatch. Inactive settings
never send a stale language. A checked choice cannot silently fall back after a
source change; explicit method/goal changes turn it off. Task-owned inputs remain
locked until observed retirement, including a cancellation request still running.

These are convenience guards. Application authorization, exact protocol support,
private host byte bindings, native integrity capture and per-task installed-language
checks remain the security boundary. No renderer-supplied path, hash, source map,
provider command, model download or language download is introduced. Desktop saved
settings store only user choices; old records start off and malformed activation
stops submission. Version reuse must match currently available PDF sources before
restoration and is checked again by the host at execution.

Display only bounded completed-recognition facts and an explicitly explained
text-character check. Do not expose arbitrary provider identity/version strings or
present character hygiene as OCR confidence. Focused form tests cover invalid
choices, migration, saved-setting restoration, source/method changes, cancellation
and inactive-request compatibility. Full mounted-host and package proof remains
separate; browser state and client doubles grant no native or parent qualification.

Scanned-PDF recognition accepts at most 16 pages per PDF. Split a longer PDF
into smaller source files before using recognition. A version replay must retain
the exact structure-aware/layout/Markdown settings and a compatible training goal;
an explicit saved plan cannot bypass those checks.

## Controlled OCR delivery checks

The OCR fixture has no external provider or model access. It accepts only its two
fixed synthetic generation identifiers, CPU Standard settings, an explicit test
language and one source. The actual application and deployed worker still check
authorization, exact staging bytes, protocol, language, bounds, review and output
admission. Model downloads, training and conversation are refused by the fixture.
No fixture branch exists in product code. Both hosts retain production dependency
preparation; the server omits the simulated Node worker's preparation override.

Create only new bounded synthetic PDF files under the current qualification run.
The fixture font comes from the Windows directory API. Keep bearer-bearing traces,
screenshots and video off. Log only selected native counters/status, never frames,
recognized text, task tokens or paths. The fixed native operator requires exact
source/tool/package/environment witnesses, finite unchanged limits, actual root
exit, zero active members and acknowledged handle retirement. Preserve every
failed run. Unknown ownership never permits a successor.

A single Windows language/profile and synthetic generation cannot qualify all
OCR documents, model accuracy, inference performance or a parent criterion.

PDF chooser metadata is a routing hint only. Adding the existing PDF input type
and its empty-browser-MIME fallback does not change backend admission or validate
a PDF signature. Existing source authorization, raw-byte publication and native
PDF decoding remain required. Preserve all structured file choices and streaming
checks; do not accept caller metadata as proof of recognized content.

## Saved-version renderer integrity admission

- Boundary: untrusted saved preparation JSON and selected workspace metadata to
  one complete shared form value. Existing application authorization and recipe
  digest verification remain authoritative; renderer validation grants no access.
- Threats: source/version substitution, ambiguous source matches, unsupported
  settings causing a partially restored form, oversized or prototype-bearing
  JSON, executable accessors and disclosure through raw errors.
- Controls: exact workspace/version/dataset/artifact association; canonical full
  lineage equality; ordered unique source IDs and exact logical storage keys;
  ready workspace-scoped source projection with duplicate matches preserved;
  closed supported settings and whole-value rejection before any setter.
- Observed-match projection retains every matching duplicate and its order,
  including incompatible rows. Reject accessor/sparse rows and more than 256
  matches as a whole. Unrelated rows do not consume this bound. Never filter
  conflicting matches away or treat the capped 250 browse page as complete.
- Both apps capture bounded frozen reproduction/selection meaning before I/O.
  Resolve at most 100 unique canonical lineage keys through the existing explicit
  workspace `artifact.detail.read`/`artifact:read` operation, sequentially within
  a 15-second caller deadline. Every await checks the exact current request,
  client and committed form frame. Returned locator equality supplies key-derived
  source identity; it cannot prove a different missing legacy ID. Preserve all
  observed duplicate/conflict denials. Errors are fixed, path/payload-free copy.
  Keep fetched options private until full replay validation and actual serialized
  request equality pass, then merge only with the complete current form update.
  No partial option merge, stale progress overwrite, automatic dispatch or late
  acknowledgment. The shared `readDatasetVersionReplaySources` enforces the same
  metadata bounds for both authorized transport adapters and rejects accessor
  fields without invoking them. Timeout makes no transport cancellation or native-cleanup claim.
  Source-byte, physical host, provider, scale-runtime and parent checks stay separate.
- Bounds: recipe snapshot 512 KiB, reproduction envelope 1 MiB, JSON depth 16
  and 20,000 nodes, selected-source projection 256. The existing version-record
  normalizer still limits persisted lists to 100. Inspect property descriptors
  before cloning; reject accessors, unsafe prototype keys, non-JSON values and
  non-finite numbers. Compile output shapes through the existing contract.
- Return fixed safe failure copy only. Do not expose prompts, raw exceptions,
  paths, credentials or provider details. Returned values are cloned and frozen.
  Retain only form-supported quality choices; current backend mandatory policy,
  approval and consent must be resolved again. Do not restore destinations.
- Residual scope: no proof of current source bytes, async page freshness, runtime
  memory admission, installed OCR language, model readiness or provider authority.
  The internal Desktop restore hook now calls the validator with the exact
  selected version/file, observed list conflicts and bounded current exact-key
  source metadata. It
  builds a complete replacement, rebuilds the normal serialized request and
  requires identical normalized meaning before setters. A committed-frame and
  source-request fence retires stale edits, workspace/client/retry/unmount and
  task-start callbacks; active tasks and reviews retain their status. Successful
  application retires the invocation and resets all provider controls to local.
  Desktop now offers reuse through a page-owned exact one-use request and opaque
  consumer claim. Capture inspects descriptors without invoking getters/toJSON,
  limits each reproduction/selection capture to 1 MiB, 20,000 nodes and depth16, clones
  and freezes data, and releases settled request references. Recipe undefined
  values remain invalid; only normalized selection optional object fields omit
  undefined values. Current page scope retires navigation/workspace/superseded
  requests before the consumer's passive post-commit acknowledgment. Consumer
  identity, current source status, form edit capture and one-use application
  prevent stale writes and false success. StrictMode cleanup tickets preserve a
  still-mounted session and retire actual disposal. The surviving page announces
  one fixed scoped success after commit, never after queue/navigation. Cancellation
  makes no unchanged-state, rollback or publication claim. Reuse dispatches no
  task/model/provider action. Thin now uses the same one-use handoff and metadata
  resolver, retaining all observed rows before supported-source filtering. Its
  actual command roundtrip denies unsupported values before every setter; it
  never inserts original snapshot values to hide a builder mismatch. Form capture
  and committed-frame guards retire edits, client/scope changes and task start
  before late replies. Full-host/provider/scale checks remain separate; these
  local UI checks grant no parent, native, source-byte or application authorization qualification.

### Add data asynchronous session fencing

The shared renderer treats task responses as scope-bound data. Before progress,
notification or completion effects it requires the current mounted workspace and
client session, exact task identity, and the active operation owner. Replacement
or unmount stops further renderer-originated polls/chunks without claiming host
termination or deleting accepted work. A synchronous owner prevents duplicate
start/retry dispatch before the busy render. Existing transport/application
authority, byte limits, provenance, checkpoints and resource ownership remain.

A cancel request alone cannot release UI admission. A failed or nonterminal
response retains the task and requires status confirmation; only a matching
terminal response releases the owner. Duplicate status/cancel operations are
refused, early cancel waits for identity and stale completion cannot overwrite
the confirmed result. Tests exercise actual shared rendering with deferred
responses, foreign identities, unmount during a slice, duplicate operations and
multi-file exact-byte/digest assertions. These finite fixtures do not qualify
real host/native retirement, provider egress or model semantics. No unknown old
staging, process or filesystem object is inspected, adopted or cleaned up.

Session retirement runs in the layout cleanup of the committed tree, before
passive effects. This closes the commit-to-passive interval for late completion
and notification effects without changing accepted host task ownership.

### Browser preparation asynchronous effects

Protected UI assets include source selection, accepted task identity, exact quality
review identity, save/discard intent, prepared page content and completion callbacks.
Workspace/client replacement, same-frame duplicate submission, foreign replies,
late pages and raw exceptions can confuse or disclose that presentation. The
renderer retires sessions in layout cleanup, fences typed operations before and
after await, synchronously admits one start/review mutation and matches task/page
identities before use. A review/page sequence invalidates superseded results.

Failed, foreign or Unknown task reads retain the accepted owner and continue
observation. Unconfirmed discard retains the exact quality review. An old client
approval cannot trigger completion in a replacement session. Public diagnostics
do not echo unexpected transport exceptions. Memory denials keep the existing
bounded numeric notification formatter; resource guards and host/application
authorization are unchanged. Navigation never claims worker termination.

Focused rendered journeys exercise nine supported task recipes plus duplicate,
stale-client, status failure, wrong task/page, review and cancellation cases.
Related version/replay checks remain required. Synthetic API fixtures confer no
physical runtime, provider, native protection or model-quality qualification.
Unknown historical offload data and restricted legacy security review remain
outside this presentation change.

Missing report/review, foreign fingerprint and wrong review state retain accepted
ownership until matching review or authoritative terminal evidence. Eight rendered
denial/recovery cases failed before the correction and passed after it.

### Browser model selection and action integrity

Model reference, registry, file-list and download controls preserve workspace/client
session identity across awaits. Same-frame duplicate mutation is refused; stale
save/download/delete results cannot refresh the old workspace or announce success
in its replacement. Details/file/save/download/delete replies must match the
requested identity. A file dialog sequence refuses closed or superseded replies.
Deletion keeps explicit confirmation and record-only intent; no file-delete
authority is introduced. Accepted host tasks are not cancelled on page retirement.

Unexpected API exceptions use fixed public and diagnostic messages. Inventory
timeouts are bounded and cleared. Focused synthetic tests exercise the complete
browse/reference/download/inspect/record-delete workflow and denial/recovery cases.
No token, private provider, physical files, model accuracy, native staging or
restricted legacy Assets assessment is exercised or qualified by this change.

The real Models API client also uses fixed failure diagnostic copy before the
renderer handles an exception. Diagnostics retain only public operation/provider,
bounded query length, identifier-presence flags, status and elapsed time; they omit
raw queries, identifiers, endpoints, provider error text/code/details and content
type. Thrown API error message/status/code/details remain unchanged for typed
callers. Actual client-to-renderer denial tests cover that separate boundary.

### Desktop training task and review replies

Protected presentation state includes exact workspace/client/run identity, selected
prepared datasets, parameter values and explicit save/discard intent. A committed
session retires stale callbacks and follow-up reads. Synchronous action ownership
refuses duplicate starts and mutations. Status/cancellation replies must name the
accepted run. Review mutation keeps its identity until matching terminal save or
discard proof; missing registered save output remains unconfirmed. Accepted host
work is not cancelled by navigation. Host authorization and resource bounds remain
authoritative and unchanged.

Unexpected action exceptions do not enter rendered messages. Errors use fixed
workspace-scoped Notifications copy. Successful-save status remains authoritative
when a subsequent inventory read fails. Focused real-form/hook cases cover nine
profiles, explicit zero values, duplicate/stale/foreign actions, uncertain task
status and review retention. Synthetic results prove no physical training, model
quality, provider publication, native staging or worker retirement.

Focused deferred-reply tests also cover recovery-key ownership and terminal
observation during cancellation. Neither a retired Start nor a late Stop may
replace a newer accepted identity or confirmed review. Uncertain cancellation
remains observable with safe Notifications and unchanged host authority.

### Image presentation isolation and output evidence

Image presentation protects workspace/client/request identity, source references,
explicit start/cancel/finalize intent and artifact-backed output. A committed
session retires old replies and recovery writes. Synchronous mutation admission,
exact observed request identity and complete bounded registered-asset checks
prevent duplicate submissions and false completion. Uncertain status retains
accepted task identity; cancellation cannot regress confirmed finalization.

The form applies existing contract bounds before dispatch. Public unexpected
failures omit supplier exception text; Notifications owns generation errors.
Finite regressions include duplicate, stale, foreign, malformed, unsafe numeric,
late-cancel and retry cases on both hooks. They grant no runtime readiness, model
quality, provider, native staging or worker-stop proof. Existing host guards and
retained-object restrictions remain unchanged.

Focused review regressions also deny retired Refresh admission and preserve the
committed output consumer during a suspended replacement render.

### Daily UI task evidence and safe diagnostics

The owned-task app-journey helper treats HTTP/IPC results as untrusted evidence.
It keeps existing same-origin pairing and host authority, bounds response bytes,
refuses redirects and malformed success values, and prints only closed failure
categories. Provider codes, messages and payloads are not assertion diagnostics.
Finite helper tests preserve exact dispatch and exercise denial/stream cleanup;
they do not qualify actual apps, model semantics, native ownership or old stages.

### Training notification outcome integrity

The Desktop training notification bridge checks exact run identity and a closed
status set before classifying a read. Uncertain reads keep shared observation
active; committed client/workspace retirement rejects late publication. Shared
snapshots are checked again before presentation. The bridge owns exact listener
cleanup, including synchronous cached delivery, and remembers at most 100 terminal
identities to refuse duplicate start replay within the mounted session.

Public progress uses only safe integer current/total pairs with a positive total
and current within range. Fixed messages replace runtime progress and error text;
no prompt, provider diagnostic, path or payload is copied into history. Existing
host authority, memory guards and task lifetime stay unchanged. Rendered synthetic
regressions cover denial, retry, valid review/terminal states and shared cleanup;
actual host, model, native recovery and final testing remain separate.

### Dataset notification failure and memory facts

Dataset Notifications consumes the owning client's closed failure-code map and
existing numeric shortfall formatter. The client forwards only normalized memory
facts plus the existing allowed stage/reason fields; arbitrary worker details and
messages stay excluded. Fixed progress copy and ordered safe-integer counts avoid
private content and invalid progress. Only an actual boolean overflow flag can
produce the once-per-request disk warning.

Committed workspace/client sessions and per-subscription identity retire stale
replies and shared cached-result cleanup. Closed supported status checks leave
malformed reads uncertain for retry; explicit authoritative unknown remains an
unknown outcome. A bounded terminal cache refuses replay. Host authority, memory
guards, task lifetime and model expectations do not change. Synthetic rendered
and real client-mapping regressions are local support, not physical model/OCR,
native recovery, actual host or parent-roadmap qualification.

### Shared model-download notification boundaries

A complete download page is checked for current workspace, bounded unique task
identity, model/display fields and supported status before optional completion.
No valid prefix of an invalid page can trigger completion. Identity capture
prevents a caller from changing the expected task while completion is awaiting.
Returned completion and shared cached pages are checked before publication.
Committed client/workspace cleanup fences late replies. Existing live/history
reconciliation and host/application registration controls remain authoritative.

Fixed public messages replace runtime progress/error text. Numeric progress uses
ordered safe integers or a finite in-range percentage when counts are absent;
unknown units and invalid values are omitted. Only bounded valid timestamps are
forwarded. Synthetic UI regressions preserve the existing history behavior and
exercise malformed/foreign/duplicate/oversized pages, mutable identity, wrong
completion, retirement and safe copy. They do not qualify downloads, models, real
hosts, physical native protections or any parent roadmap.

The shared download bridge preserves the exact known worker-stop classification
through capture using only `python_runtime_worker_exited` plus failed status.
Its public copy is fixed; raw runtime message text is never trusted. Forged text
under another code and a known code on unknown status cannot assert worker exit.
Existing real host recovery assertions remain unchanged. Local bridge/runtime
fixtures support this compatibility repair without claiming an actual host fault
or native retirement qualification.

Desktop model views use commit-bound object leases and exact read tickets to
reject late results after workspace/client retirement and out-of-order reads.
Strict Mode replay cannot reactivate earlier ownership. Scope retirement clears
private model selection, destructive confirmation and action outcomes. Model
exceptions never enter public view/notification copy. Deletion is single-admission
and requires exact record, success and requested-effects acknowledgement before
confirmation closes; a failed follow-up read retains its retry guidance. These
rendered synthetic regressions do not qualify native file effects, main-process
sender authorization, provider/model behavior or the restricted legacy review.

Delete confirmation ownership is separate from request and workspace ownership.
A replacement form retires earlier consent. Exact current target and text are
checked at dispatch; a late result cannot clear a replacement or publish an
outcome over it, including same-record reopening and follow-up refresh races.

The Desktop Models composed UI fixture retains the real native-location denial
adapter. A requested file action must remain non-successful and leave the fresh
fixture record and bytes intact. The actual renderer client omits location paths.
Provider failures use fixed public copy, and workspace-owned references survive
bridge/registry reconstruction. The invoke event and provider are bounded offline
fixtures, not sender-authentication or native-effect qualification. Temporary
cleanup checks only the fresh owned regular tree after UI retirement; old
retained resources and production credentials are never inspected.

When separating image start contexts, API and IPC mappings inspect passive
generation-field descriptors. Only workspace context is removed. The mapping
and fixed application allowlist together deny unknown, accessor and hidden
generation fields. The application
request allowlist, workspace task authority and existing failure envelopes remain
unchanged. Positive and denial regressions preserve transport correlation.

The browser image HTTP fixture uses a bounded deterministic worker and an exact
synthetic credential/authorization policy. Its new owned output tree feeds the
real persistence, catalog, binding, asset registry and finalizer. A registration
failure retains the completed persistence receipt and retries without recopying
or duplicating publication. Refused cancellation remains active; after UI
retirement an isolated foreign read must fail before worker I/O. Byte/pixel and
registry oracles do not qualify real ComfyUI, browser decoding, production auth,
native ownership, provider behavior or the restricted legacy security review.

Image HTTP start validation precedes context extraction and diagnostic reads.
Accessor and hidden-field regressions run with logging enabled, prove no getter
execution and retain header correlation. Diagnostic summaries use a model-presence
flag instead of a selector that could contain a local path; prompt text is absent.
The passive snapshot and fixed application allowlist still reject unsupported
requests before worker admission.

The Desktop Training form does not copy runtime progress messages, task IDs or
validation-report paths into public status messages. It generates fixed state
copy plus independently validated epoch/batch pairs: safe integers, nonnegative
current, positive total and current no greater than total. Malformed counters
cannot claim progress or remove Stop/review controls. Report availability is a
fixed message. The current run remains internal for ownership and explicit
review. Rendered client-fixture regressions preserve those controls and do not
qualify physical training, native behavior, providers or final host execution.

Training default selection must not restore a path removed by the Models client.
It consumes the existing safe availability flag, retaining the legacy direct-client
path-presence fallback only when no boolean flag exists. The hint grants no file,
native or loading authority. The form still submits an exact workspace/model
record; application resolution and admission remain unchanged. Rendered tests
exercise the actual client sanitizer with finite preload envelopes and verify
path-free presentation/requests, unsuitable-default refusal and existing model
preference/fallback behavior. They do not qualify actual training or native files.

Composed Training tests join real UI/preload/handlers/orchestration with newly
owned staged input files, cooperative output storage and a durable JSON registry.
Independent byte and reopened-identity oracles protect exact input/output mapping,
explicit review, workspace refusal, retained failed-save review and no duplicate
storage on retry. The finite worker and passive input-binding/settings/runtime ports do
not prove physical training or host authorization. Fixture cleanup checks the
identity, containment, entry/byte bounds and regular-file tree of only directories
created for that test. It never inspects or cleans retained model/offload data,
and no native race-protection or atomic-publication qualification is inferred.

Training status reads require a canonical workspace-bearing bridge request, just
like cancel and explicit Save/Discard. The client rejects malformed workspace
identity before entering the bridge. This aligns declarations with the existing
preload contract and preserves all handler/application validation. Exact consumed
preload methods type-check without hiding the mismatch behind a broad cast.
The composed fixture reads input bytes from a real new filesystem store, while
input binding and artifact-list policy remain declared fixtures.

Desktop Download uses one view-owned synchronous ticket while its start request
is pending. Disabled controls are presentation; the hook ticket prevents same-tick
reentry before React renders. Retirement releases the old view ticket and rejects
late state changes without changing host/application authorization. Composed
fixtures use exact workspace/task/model identities, finite offline worker records
and a new bounded file tree. The real completion handler supplies write authority;
renderer payloads do not. Repeated completion registers once, failed tasks do not
register, and a foreign completion is refused before worker reads. Notifications
show fixed progress/failure copy without worker diagnostics or local paths. Owned
fixture cleanup checks identity, containment, entry/byte bounds and regular files.
No retained resources, real model/provider, native file proof or physical host
authorization is qualified by these synthetic task records.

Composed browser download tests use only a new loopback listener, a fixed synthetic
credential and identity-checked bounded files. The real client serializes requests
through actual routes and the task use case; test middleware refuses missing test
credentials before admission. The visible foreign-workspace notification panel
contains no owner activity or progress, and foreign completion is denied before
runtime reads. Path-free public records and fixed task messages preserve host
paths and worker diagnostics. Durable model identity is checked after reopening
the actual JSON registry; replay does not register again. Tests restore previous
browser storage/globals, close the exact listener and remove only the newly owned
regular-file tree. The synthetic access fixture grants no production-authentication
qualification, and no real provider/model or native/physical host pass follows.

## Website capture catalog compensation

A cancelled or losing website capture can have written raw and readable objects
before its source transaction is refused. Both hosts supply the existing
catalog-delete port to the website application use case. Compensation uses only
those current-call generated keys and current workspace/request context. It
removes each catalog entry after that object deletion returns success. A byte
denial preserves its catalog evidence. A derived-write failure cleans only its
acknowledged raw output. Old committed snapshots, unknown data and generic
storage deletion are unchanged. Focused tests cover catalog visibility after
held cancellation and byte-denial/raw-only ordering. They do not qualify native
races, durable cleanup recovery, real egress or production access policy.

## Browser artifact deletion intent and stale replies

Single and bulk local deletion share a synchronous pending owner. Confirmation
stays exact and workspace-scoped. Changing workspace or client clears old
selection and confirmation; accepted host work is not reported as cancelled.
Each layout setup owns a fresh lease and retires it during layout cleanup.
Uncommitted renders cannot revoke the visible session. Async work captures its
exact lease, including across development effect replay. Older list/detail/media
replies cannot replace current state. Deletion retires
prior reads and holds its guard until every dispatched bulk request settles.
Partial success removes only acknowledged targets from the retry selection and
refreshes authoritative records. UI admission is not an authorization boundary.
The existing application workspace checks, catalog-last deletion and prohibition
on remote-provider deletion remain authoritative. New synthetic fixture roots
are identity, containment, type, entry and byte checked before removal; exact
owned listeners and requests are retired. This local evidence does not qualify
production authentication, physical/native races, provider or durable restart.

## Desktop Artifact Browser leases and deletion intent

Local artifact lists, previews and popup updates are admitted only by their
current committed lease and exact request identity. Layout cleanup retires the
lease before passive effects. An uncommitted replacement does not alter the
visible owner. Retired replies cannot issue subsequent content/media requests;
prepared orphan object URLs use existing revocation. Current type/storage
filters cannot be undone by an older list response.

Registered and unregistered deletion share synchronous pending admission with
exact typed confirmation. A failure retains confirmation for explicit retry.
Old completion cannot clear a new workspace or publish success there. This is
UI intent coordination; application authorization, storage containment and
catalog-last local deletion still enforce access and effects. Remote provider
deletion is unchanged. Only fresh bounded fixture trees are inspected/removed,
with exact root identity, containment, regular types and entry/byte limits.
Composed preload tests use finite sender/provider/settings/timing fixtures and
do not qualify physical Electron, production access, native races or recovery.

Deletion captures the selected target, committed lease and selection sequence
before dispatch. Completion clears only that exact selection; choosing another
artifact or choosing the same artifact again creates a new selection. A newer
preview is a retained snapshot, not proof that deleted bytes still exist. Clearing
the current selection also closes its detail popup.

After a current-workspace deletion succeeds, refresh uses the latest committed
list callback. Changing type or storage filters while deletion is pending cannot
leave the removed item in the displayed list. The callback is updated in layout,
never during an uncommitted render; the existing workspace/client lease check
still prevents refreshing another view.

## Provider browse and stale file selection

A repeated browse or an outdated file selection can confuse local provider intent.
The shared panel admits one browse synchronously, checks exact request/session
ownership after replies, and clears dependent choices when namespace or dataset
selection changes. A fresh browse invalidates old files before awaiting metadata.
A synchronous current-file-list gate prevents an old Add data handler from sending
a task during that transition. These are presentation/intent controls; typed host
validation, workspace/organization authorization and immutable revision checks
remain authoritative. Remote registration is not local byte acquisition.

Both-client composed scenarios retain actual pre-fix selection/duplicate failures,
partial retry, selected-file-only effects, old-workspace replies and fixed safe
provider refusal. Credentials, provider metadata/existence, sender/access and timing
are synthetic boundaries; provider writes/downloads are disabled. Only fresh root
identity/containment/type/entry/byte checked files are removed after finite owned
work drains and globals are restored. No real provider, model, native, physical
host or parent security/roadmap qualification is claimed.

## Dataset configuration matrix boundary

The focused both-app configuration matrix admits only finite synthetic source
metadata and captured commands. Task clients refuse before acceptance, unused
model/download/runtime/provider mutations are unavailable fixtures, and no real
credential, network provider, source decoding, OCR or inference is used. It checks
incompatible source refusal, exact source IDs and task choices, invalid active
limits and omission of inactive task/model/division fields. Actual visible parent
controls are opened before interaction; hidden controls cannot be a test shortcut.

Each case owns a unique workspace and at most two captured commands. Unmount
retires component timers and finite continuations. Only exact owned workspace
storage keys are restored; unrelated storage and globals retain their original
values. These tests do not establish transport authorization, native cleanup,
file-parser safety, model semantics, offload ownership or production security.
No product authority, policy, guard or implementation changes in this chunk.

## Preparation approval response and UI ownership

The composed Dataset tests reproduced duplicate desktop approval dispatch, a
same-render Save/Discard race and success callbacks after page retirement.
Desktop review actions now share a synchronous token bound to committed scope;
only its current owner can apply a response or release busy state. Existing
application task/report/workspace checks and serialization remain authoritative.
Accepted writes are not undone merely because the page retires.

A partial materialization failure also exposed storage-controlled error text
through both registered app connections. The approval exception boundary now
returns fixed application-owned retry text. The tests inspect actual failure
envelopes and UI, preserve the pending review, verify compensated output bytes
are absent and retry after the storage port recovers. Other diagnostic paths,
rollback durability, native/process effects and final qualification are not
claimed by this correction. All tests use newly owned bounded synthetic resources;
no credentials, real model/OCR/provider action or unknown retained tree is used.

## Saved-version callback scope and recipe read checks

Eighteen composed local cases exercise real persisted recipe digests and version
identity through the existing mounted panel and registered app connections.
Missing or changed recipe bytes refuse the callback, hide a synthetic private
port marker and permit corrected retry. Wrong workspace/current-version
association cannot select a setup. Completed actual recipe reads held by a finite
delay fixture cannot call a retired panel after unmount or changed client,
workspace or artifact props. Existing version, source and consent guards remain.

The comparison UI correction only distinguishes recipe changes from changed
data-role digests. It changes no stored bytes, hash, authorization, publication
or runtime policy. A successful synthetic consumer callback is not proof that
a receiving page applied setup. Actor/access/readiness and worker quality/output
computation remain fixtures. Current new owned roots, SQLite/listener/tasks and
globals use the prior bounded teardown; store-call admission is prospectively40
per case to allow two versions. Other resource bounds are unchanged. No actual
model/accuracy/OCR/provider, physical/native/process restart or final/parent
qualification is granted, and accepted model/OCR checks remain closed.

## Saved-row mutation and response ownership checks

The composed saved-row tests keep workspace/version checks, source digests,
row fingerprints and immutable storage guards in the actual application. Foreign
workspace, missing version and malformed fingerprint requests refuse before
codec/storage mutation. Real model-free Python codec tests separately prove
stale fingerprint, incompatible schema and last-row rejection denial. A finite
TypeScript registry is not claimed as real hash/codec enforcement.

A synchronous shared UI owner admits one visible edit/reject action before a busy
render. Pending fields/selection are disabled. Empty numbers fail locally. Old
list/page/edit replies cannot update a retired workspace/service or unmounted
view. Accepted backend effects continue and remain in their original workspace.
Storage exceptions at the revised-dataset save call return a fixed public error;
contract failures do the same. Exact drafts/original bytes survive pre-write
failures and corrected retry. This does not prove unknown partial-write atomicity
or authorize deletion/adoption of effects after a failed storage acknowledgment.

Tests use fixed synthetic typed Parquet and principals, exact new checked roots,
SQLite and an owned loopback listener. Registry task/status/UI/application/store
counts and fixture file sizes are bounded. The actual staging adapter cleans
new stages; teardown verifies root identity, containment, types and byte/count
bounds before removal and restores globals/storage. The Python codec creates and
removes only its exact checked two-file staging roots. No unknown retained data,
model/OCR/provider/native process or current security policy is changed. Four
codec-function tests are separate from44composed UI tests; physical sidecar,
installed-host, process/restart and parent qualification remain unproved. Accepted
model/OCR checks stay closed.

The composed lineage oracle requires exactly one imported root and one child
in the same workspace/dataset, with an exact parent pointer and source key/hash.
It binds the actual recipe bytes and operation/fingerprint, quality report hash
and dataset role metadata to the expected mutation. Complete persisted records
remain equal after UI remount and local SQLite close/reopen. No child is accepted
merely because it has a parent pointer. This adds no native restart proof.
