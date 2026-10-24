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
