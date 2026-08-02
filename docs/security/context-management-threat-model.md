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
