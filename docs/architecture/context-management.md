# Context Management

- Status: current
- Related decisions:
  `docs/adr/ADR-0008-ingestion-and-staged-artifact-semantic-model.md`,
  `docs/adr/ADR-0009-artifact-identity-and-backing-domain-model.md`,
  `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md`,
  `docs/adr/ADR-0040-immutable-dataset-versions-lineage-and-publication.md`,
  `docs/adr/ADR-0041-context-management-and-portable-context-artifacts.md`
- Related areas: `docs/architecture/data-management.md`,
  `docs/architecture/runtime-model.md`,
  `docs/architecture/persistence-and-storage.md`
- Verification: `docs/architecture/architecture-verification.md`

## Purpose

Context Management turns explicitly selected workspace artifacts and bounded
manual entries into portable context artifacts. It does not introduce a second
upload, acquisition, or dataset system. Data Management remains the authority
for acquiring source artifacts and creating reviewed datasets; Context
Management consumes those artifact identities and preserves their provenance.

The user experience has three peer surfaces:

1. **RAG databases** selects source data, inspects or extracts chunks, configures
   a local embedding model, generates a review, and asks the user to save or
   discard. Its compact source picker follows Data Management conventions with
   readable names, file-type badges, and All, Uploaded, and Generated filters.
2. **Context packs** first chooses manual entry or source materials. Manual
   entry validates and preserves the entered Markdown. Source mode performs
   semantic chunking, topic grouping, Standard or Strict cleaning, then either
   preserves each group with **No Summarization** or generates summaries with
   an explicitly selected local model. Both modes use the same formatted review
   and explicit save/discard lifecycle.
3. **Context Browser** shows saved RAG databases and context packs in the same
   card vocabulary as Artifact Browser. **View Details** opens a bounded modal
   for metadata, preview, source navigation, RAG testing, rebuild, and deletion.

## Shared capability and Data Management linkage

`modules/contracts/context-management/context-source-capabilities.ts` consumes
the Dataset Preparation source capability authority. Context accepts textual
CSV, JSON, JSON Lines, Parquet, TXT, Markdown, HTML, PDF, and DOCX artifacts and
rejects image-only and unsupported formats before runtime work.

Artifact Browser details for compatible textual data can expose **Convert to
RAG database**. The handoff contains only the authoritative workspace id,
artifact id, and target tab. The Context page resolves the current
workspace-scoped artifact again; a renderer-provided path, media type, byte
payload, or readiness claim is never authoritative.

“Already chunked” means the selected structured artifact contains persisted
`chunkIndex` and `sourceLineage` evidence for every usable row. Context
generation reuses each row as a chunk and preserves the selected artifact
digest, row index, text field, original chunk index, normalized span, page, and
region where present. A merely structured dataset is not called already
chunked. When that evidence is absent, the normal extraction settings apply.

RAG extraction reuses
`modules/adapters/runtime/python/worker/tasks/markdown_chunking.py`, the neutral
chunker used by Dataset Preparation. The user can choose fixed-length,
topic-aware, or document-structure sections. Fixed-length uses character size
and overlap. Topic-aware uses semantic sentence boundaries with a bounded token
ceiling and sensitivity. Document-structure uses normalized headings,
paragraphs, tables, pages, and layout regions where the source parser provides
them, with a section fallback for structured rows. These controls apply only
to unchunked sources; verified persisted chunks are reused without alteration.

## End-to-end flow

    Context ordered workflow or identifier-only Data Management handoff
      -> authenticated workspace host boundary
      -> ContextGenerationUseCase
      -> workspace artifact binding, catalog, and object-storage reads
      -> private bounded staging with exact source SHA-256
      -> RuntimeTaskRegistryPort (context-generation)
      -> managed Python worker (generate-context-artifact)
      -> bounded source inspection, preview, manifest, and private output
      -> explicit Save or Discard
      -> record-last object, catalog, and binding persistence
      -> Context Browser or Artifact Browser detail selection

Application code owns authorization, staging, task ownership, output
containment, review state, save/discard, catalog visibility, and compensation.
The Python worker owns document/structured extraction, chunking, embedding,
topic/summary generation, and physical artifact creation. Renderers own only
ordered interaction state and bounded display. The shared desktop/thin-client
Context Studio uses the standard tab-panel inset and four-step workflow
components. Workspace changes clear source filters and selections, manual text,
task review state, browser selection, and query results. Only an opaque task id
may be retained for review recovery. The shell-level notification bridge
publishes authoritative bounded task progress while the tabs are open or
closed. Save, discard, and delete publish terminal outcomes; validation,
blocking diagnostics, loading, empty results, and routine reads remain inline.

Saved artifacts are accessed through `ContextBrowserUseCases`. List is derived
only from the authorized workspace artifact catalog and the two context media
types. Detail re-retrieves exact bounded bytes, verifies the catalog digest,
and asks the managed runtime to parse the SQLite or ZIP into a safe bounded
projection. Rebuild reconstructs a generation command only when every source
remains available and no manual text would be lost. Delete delegates to the
registered-artifact deletion lifecycle.

RAG test queries use the embedding model recorded in the verified manifest,
rank vectors inside the managed runtime, and return only bounded excerpts,
scores, and exact citations. Stored vectors and arbitrary SQLite rows never
cross the runtime boundary.

Desktop and server hosts compose the same application facade. Electron exposes
one sender-trusted, independently validated command channel through preload.
The server exposes authenticated read and write routes with `artifact:read`
and `artifact:write` policy scopes. Both transports inject authoritative actor
context and preserve opaque cross-workspace not-found behavior.

## Materialized artifacts

### RAG SQLite

The RAG media type is
`application/vnd.ai-system-builder.rag-database+sqlite3`. The database has a
schema-versioned manifest, exact sources, ordered chunks, JSON citations,
float32 embedding bytes, and explicit embedding dimensions. Embedding vectors
are not returned in previews, task metadata, catalog records, or diagnostics.
Generation uses a selected local Transformers model with
`local_files_only=true`; it never downloads a model as a side effect.

### Markdown context pack

The context-pack media type is
`application/vnd.ai-system-builder.markdown-context-pack+zip`. Every bounded
ZIP contains `manifest.json` and `README.md`. A manual pack adds one exact
`context.md`; a source-derived pack adds `topics.md` and `sources.md`.
Static archive member names prevent path traversal. Each source-derived topic
and source chunk has a citation back to the selected artifact.

No Summarization preserves each cleaned semantic group without shortening it.
Model-assisted generation requires an explicitly selected installed local
model, a maximum line count, and strict JSON output. Source text is delimited
as untrusted data, embedded instructions have no authority, and every returned
citation must match a supplied chunk id. Manual and generated Markdown is
validated before review and archive creation. Review renders a safe React
projection; raw HTML from Markdown is never executed.

## Review and persistence lifecycle

Runtime success is `review-required`, not saved. The host revalidates output
handle containment, regular-file status, byte count, media type, manifest,
source evidence, preview bounds, and SHA-256 before exposing review evidence.
Only bounded preview text and citations cross into UI state.

Save re-reads and re-hashes the same staged output. Object bytes are written
first, then a workspace catalog record is appended, then the primary local
binding is created. Catalog or binding failure compensates previous writes.
Discard removes the private runtime directory without cataloging anything.
Cancellation is cooperative and checks between chunks; terminal paths release
the power-suspension blocker and private staging.

## Bounds

- At most 32 selected artifacts and 32 manual entries.
- At most 64 MiB per retrieved artifact and 1 GiB aggregate selected bytes.
- At most 200,000 characters per manual entry and 1,000,000 aggregate. The
  manual authoring surface reports lines because that is the meaningful editing
  measure; the character ceilings remain defense-in-depth byte-growth bounds.
- At most 100,000 chunks; chunk size is 64 to 32,000 characters and overlap is
  smaller than the chunk and at most 8,000 characters. Adaptive chunking uses
  32 to 4,096 tokens per chunk and topic sensitivity from 0 to 1.
- At most 32 discovered topic groups. No Summarization groups are at most
  12,000 characters; local-model output is at most 64,000 characters and the
  requested 1 to 1,000 lines. Review remains at most 100 items and 8,000
  aggregate preview characters.
- Model prompts and outputs are separately bounded; every source and saved
  context artifact is at most 64 MiB, matching verified object retrieval.

## Failure and recovery

Missing workspace, authorization, source, capability, digest, model,
dependency, citation, output containment, or storage evidence fails closed.
Public errors do not contain source text, manual content, prompts, model output,
embeddings, credentials, or local paths. Private staged directories are removed
after terminal failure, cancellation, save, or discard. A failed save remains
reviewable after compensation so the user can retry.

> AI documentation reminder: when behavior in this area changes, update the
> related ADRs, threat model, context pack, runtime docs, and host/UI READMEs in
> the same change.
