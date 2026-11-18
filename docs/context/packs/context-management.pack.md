# Context Management Pack

## Use this pack when

- Changing Context UI, RAG/pack generation, Browser or Data Management handoffs.
- Changing context source capability, chunk lineage, review/save/discard,
  context artifact formats, or local context-model execution.

## Canonical sources

- `docs/adr/ADR-0041-context-management-and-portable-context-artifacts.md`
- `docs/architecture/context-management.md`
- `docs/architecture/data-management.md`
- `docs/security/context-management-threat-model.md`
- `docs/standards/security-by-design-standards.md`

## Implemented architecture

- Context uses the Dataset Preparation textual capability authority, not a separate format list.
- Data handoffs carry workspace/artifact IDs and a target tab; hosts recheck bytes, metadata, scope and readiness.
- An existing structured artifact is already chunked only when every usable row
  carries persisted `chunkIndex` and `sourceLineage` evidence.
- `ContextGenerationUseCase` owns workspace authorization, bounded staging,
  exact digests, task ownership, runtime-result validation, review state,
  save/discard, record-last catalog visibility, compensation, and cleanup.
- The Python `generate-context-artifact` task owns extraction, chunking,
  local-only embedding or topic/summary generation, physical LanceDB/ZIP output,
  bounded preview, per-chunk progress, and cooperative cancellation.
- Embedding placement is transient CPU (omitted default), CUDA or automatic.
  Queries carry `embeddingDevice`; manifests never retain it. Explicit CUDA
  failure never silently falls back. Weights/inputs share a device, local-only
  model authority and portable package/citation bounds stay unchanged.
- Host-owned managed setup installs exact LanceDB and PyArrow pins by default.
  Explicit RAG create/inspect/query starts repeat the asynchronous one-flight
  probe/install/re-probe and publish fixed installation progress through the
  existing workspace task activity. Passive reads never install or repair.
- Runtime success is `review-required`. Nothing is saved until explicit Save;
  Discard deletes private staged output.
- Manual packs validate and preserve exact Markdown. Source-derived packs use
  semantic chunking, discovered topic groups, Standard/Strict cleaning, and
  either No Summarization or an explicitly selected local model with a bounded
  maximum line count. Both use one safe formatted review.
- `ContextBrowserUseCases` lists only verified workspace context media, parses
  saved LanceDB/context-pack ZIP through the managed runtime, computes source freshness,
  supports source-only rebuild and registered-artifact deletion, and runs RAG
  test queries without returning vectors.
- Source inspection returns typed `textFields`; document sources use an empty array.
- `context.preview-rebuild` is passive. A new v9 generation approval binds `rebuildOf`, exact recorded inputs and a new review-required result; it overwrites no parent.
- Inspection/query inputs use a private hashed byte snapshot and the existing
  host task lease. Exact terminal status or successful owned worker stop permits
  cleanup; uncertain replies/cancellation and cleanup failures retain ownership.
  Private `queryAdmitted` binds installed starts; the retained Browser adds exact saved-byte/model/source admission, numeric summaries and separate cleanup capacity. Passive question preview is metadata only. Public query/physical qualification remain pending.
- Saved RAG validation scans every vector in bounded 256-row Arrow batches,
  retains metadata only and checks cancellation throughout. Exact query ranking,
  citations, package limits and private materialization cleanup remain required;
  no cross-request cache or approximate index is introduced.
- The desktop Context page keeps the shared sanitized Python runtime monitor
  available beneath RAG Databases, Context Packs, and Context Browser.
- Desktop preload/IPC and thin-client/API use the same typed command union.
  Electron sender trust and authenticated API read/write scopes are enforced
  before the shared application facade.

## Artifact contracts

- RAG media type:
  `application/vnd.ai-system-builder.rag-database+lancedb+zip`.
- Markdown context-pack media type:
  `application/vnd.ai-system-builder.markdown-context-pack+zip`.
- A RAG artifact is one ZIP containing `manifest.json` and a contained LanceDB
  `database/` subtree with one exact-schema `chunks` table of ordered text,
  citation JSON, fixed-size float32 vectors, and dimensions.
- ZIP members are fixed: manual packs contain `manifest.json`, `README.md`,
  and `context.md`; source packs contain `manifest.json`, `README.md`,
  `topics.md`, and `sources.md`.
- Catalog/binding metadata omit source/manual content, prompts, model output, vectors, credentials and local paths.

## Security invariants

- Require authoritative workspace context and artifact read/write scopes.
- Treat source/manual text and model output as untrusted.
- Verify SHA-256 across staging, runtime output, review, and save.
- Load selected models locally only; generation must not trigger network access.
- Allow model citations only to supplied chunk ids.
- Keep output handles opaque and validate canonical containment.
- Reject unsafe LanceDB package members before private manual extraction and
  validate the exact table schema, counts, dimensions, citations, and lineage.
- Bound sources, bytes, manual content, chunks, prompts, output, topics,
  summaries, previews, package entries, retrieval results, and artifact size.
- Preserve review-before-save and compensate failed catalog/binding writes.
- Keep long-running task progress in the workspace notification activity
  center, terminal mutations in bounded notifications, and validation or
  blocking diagnostics inline.
- Keep package-manager output, command lines, environment values, and paths out
  of public task state; accept no caller-selected dependency version/index/URL.

## Verification

- Focused Context contract, application lifecycle, Python worker, runtime
  adapter, authorization-denial, prompt-injection, integrity, cancellation, and
  compensation tests.
- `npm run docs:check`
- `npm run architecture:check`
- `npm run agent-support:check` when routing or this pack changes.
- The approved AI-related roadmap completion boundary uses `npm run test:all`.

## Adjacent packs

- Add `data-management` for Artifact Browser or Dataset Preparation linkage.
- Add `runtime` or `runtime-task-registry` for worker/task changes.
- Add `desktop-implementation` for shared desktop/thin-client Context UI.
- Add `security` whenever inputs, models, storage, transports, or diagnostics
  change.

## Renderer session checks

- Workspace/client replacement retires the Context form during layout cleanup;
  guard dispatch and replies before task-storage, notification or follow-up effects.
- Synchronous action ownership prevents duplicate generation and mutations. Retain
  accepted task ownership through review and unconfirmed cancellation; matching
  terminal evidence permits a new preparation. Never cancel host work on navigation.
- Require matching action/source/task/artifact replies. Save needs the matching
  saved result and returned artifact. Retire old detail/list presentation when a
  newer request wins. The shell task-list bridge has its own committed scope fence.
- Show fixed transport failure copy; local Markdown validation has fixed detailed
  messages. Focused renderer fixtures do not qualify actual host/model/native work.

Each accepted generation has a local observation epoch. Later cancellation or
poll replies cannot replace a confirmed terminal or ready-for-review state. A
fresh explicit acceptance resets presentation for the next generation without
reviving the old observation. This is renderer ownership, not runtime authority.

Delete confirmation binds the selected artifact ID and verified storage key.
Only an acknowledgement of that exact key can clear the confirmation, refresh
the list or report deletion. A different key leaves the selected view intact.

- Manual pack inspection follows generation: one manual entry, no sources, and
  exact `context.md` bytes matching the recorded digest before UTF-8/Markdown
  acceptance. The outer package digest is separate. Original line endings stay
  exact; source-derived/legacy and RAG behavior remains unchanged. See the
  canonical Context architecture and threat model for scope and evidence limits.

- Headless plan-review clients can list recorded model metadata and preview
  exact saved source/version/settings through the passive Context compiler.
  It cannot extract, install, load a model or start a task. Runtime readiness
  stays unverified. Current artifact/model scope and strict public DTOs fence
  both hosts; later execution revalidates through the existing Context owner.

- Internal approved Context start binds exact scoped command/source bytes and a
  reserved task to trusted current checks and atomic one-use issuance. Unknown
  starts retain only new staging; exact task/terminal/cancel identity is required
  for cleanup. Runtime/model readiness and public plan wiring remain separate.

- Internal approved start requires the installed-only runtime capability before
  source bytes. A proven no-dispatch refusal cleans fresh staging while consuming
  the task ID; unknown replies retain custody. There is no ordinary-start/install
  fallback. Public host composition and real model/runtime proof remain pending.

- Installed-only host composition retains policy through pending/lost task replies
  and shared worker recovery. Exact terminal facts prevent late-ack resurrection;
  the bound host guard reaches native spawn and POST. See the runtime architecture.
  Focused simulated evidence does not qualify public Context/model execution.

- Dedicated Headless plan clients can propose `context.generate-pack` through
  v6 approval, then inspect only an accepted `context.task`. The initial active
  profile uses exact saved sources and no model. Distinct one-use receipts bind
  source/license witnesses; uncertainty never permits another start or adoption.
  Replies contain state/counts/review fingerprint and require separate save;
  they grant no query/rebuild/presentation or parent qualification.

- Internal RAG admission also binds selected saved-model facts and checked existing
  safe-weight files. The runtime-only local reference is excluded from public
  commands and portable manifests. Cooperative file checks do not qualify actual model resources or native custody.

- Separately enabled `context.generate-rag` plans use preview version7 and bind
  the exact saved-model witness through atomic issue after source staging.
  Approval states local embedding work, selected device/policy and separate save.
  Accepted-task replies stay bounded. Physical retrieval/resources and later
  save/query/rebuild/display remain separate from the plan-connection checks.

- The private Context result-byte publisher shares ingestion's bounded verified
  stream mechanism. It derives an opaque scoped key and checks complete EOF/SHA
  before exclusive publication, without catalog/binding writes or deletion.
  Byte acknowledgement grants no task/save approval, metadata activation or native qualification.

- The internal Context save owner binds an accepted task and exact reviewed
  output to one admitted save, a bounded output reader and exclusive byte
  publication. Catalog, primary binding and causal receipt activate together in
  the root-owned metadata transaction. The host must supply a separate exact-save
  authorizer. Unknown outcomes cannot bypass through ordinary review actions;
  confirmed saves survive cleanup/reply failure. Real model/retrieval/native qualification remains separate.

- Public version-8 `context.save-result` binds accepted task/review/name to separate approval.
  Its atomic version-2 index supports passive `context.saved` metadata; `byteAvailability: not-checked` asserts no archive readiness.
  Desktop proposal reads use the retained owner without runtime initialization; receipt replay needs no live processor.
  Version-1 private receipts stay internal; no file/task adoption or parent pass is inferred.

- Only the owning call's proven non-start can create a version-2 terminal task outcome.
  `headless.not-started` replay never dispatches or becomes an accepted task.
  Unknown issuance, possible starts and legacy interrupted attempts stay unconfirmed.
