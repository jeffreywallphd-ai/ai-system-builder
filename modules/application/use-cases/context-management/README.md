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

Status transport failures retain active task identity, staging and power for
retry. Host-owned reconciliation validates successful output into review state
without a page read; it never saves that candidate automatically. Terminal
cleanup retains its owned directory until removal succeeds.
`ContextManagementCommandUseCase` is the single typed facade used by desktop
IPC and server API clients, including bounded generation/retrieval task lists.

Renderer selection and navigation state are not authorization. Public results
and diagnostics contain only bounded metadata, counts, lineage, and safe reason
codes. Source text, prompts, embedding vectors, model output, credentials, and
runtime paths remain outside public application state.

See `docs/architecture/context-management.md`, ADR-0041, and
`docs/security/context-management-threat-model.md`.

## Acknowledged save compensation

Saving first requires an unused catalog identity. A refused or mismatched storage
acknowledgement does not grant deletion authority. An exact successful write owns
its new key for compensation, including any record already appended by the
filesystem adapter. A later Context catalog failure removes that record before
removing the acknowledged bytes, so ordinary retry does not leave a dead entry.

If catalog or object cleanup is unavailable, retain the exact current-owner key
and reviewed output. Save, Discard and Cancel retry that cleanup before any new
write or terminal release. They report an unavailable result until it succeeds.
This recovery record is transient application state. It does not adopt old files,
recover after process restart, establish native atomic ownership or qualify
unknown retained offload data. Existing binding/storage and native qualification
limits remain separate.

Composed both-client UI tests cover late catalog refusal, storage refusal, catalog
identity denial, exact-byte correction and cleanup outage/retry in new local
fixtures. Worker and inspection results are synthetic; actual model/runtime,
physical host and final combined qualification remain pending.

Save returns only fixed application-owned public messages. Arbitrary filesystem
and port exceptions use a generic failure. Refused storage, catalog and binding
results use fixed step messages without port text or details. Existing public
catalog/binding messages remain compatible. Cleanup still runs before failure;
a retry retains the same private review until its save succeeds.
