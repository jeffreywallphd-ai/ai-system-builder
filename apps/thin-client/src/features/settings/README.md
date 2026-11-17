# Thin-client Settings

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

The page uses the existing secured application-settings and server-restart
endpoints. The backend still authorizes actions and stores secrets through its
secrets port. API admission requires a successful HTTP status and envelope,
valid consumed rows, masked secret metadata and the captured mutation key/state.
Unknown private messages and details do not enter public errors or notifications.

Each committed client/view owns its reads and actions. One Save, Clear or restart
is admitted synchronously. Late results cannot replace a newer read or start
follow-up work after the view closes. Closing the view does not cancel a write
already accepted by the server.

Save and Clear succeed locally only after successful current readback. A refused
write retains the draft for retry. An initial or post-change read failure exposes
**Refresh settings**; uncertain readback prevents another mutation until that
read succeeds. Outcomes use the notification center; local progress/retry stays
beside the form. Canonical pairing and permission guidance is preserved.

A 202 restart acknowledgement means **Server restart requested**, not restarted
or reconnected. An explicit successful refresh is required before another action.
Shared fields preserve secret-draft revisions and accessible label/help behavior.
No folder picker, model resolver/download API, real credential or provider is
introduced. Focused UI/protocol fixtures do not qualify physical restart,
reconnection, credential storage or final cross-roadmap testing.

Save and Clear confirm the canonical acknowledgement against the next read.
Supported public values must agree; submitted values can be normalized by the
server. Model comparisons use only the five supported fields and their existing
defaults. Secret confirmation uses masked configuration state only.
