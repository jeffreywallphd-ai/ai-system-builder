# Context Management Pack

## Use this pack when

- Changing the Context page, RAG database generation, Markdown context-pack
  generation, Context Browser, or Data Management-to-Context handoffs.
- Changing context source capability, chunk lineage, review/save/discard,
  context artifact formats, or local context-model execution.

## Canonical sources

- `docs/adr/ADR-0041-context-management-and-portable-context-artifacts.md`
- `docs/architecture/context-management.md`
- `docs/architecture/data-management.md`
- `docs/security/context-management-threat-model.md`
- `docs/standards/security-by-design-standards.md`

## Implemented architecture

- Context consumes the Dataset Preparation textual source capability authority;
  it does not maintain a separate format list.
- Data Management handoff is identifier-only: workspace id, artifact id, and
  target tab. The host resolves bytes, metadata, scope, and readiness again.
- An existing structured artifact is already chunked only when every usable row
  carries persisted `chunkIndex` and `sourceLineage` evidence.
- `ContextGenerationUseCase` owns workspace authorization, bounded staging,
  exact digests, task ownership, runtime-result validation, review state,
  save/discard, record-last catalog visibility, compensation, and cleanup.
- The Python `generate-context-artifact` task owns extraction, chunking,
  local-only embedding or topic/summary generation, physical SQLite/ZIP output,
  bounded preview, per-chunk progress, and cooperative cancellation.
- Runtime success is `review-required`. Nothing is saved until explicit Save;
  Discard deletes private staged output.
- Manual packs validate and preserve exact Markdown. Source-derived packs use
  semantic chunking, discovered topic groups, Standard/Strict cleaning, and
  either No Summarization or an explicitly selected local model with a bounded
  maximum line count. Both use one safe formatted review.
- `ContextBrowserUseCases` lists only verified workspace context media, parses
  saved SQLite/ZIP through the managed runtime, computes source freshness,
  supports source-only rebuild and registered-artifact deletion, and runs RAG
  test queries without returning vectors.
- Desktop preload/IPC and thin-client/API use the same typed command union.
  Electron sender trust and authenticated API read/write scopes are enforced
  before the shared application facade.

## Artifact contracts

- RAG media type:
  `application/vnd.ai-system-builder.rag-database+sqlite3`.
- Markdown context-pack media type:
  `application/vnd.ai-system-builder.markdown-context-pack+zip`.
- SQLite stores manifest, exact sources, ordered chunks, citation JSON, float32
  embedding bytes, and dimensions.
- ZIP members are fixed: manual packs contain `manifest.json`, `README.md`,
  and `context.md`; source packs contain `manifest.json`, `README.md`,
  `topics.md`, and `sources.md`.
- Catalog and binding metadata omit source content, manual context, prompts,
  model output, vectors, credentials, and local paths.

## Security invariants

- Require authoritative workspace context and artifact read/write scopes.
- Treat source/manual text and model output as untrusted.
- Verify SHA-256 across staging, runtime output, review, and save.
- Load selected models locally only; generation must not trigger network access.
- Allow model citations only to supplied chunk ids.
- Keep output handles opaque and validate canonical containment.
- Bound sources, bytes, manual content, chunks, prompts, output, topics,
  summaries, previews, package entries, retrieval results, and artifact size.
- Preserve review-before-save and compensate failed catalog/binding writes.
- Keep long-running task progress in the workspace notification activity
  center, terminal mutations in bounded notifications, and validation or
  blocking diagnostics inline.

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
