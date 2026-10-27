> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

## Governed ingestion HTTP admission

Only exact `POST /api/ingestion/tasks/execute` is admitted, under existing
`artifact:write` scope. This coarse writer gate includes read/list actions on the
multiplexer; it does not introduce a read-only task API. Normal authentication and
organization middleware run before parsing. The owning application still checks
the authoritative organization, workspace and exact task/file on each action.
Other methods, substituted paths and unsupported task families remain denied.
Real HTTP tests cover missing/invalid tokens, reader scope, organization and task
workspace substitution, malformed commands and complete local-file publication.
They use synthetic token verification; the real host UI journey separately uses
the normal generated device credential. Neither substitutes for native or provider
qualification. Rollback denies the route rather than skipping authorization.

### Assets desktop sender admission

All package, Studio and authoring IPC handlers use the existing synchronous
main-frame policy supplied by the desktop host. Admission runs before request
metadata, payload validation or deferred feature resolution. Missing, throwing
or nonboolean policy results fail closed with fixed forbidden text. Fixed request
and response descriptors preserve operation identity; trusted requests continue
through their existing validation and resource controls. Sender trust does not
grant workspace, publication or execution authority.

The `asset-authoring-ui` profile includes finite all-channel denial, trusted
pass-through, actual host composition and API/IPC parity tests. These tests use
synthetic events and do not start Electron, models or provider requests. Real
host identity, resource authorization, persistence and overall qualification
remain separate.
