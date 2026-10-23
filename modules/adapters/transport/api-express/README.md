> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Dataset preparation exposes authenticated asynchronous lifecycle routes:

- `POST /api/dataset-preparation/start`
- `GET /api/dataset-preparation/tasks/:requestId`
- `GET /api/dataset-preparation/tasks/:requestId/review-page`
- `POST /api/dataset-preparation/tasks/:requestId/approve`
- `POST /api/dataset-preparation/tasks/:requestId/cancel`

The central deny-by-default route policy requires artifact write for start,
approval and cancellation. Task status and the exact GET review-page route require
artifact read. Review-page handlers also require the owning workspace, principal
and current report fingerprint; the application bounds the requested page.
Other review-page methods and child paths remain denied. Handlers derive principal and organization context from
security middleware, normalize workspace context, return sanitized envelopes,
and delegate ownership and business rules to the application use case.

Context Management uses two authenticated command routes:

- `POST /api/context-management/read` for source inspection, generation start
  and status, browser list/detail/query/rebuild, and task list;
- `POST /api/context-management/write` for save, discard, cancel, and delete.

The central policy requires `artifact:read` and `artifact:write` respectively.
Each route also rejects actions belonging to the other route, reconstructs the
shared command contract, injects authenticated actor/workspace context, and
returns sanitized envelopes from the shared application facade.

Governed Add data tasks use `POST /api/ingestion/tasks/execute`. The body carries
an explicit workspace id plus one normalized acquisition command. The central
route policy requires authenticated artifact read/write scope as appropriate,
the global JSON ceiling bounds the request, and append commands are additionally
limited to the recommended 1 MiB transport chunk. Byte arrays are reconstructed
as `Uint8Array` by the shared contract. Task/source ownership, progress,
cancellation, refresh, and cleanup remain application responsibilities.


`GET /api/workspaces/summary?workspaceId=<id>&page=<finite-page-kind>` requires
workspace read scope and delegates to the application workspace/group authorizer.
Unknown request fields/pages are rejected; missing authority or service wiring
returns a sanitized unavailable envelope. Responses contain fixed scalar metrics
with independent availability, never catalogs, model paths or release locks.
