> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

The managed headless agent adapter declares exact POST read and author routes
under the existing organization API policy. The host must provide active
handlers before the routes accept an agent. A distinct verified client,
explicit organization, compact JSON and a current request are required.
The adapter bounds input, response size, active requests and time. The
shared application service owns write scopes and the saved-result receipt.

Managed browser consent uses a separate exact POST route. It requires the
configured HTTPS browser origin, same-origin fetch metadata, the verified
browser registration and current workspace access. After registration, a
private tab proof in a header identifies the exact document. Responses
are uncached and the route cannot grant access to other application data.
Separate delivery, acknowledgment, context challenge and context publication
POST routes accept only the exact active lease. Polling retains bounded audit,
while acknowledgments and publication use the standard audit path. Replies
recheck current authority, use the browser proof, and retain the origin and
request size limits.

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

Headless Model cancellation uses only exact
`POST /api/headless/agent/model-task-control`, under workspace read and Model
read/write scopes. An explicitly configured host handler and the original
plan-review registration are required. This is separate from read routes.
Copy the selector and validate finite owner-derived lineage before publication.
Capture the original authority callback before body parsing and require immediate
boolean true at admission, dispatch and publication. Callback replacement,
promises, thenables and exceptions cannot restore authority.
Validation, missing-handler and host errors are definitive only before handler
entry. The same errors returned after entry are unconfirmed.
A thrown or malformed post-dispatch result is unconfirmed; withdrawal suppresses
disclosure. No acknowledgement proves native shutdown/cleanup or grants retry.
Default missing handlers cannot dispatch. Existing framing, concurrency,
authentication, organization and request-lifetime bounds remain intact.
