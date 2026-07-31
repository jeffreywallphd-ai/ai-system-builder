# Data Management Threat Model

## Scope

This model covers workspace source selection, local and Hugging Face staging, structured and document parsing, optional local-model generation, quality policy resolution, curation and quarantine, split creation, human approval, task lifecycle transport, result materialization, immutable dataset versions, publication evidence, warnings, and diagnostics.

## Protected assets

- Source artifacts, rows, documents, annotations, prompts, generated examples, and prepared split contents
- Workspace and organization ownership, artifact identifiers, repository revisions, and lineage
- Provider and model credentials
- Runtime working directories, host paths, logs, and adapter payloads
- Integrity of recipes, effective quality policy, reports, review fingerprints, quarantine lineage, split membership, immutable version digests, publication revisions, counts, destinations, and completed results

## Trust boundaries and controls

| Boundary                             | Primary threats                                                                                                                                                                                                          | Required controls                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI to IPC or HTTP                    | forged workspace/task identifiers, oversized body, guessed task reads                                                                                                                                                    | deny-by-default route policy, authenticated principal and organization context, normalized workspace context, bounded requests, opaque not-found denial, no UI-only authorization                                                                                                                                             |
| Resumable acquisition task           | dishonest progress, reordered or replayed chunks, whole-file memory pressure, stale checkpoints, cancellation/finalization race                                                                                          | bounded chunk/file/batch totals, per-chunk digest and exact offset, authoritative persisted progress, idempotent last-chunk retry, streaming finalization, optimistic revision, atomic task/snapshot commit, durable 24-hour cleanup intent, compensating artifact deletion                                                   |
| Artifact catalog/bindings to staging | cross-workspace reads, unscoped records hidden after apparent success, mutable substitution, traversal, source-type confusion                                                                                              | authoritative task workspace persisted on both catalog record and imported-source binding before success, workspace-scoped port context, contained storage locators, catalog name/media-type reconciliation when byte descriptors omit metadata, immutable provider revisions, early capability guard                            |
| Provider retrieval                   | credential disclosure, mutable revision, unsafe payload, unbounded transfer, cross-workspace localization                                                                                                                | repository port, organization-scoped credentials, explicit revision, bounded localization, authoritative workspace context on binding read/provider retrieval/local object and catalog write/binding update, sanitized failure                                                                                                |
| Governed website capture             | SSRF, DNS rebinding, unsafe redirects, credential forwarding, ignored robots policy, recursive crawl, oversized or hostile HTML/XML, fabricated extraction                                                               | shared secure-egress broker, all-address public DNS checks and redirect revalidation, same-origin sitemap/page redirects, credential stripping, no robots override, explicit page/sitemap scope, zero recursive depth, sequential pages, byte/type/time/redirect limits, immutable raw response plus separate derived text    |
| Runtime working directory            | traversal, stale files, partial outputs, local-path disclosure                                                                                                                                                           | generated contained directory, validated relative output handles, format validation, terminal and cancellation cleanup                                                                                                                                                                                                        |
| Cross-page preparation progress      | task-id injection, cross-workspace status disclosure, raw runtime error leakage, fabricated terminal state                                                                                                              | accepted-start event with validated bounded task id and workspace, workspace-scoped authoritative status reads, fixed/sanitized messages, bounded structured counts, no raw runtime payloads                                                                                                                                  |
| Parser and generator                 | malformed or oversized input, vulnerable native parser, incomplete model cache falsely marked ready or silently starting network work during preparation, transient download failure deleting resumable data, corrupt or policy-escaping cache retention, missing or substituted model-placement dependency, infrastructure errors hidden by a broad skip policy, invalid model output entering training rows, indirect prompt injection, task/schema substitution, prompt/content leakage, arbitrary exception disclosure | file/row/chunk bounds, exact patched PyArrow and reviewed Accelerate pins with startup probes, local-only complete configuration/weight-shard/tokenizer readiness validation, incomplete-cache acquisition restricted to the explicit resumable download task, three bounded transfer/validation attempts, partial-cache preservation for ordinary retryable failures, cleanup on containment or configured byte/file-bound failure, separate sanitized interrupted/invalid-snapshot codes, rate-limited structured progress with stderr rendering suppressed, fail-closed generation dependency preflight, explicit skip policy may reject and warn one source section after bounded output correction while zero-valid-example runs fail, model-cache/load/decoder/inference/dependency/resource/runtime failures remain fail-fast, separate trusted system and untrusted data roles, task-bound strict JSON envelopes, exact-field/allowlist/source-span validation, fail-closed row parsing, no raw exception/source/prompt/output logging |
| Token-constrained decoder            | schema substitution, unsupported or recursive schema, native dependency compromise, unbounded compilation/cache, tokenizer mismatch, dead end, truncation, silent unconstrained fallback, sensitive exception disclosure | compiler-owned exact schema, strict schema subset and size/depth/node/property/choice bounds, exact conditional dependency pins, truthful capability advertisement, model-local bounded LRU, processor reset, accepting EOS requirement, at most one same-mode correction attempt with no checked-mode fallback, sanitized stable codes, mandatory post-validation |
| Source attribution enrichment        | model-invented attribution, lineage substitution, credential-bearing URL disclosure, oversized metadata, attribution appearing when not selected                                                                         | separate explicit quality-policy choice, locked UI companion fields, post-validation trusted-source enrichment, authoritative artifact id, bounded allowlisted text, HTTP(S)-only public URL with credentials/query/fragment removed, absent companion object when unselected                                                 |
| Split stage                          | duplicate or source leakage, fabricated counts, nondeterminism                                                                                                                                                           | deterministic component partitioning, source/group and exact-content isolation, physical outputs, count invariants                                                                                                                                                                                                            |
| Quality policy and curation          | permissive fallback, unbounded duplicate work, hidden row loss, sensitive review samples                                                                                                                                 | host-owned fail-closed policy resolution, mandatory controls, bounded candidate checks, reversible quarantine, count invariants, sanitized bounded samples                                                                                                                                                                    |
| Advanced processing and generation   | fabricated OCR or capability readiness, unbounded pair comparison, source-free generated content, single-pass self-approval, sensitive embeddings or examples in evidence                                                | explicit capability status and fail-closed denial, bounded local comparison, exact normalized-span citations, independent schema/grounding/critic/safety/diversity verification, mandatory quarantine and approval, aggregate-only evidence                                                                                   |
| Adaptive task recipe                 | renderer-selected incompatible method, optimistic total-memory recommendation under current memory pressure, unbounded disk/swap pressure, shared-host utilization disclosure, ignored controls, mixed source roles, unsafe legacy migration, misleading image inspection claims | contract-owned task/source resolution, desktop-only available-memory fact, server total-memory reserve, ordered 7B/3B/1.5B fallback for untouched choices, explicit/saved choice preservation, closed 0/1/4 GiB CPU-overflow policy, mandatory worker live-memory preflight, CUDA overflow denial, application and worker reconciliation, inactive-field rejection, deterministic safe migration, exact inspected-surface evidence, explicit unavailable pixel/OCR/face capabilities |
| Long-running runtime task            | premature model-download failure, semantic over-fragmentation causing excessive inference, opaque first-batch model loading, unbounded worker occupation, cancellation of unrelated work                                                                                                                            | central task-class deadlines, twelve-hour model-download and twenty-four-hour training caps, minimum semantic section size plus maximum token/span limits, explicit global loading-model phase followed by bounded section progress, task-scoped cancellation, terminal cleanup, no renderer-controlled unlimited timeout                                                                                                                           |
| Review and approval                  | guessed task, stale or replayed approval, altered report, blocked dataset admission                                                                                                                                      | recorded scope, validated effective policy/report, timing-safe exact fingerprint comparison, one-time pending state, approvalAllowed denial                                                                                                                                                                                   |
| Materialization/publication          | wrong destination, partial or unverifiable result, cross-workspace output                                                                                                                                                | withhold final outputs before approval, explicit destination, workspace metadata/context, result validation, partial-write compensation, later version-level atomicity                                                                                                                                                        |
| Dataset version persistence          | partial visibility, mutable substitution, malformed or oversized metadata, cross-scope reads                                                                                                                             | artifact-first/record-last visibility, exact SHA-256 references, bounded schema validation, insert-only idempotency, organization partition, workspace-qualified key, and application workspace authorization on history/comparison/reproduction                                                                              |
| Publication evidence                 | publication against a missing or substituted version, mutable destination inference, accidental public access, credential disclosure                                                                                     | require an existing exact version, authorize exact workspace/provider scopes, verify every artifact digest, private default, separate public confirmation, bounded one-commit publication, append-only immutable revision evidence, adapter-owned credentials, no provider payload persistence                                |
| Status and cancellation              | guessed request id, cross-workspace or cross-organization observation or cancellation, retained review files                                                                                                             | workspace and optional organization ownership recorded at start and checked on every read/approve/cancel, generic not-found response, evidence and runtime cleanup                                                                                                                                                            |
| Source snapshot and refresh history  | mutable source substitution, missing change event, partial task/lineage visibility, stale validator trust                                                                                                                | immutable content digests or exact provider revisions, bounded validators, atomic task/snapshot and changed-refresh/snapshot transactions, append-only refresh outcomes, workspace/organization partitioning                                                                                                                  |

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
- A missing quality-policy provider, malformed report, policy mismatch, blocked report, wrong-scope approval, stale fingerprint, or replayed approval fails closed.
- Review reads expose bounded sanitized summaries and report/quarantine descriptors, never final dataset descriptors or raw row values.
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
  the order-independent integrity fingerprint. Windows uses the pinned
  Outlines kernel's eager callable to avoid an optional compiler probe and
  retains the same token mask and mandatory post-validation. Desktop startup uses
  only fixed bounded version probes to prefer an installed decoder-compatible
  Python when the operator did not configure one; explicit configuration wins,
  and the UI disables the control whenever authoritative capability remains
  unavailable.
- Model training accepts recorded purpose paths only with a valid exact schema
  fingerprint and rejects selected datasets whose mappings or fingerprints do
  not match before model loading.
- Dataset generation estimates physical model-weight memory before construction.
  Its closed overflow policy permits 0, 1 GiB, or 4 GiB of system-managed
  disk/swap pressure for CPU/automatic placement and rejects larger shortfalls;
  CUDA-only placement never receives this allowance. Desktop defaults to the
  1 GiB choice, while an omitted policy fails closed to memory-only. The renderer
  cannot supply arbitrary limits. Actual overflow emits bounded task progress and
  a deduplicated slowdown warning without paths or host identity. Desktop may use
  its local available-memory fact to select the next smaller built-in default;
  shared server hosts retain a total-memory reserve. Neither path can override an
  explicit or saved model.
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
