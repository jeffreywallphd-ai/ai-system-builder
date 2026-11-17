# Artifact catalog and bindings

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Existing append/upsert/read/delete behavior remains compatible. Fresh upload
origins use the separate create-if-absent methods, backed by structured-document
revision CAS. Each retry checks identity inside the mutation, preserves unrelated
raw records and rejects duplicate, tombstoned or malformed state. The selected
organization store is fixed before asynchronous work; no default owner is added.
JSON compatibility journals cannot supply this capability and fail closed.

Catalog and binding publication are separate operations. If one succeeds and the
other conflicts or cannot be confirmed, the upload fails and retains its partial
owned state for recovery. This is not a cross-record transaction or native
filesystem race qualification.
