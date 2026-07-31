> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Dataset preparation exposes authenticated asynchronous lifecycle routes:

- `POST /api/dataset-preparation/start`
- `GET /api/dataset-preparation/tasks/:requestId`
- `POST /api/dataset-preparation/tasks/:requestId/approve`
- `POST /api/dataset-preparation/tasks/:requestId/cancel`

The central deny-by-default route policy assigns artifact write/read/write
scopes respectively, including artifact write for approval. Handlers derive principal and organization context from
security middleware, normalize workspace context, return sanitized envelopes,
and delegate ownership and business rules to the application use case.

Governed Add data tasks use `POST /api/ingestion/tasks/execute`. The body carries
an explicit workspace id plus one normalized acquisition command. The central
route policy requires authenticated artifact read/write scope as appropriate,
the global JSON ceiling bounds the request, and append commands are additionally
limited to the recommended 1 MiB transport chunk. Byte arrays are reconstructed
as `Uint8Array` by the shared contract. Task/source ownership, progress,
cancellation, refresh, and cleanup remain application responsibilities.
