# ADR-0041: Context Management and Portable Context Artifacts

- Status: accepted
- Date: 2026-08-01
- Deciders: ai-system-builder maintainers
- Related: ADR-0008, ADR-0009, ADR-0015, ADR-0028, ADR-0029, ADR-0040,
  `docs/architecture/context-management.md`,
  `docs/architecture/data-management.md`

## Context

Workspace data can already be uploaded, acquired, prepared, reviewed, and saved
as artifacts and immutable dataset versions. Systems also need bounded context
that can be inspected and reused without making a renderer parse files, call a
model directly, or depend on provider-specific storage. Two outputs are needed:
a local retrieval database with exact chunk lineage and a portable Markdown
context pack containing topics, summaries, and citations.

Data Management and Context Management share source formats and extraction
needs. Duplicating source capability rules or silently re-chunking a prepared
dataset would make the two areas disagree and would discard useful lineage.
Generated context is also derived content. It must remain private and
discardable until the user explicitly saves it.

## Security impact

This decision is security-relevant. Protected assets are workspace source
content, manual context, model inputs and outputs, embeddings, generated
artifacts, source lineage, and storage/catalog integrity. Threats include
cross-workspace selection, source substitution after review, path traversal,
malformed structured or document input, decompression and resource exhaustion,
prompt injection, model-authored citations, ambient network model retrieval,
partial save visibility, and disclosure through diagnostics or metadata.

Controls are exact workspace authorization, identifier-only handoffs, shared
source capability checks, private host staging, SHA-256 source and output
verification, bounded counts and bytes, local-only model loading, explicit
untrusted-data prompts, schema validation, citation allowlists, opaque output
handles, path-containment checks, review-before-save, record-last catalog
visibility, compensation, and safe diagnostics. Catalog and binding metadata do
not contain source text, manual content, prompts, model output, embeddings,
credentials, or local paths.

## Decision

- Context Management is an ordered, workspace-scoped workflow with RAG database,
  Markdown context-pack, and Context Browser surfaces.
- Data Management and Context Management consume one source capability
  authority. A textual artifact can be handed off by workspace and artifact
  identifier; no content, local path, or renderer-owned authorization is passed.
- Prepared data is treated as already chunked only when every selected row has
  persisted chunk and source-lineage evidence. The selected artifact digest,
  row, field, source span, page, and original chunk index are preserved where
  present. Missing or inconsistent evidence uses normal bounded extraction
  instead of claiming persisted lineage.
- RAG generation materializes one portable LanceDB package. The ZIP package
  contains a schema-versioned `manifest.json` and one embedded `database/`
  directory with a single `chunks` table containing ordered text, citation JSON,
  and fixed-size float32 vectors. Embedding models use the managed local
  Transformers runtime with network access disabled during generation.
- Markdown context packs are ZIP artifacts with fixed members. Manual mode
  validates and preserves exact Markdown in `context.md`. Source mode
  semantically chunks, groups, and cleans selected material, then either keeps
  those groups with No Summarization or generates summaries with an explicitly
  selected local model and maximum line count. Model-assisted generation treats
  source text as untrusted data, requires schema-valid output, and accepts only
  citations supplied by the host.
- Runtime completion produces bounded review evidence and a private output. It
  does not create an Artifact Browser record. The user must explicitly Save or
  Discard.
- Both pack modes use the same safe formatted Markdown review. Context
  generation publishes authoritative task progress through the global
  workspace notification center; terminal mutations publish bounded outcomes.
- Save re-verifies the reviewed output bytes and uses a record-last protocol:
  write object bytes, append the workspace catalog record, then create the
  primary binding. A failed catalog or binding step compensates earlier writes.
- The saved artifact identity is its catalog storage key, following existing
  desktop Artifact Browser conventions. Saved context artifacts are ordinary
  local artifacts and may later gain explicit publication or system-use
  relationships without changing this generation decision.

## Consequences

### Positive

- Dataset-to-context conversion retains exact selected artifact identity and
  persisted chunk lineage when it exists.
- Both output formats are portable, inspectable, and independent of renderer or
  provider protocols.
- No generated context becomes visible or durable merely because runtime work
  completed.
- Runtime, application, storage, catalog, and UI responsibilities remain
  separated by existing ports.

### Negative

- Source and output bytes are hashed more than once at trust-boundary changes.
- LanceDB vectors and Markdown source chunks duplicate selected source content
  by design and therefore inherit its access and retention requirements.
- A portable LanceDB package adds bounded packaging and private extraction work,
  and the embedded database requires an exact managed native Python dependency.
- Record-last compensation cannot provide a distributed transaction if a
  backing store is externally unavailable; failed cleanup remains an
  operational reconciliation concern.
- Physical local-model qualification depends on suitable locally installed
  embedding and text-generation models.

## Compatibility and recovery

Unrelated application SQLite persistence, system-runtime SQLite databases,
datasets, and Markdown context packs are unchanged. The pre-release SQLite RAG
format is intentionally unsupported and has no migration path because there are
no deployed users. Rollback may stop advertising the Context task and remove
the Context navigation without rewriting saved LanceDB packages. Private staged
output is always disposable. Saved context artifacts remain ordinary catalog
objects and can be deleted through the existing artifact lifecycle.

> AI documentation reminder: when behavior in this area changes, update the
> related ADRs, architecture docs, context packs, threat model, and README files
> in the same change.
