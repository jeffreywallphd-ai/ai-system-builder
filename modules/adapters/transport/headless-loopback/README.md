# Desktop headless loopback transport

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

The transport binds an OS-selected HTTPS port on 127.0.0.1 and generates a
certificate for that listener only. The client verifies the exact SHA-256
fingerprint supplied by the desktop before the request attaches to the TLS
socket. It accepts compact UTF-8 JSON over POST at fixed routes for one-use
pairing, finite reads, and capabilities that the host has enabled. Requests
after pairing require the scoped client credential.
Each read also receives a trusted HTTP lifetime fence. Source inspection checks
it after asynchronous authorization and immediately before lazy SDK, credential
and provider access. A disconnected or finished response cannot start late
provider work. This ephemeral fence is separate from registration authority and
does not cancel independently accepted business tasks on client disconnect.
Requests with another Host, an Origin, or forwarding headers are denied.
Do not use the connector through a browser, reverse proxy, or remote relay.

The optional plan-review route accepts plan submission and status reads.
Its separate credential is scoped to one workspace. The status response shows
the exact proposal fingerprint, current decision, expiry, and approved step
count. The agent must use a verified human approval channel for any decision.

The companion `/aisb-headless/v1/plan-step` route accepts the exact host,
workspace, proposal fingerprint, approval revision and step number. It runs
only the next approved saved change. A repeat with the same approval returns
the saved receipt. A skipped step or a changed approval needs a fresh status
check. The app reads the operation details from its saved plan. Desktop
enables the two routes for paired plan-review clients when the app owns the
platform transaction. A decision withdrawn after a saved change stays
withdrawn, and the connector withholds that step's reply.

The adapter limits connection count, header and body bytes, request admission
and concurrent requests. Shutdown closes admission and sockets and waits for
admitted work before allowing persistence teardown. The desktop separately
closes its in-memory authority during app shutdown. If the wait expires,
shutdown is unconfirmed and can be retried. No request or bearer bytes enter
logs. The app starts the connector only after explicit desktop confirmation;
see ADR-0047 and the Headless System Builder threat model.
