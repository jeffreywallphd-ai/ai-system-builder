# Filesystem Artifact Store Adapters

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`createFilesystemArtifactObjectStorageAdapter` is the canonical filesystem-backed
`ArtifactObjectStoragePort` implementation for host-local artifact bytes.

`createFilesystemArtifactStorageAdapter` remains as a backward-compatible alias.

`createLocalArtifactCatalogPersistenceAdapter` is the local artifact-catalog
persistence adapter that owns append/browse/read catalog-record behavior.

`createFilesystemArtifactBrowserReadAdapter` is an artifact-browser read adapter
that depends on the catalog seam for metadata reads and optional storage presence
checks for content descriptor availability.

`createFilesystemArtifactContentRetrievalAdapter` is a separate media-view
retrieval adapter for actual image bytes used by viewer rendering paths.

Current behavior:

- stores artifact bytes to disk under a configured root directory,
- appends image metadata via injected artifact catalog append port,
- serves artifact browser browse/detail/content-read from artifact catalog records,
- keeps browser contracts storage-key based and path-agnostic,
- keeps `artifact.content.read` descriptor-oriented,
- serves actual image bytes through the separate `/artifact/media/view` retrieval path.

Desktop and server inject the local binding writer for fresh generated upload
keys. A verified new buffered or streamed upload records its workspace-owned
primary local binding before catalog success. Missing workspace/catalog or failed
binding persistence denies the operation. Persisted catalog/binding identity is
checked before publication and again before binding; metadata-only collisions
deny too. Final create-if-absent operations use each owning metadata CAS and
refuse an older or unsupported conditional writer. Request key/workspace/overwrite are captured before awaits, and a fresh
binding always uses no-overwrite publication. Explicit-key writes do not adopt a
binding, and preparation still rejects missing/foreign bindings before source I/O.
Publication is not a metadata transaction: a failed or uncertain metadata write can
leave unregistered owned bytes for normal recovery; it never reports success or
deletes unrelated files. Native publication/parent-substitution qualification
remains separate from these cooperative ownership checks.

Resumable local-file tasks use `createFilesystemIngestionFileByteStorageAdapter`
through the private application publisher. It inspects bounded checkpoint content
before reservation and checks exact EOF size/SHA before exclusive target linking.
Each incoming chunk uses its intrinsic byte length for admission and a private
copy of exactly that size. Instance size accessors cannot weaken the bound;
shared growth beyond the admitted copy denies before publication. Hashing and
writing use the same private bytes.
Its opaque task-owned key cannot overwrite an existing file, and post-publication
errors never delete the target. It writes no binding/catalog itself: the publisher
conditionally records exact metadata only after durable byte acknowledgement
and its one successfully acknowledged origin-issued CAS. Retries never recreate
missing or deleted metadata; complete exact existing origin can be verified.
Desktop retains its existing object path; server captures its organization prefix.
Unknown writing stays retained and cannot be resumed as byte authority. These
cooperative file checks do not qualify hostile native races or crash recovery.

The exported ingestion byte-storage component can be tested separately from the
publisher and hosts. It checks workspace scope and finite byte limits before it
reads a stream. Inspection creates no target. Publication checks the complete
size and digest before publishing the final target, preserves existing targets and returns
sanitized failures. Its synthetic tests cover these component behaviors only;
they do not qualify the complete ingestion workflow, native file races or recovery.

`createFilesystemContextResultByteStorageAdapter` reuses the private verified
stream mechanism for generated Context bytes. It permits only the two Context
archive media types, a nonempty size up to the existing 64 MiB artifact limit,
an exact SHA-256 and a 32-character lowercase hexadecimal publication identity.
The byte key is derived as `workspaces/<workspace>/artifacts/context/<identity>`.
Server composition can supply its existing organization context provider; the
publisher captures scope before producer or writer awaits. It writes no catalog
or primary binding and never deletes a published target after an uncertain
acknowledgement. There is no existing-object adoption or overwrite mode.

The shared helper copies each intrinsically bounded chunk and verifies complete
EOF size/hash before the contained writer links its final target. Existing
ingestion normalization, bounds, namespace and result contracts remain intact.
These component checks do not qualify native races, crash recovery, the owning
Context task/review admission, metadata commit or public save/query workflows.

`createFilesystemContextResultOutputSourceAdapter` reads a private output chosen
by the existing Context task owner. It rejects traversal, links, non-regular or
multiply linked files and mismatched size/identity before streaming. It reads in
bounded 64 KiB chunks and permits at most one excess-byte observation; complete
file facts are checked again at EOF. No filesystem discovery, write, deletion or
adoption is available. The reader closes its handle when the consumer finishes,
fails or stops. The owning use case must not accept its directory or handle from
a client, and native parent-substitution/crash qualification remains separate.

`createFilesystemTrainingResultFileByteStorageAdapter` is a separate internal,
per-publication training byte publisher. Explicit file/count/total payload bounds
have no defaults and do not prove measured disk capacity. It captures its
publication identity and first valid workspace/organization scope. Files use
private `artifacts/training-results/<publication>/<index>` keys, two finite
container media types, exact nonempty size/SHA and the existing verified stream
and exclusive contained writer. Copies are serial; each accepted index is one
use. Invalid scope, malformed data, duplicate, concurrent and over-budget calls
consume no source. An accepted uncertain write fences the whole publication and
retains declarations; it cannot overwrite/adopt or compensate a published target.

This component writes no catalog, binding or Model record and offers no read,
delete, recovery or Save capability. It keeps the contained writer's existing
pre-publication temporary-file handling. Declarations and acknowledgements are
local software facts, not complete Native custody, physical allocation, hostile
race/crash proof or global settlement. The owning coordinator still needs actual
reserved capacity for both copies, original source guards and transfer lineage,
fresh permission, separate Save and final worker/host qualification. No production
producer or public Root is configured by this component.
