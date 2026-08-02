# Context Management Application Use Cases

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This area owns the workspace-scoped lifecycle for generating RAG databases and
portable Markdown context packs from cataloged artifacts or bounded manual
context.

`ContextGenerationUseCase` is the authority boundary between transport hosts,
artifact storage, and the runtime task registry. It:

- requires `artifact:read` for start/read and `artifact:write` for
  save/discard/cancel;
- resolves every artifact through the authenticated workspace before staging
  exact bytes in a private temporary directory;
- validates shared source capabilities, request limits, source digests, task
  ownership, contained result paths, and result digests;
- exposes successful runtime output only as a review-required candidate;
- writes durable bytes, an artifact catalog record, and a local binding only
  after explicit save; and
- compensates partial save failures and removes staged output on discard,
cancellation, or terminal validation failure.

`ContextBrowserUseCases` owns the saved lifecycle: workspace catalog listing,
exact-byte and digest verification, safe runtime inspection, source freshness,
bounded RAG test queries, source-only rebuild, and registered-artifact deletion.
Each RAG database remains one cataloged artifact blob with media type
`application/vnd.ai-system-builder.rag-database+lancedb+zip`; its embedded
database directory is internal package structure, never a storage root or
global singleton. The pre-release SQLite RAG format is rejected and is not
migrated. Unrelated application and system-runtime SQLite persistence is outside
this feature boundary.
`ContextManagementCommandUseCase` is the single typed facade used by desktop
IPC and server API clients, including bounded generation/retrieval task lists.

Renderer selection and navigation state are not authorization. Public results
and diagnostics contain only bounded metadata, counts, lineage, and safe reason
codes. Source text, prompts, embedding vectors, model output, credentials, and
runtime paths remain outside public application state.

See `docs/architecture/context-management.md`, ADR-0041, and
`docs/security/context-management-threat-model.md`.
