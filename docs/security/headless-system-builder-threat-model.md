# Headless System Builder threat model

Authority: [ADR-0047](../adr/ADR-0047-headless-system-builder-delegation.md).
Scope: the approved desktop connector, shared authoring and receipt boundaries,
revocable window presentation, and later managed parity. This is a design
review; the first contract alone does not qualify any live host.

| Protected asset | Failure to prevent | Owning control and required evidence |
| --- | --- | --- |
| Workspace identity and saved systems | A tool claims a foreign principal, client or workspace; membership changes after pairing. | Host-derived identity and current application checks on every operation, including reads and replay. Test missing, expired, revoked and wrong-scope grants with synthetic records. |
| Credentials and host boundary | A web page or unrelated client reaches the loopback listener. | Desktop owns binding to a literal loopback address and rejects other Host and Origin values. Explicit trusted pairing, one-use codes, bounded attempts and request sizes, authenticate each request and store credentials through the existing secure boundary. Test admission, expiry, shutdown and sanitized failures. |
| Immutable revisions and human drafts | A stale edit commits or a background refresh advances the draft's save base. | Application owns revision checks, preview has no side effect, drafts have immutable bases and refetch is scoped and fenced. Test stale writes, delayed replies, rollback and retention of local edits. |
| Retry receipts and committed events | A retry repeats a write or replays data after access is lost. | Current authorization precedes result lookup; business writes, receipts and event metadata share a transaction where supported. Cap retention, replay and polling; test commit, rollback, reconnect, restart and permission loss. |
| Window and live context | An agent grants itself control or a delayed update takes effect after revoke. | Separate interactive authority, exact window/session/lease checks and a synchronous local fence before each effect and before publishing new context. Use a finite command catalog and sanitized metadata. Test explicit accept, revoke, wrong window, late delivery and disconnect. |
| Diagnostic and user content | Tool output supplies instructions, credentials or private drafts. | Treat all returned content as data. Do not expose secrets or raw internal diagnostics. Require fixed failure codes, bounded projections and content-free evidence. |

The initial decoder accepts only known versioned read operations, a canonical
host incarnation and explicit resource targets. It rejects extra fields and
uses fixed failure codes. It operates on already bounded decoded data; a future
transport must enforce frame size, duplicate-field policy, identity and rate
limits before it dispatches any request. A well-formed request is never a
grant. The internal desktop dispatcher requires a grant returned by its
trusted caller and checks local identity, exact scope, current policy and
host shutdown state. It returns selected workspace, template and saved-system
metadata only. The internal credential adapter stores an organization-scoped
registry with at most 32 registrations. A pairing code has 256 random bits,
expires after two minutes, and is consumed after one completion or five
attempts. Bearer credentials have 256 random bits and expire after seven
days. Only domain-separated digests persist. The client ID is independent of
the digest, and remains stable while the same credential reconnects after a
desktop restart. Revoke removes the exact registration; it does not remove
any retry records. Unexpected persistence content or unavailable storage
denies admission. The test uses an isolated local SQLite database and no
actual user credential.

The authoring grant requires a new pairing with a separate native editing
confirmation. Older records and the original workspace-only request grant
read access only. The trusted pairing flow checks current workspace read and
write authority before issuing and exchanging an editing code. A pending
revoke fences in-flight grants immediately; an uncertain registry update
keeps that client denied until the host rereads saved state after restart.
The grant excludes all window control and privileged operations. The authoring
transport and its Settings entry point are wired separately.

The separately tested transport binds an OS-assigned port to literal
`127.0.0.1` and accepts only exact Host, no Origin or forwarding headers,
and POST to its two fixed paths. It accepts up to 8 KiB of compact UTF-8 JSON
and rejects non-round-tripping framing, including duplicate fields. Read
requires a verified bearer. Pairing completion can consume only a code
already issued by the interactive authority; it cannot begin pairing.
The caps are 16 connections, eight concurrent admitted requests, 128
admissions per one-second window, 8 KiB of headers, 128 KiB of response,
and a five-second I/O and shutdown wait. Shutdown fences new calls, closes
owned sockets and waits for admitted work; timeout is not proof of cleanup.
Desktop Settings starts the listener only after native confirmation from an
owned foreground window. Pairing validates the exact workspace and confirms
its current label and ID; the native dialog alone shows the code. The app
rechecks the exact foreground window and main frame during interactive
admission. Both start prompts tell the user that existing authorized clients
can reconnect once the shared listener starts. The preload
returns fixed outcomes and projects only the connector address and bounded
client metadata. Restart leaves the listener off; existing authorized clients
can reconnect after an explicit start with no new pairing. Closing the desktop
retires the listener before persistence. This does not grant write or window
control, or qualify packaged-host MCP delivery.

The internal edit decoder admits only exact add, configure, connect, move and
remove operations on a batch of 1–24 edits. It captures passive input before
parsing and binds the host incarnation, workspace, system, record revision and
composition revision. Apply additionally requires a preview digest and an
idempotency key. This shape check grants no permission; workspace access,
asset/configuration/placement policy and atomic writes remain application
responsibilities. No connector write operation is enabled by the decoder.
Asset versions are literal identifier values, including prerelease or build
metadata. Floating aliases, ranges and path forms are unavailable. The
application still has to resolve the exact version in the granted workspace.
The desktop admits up to four concurrent management operations. It fences and
drains them along with socket work before releasing persistence; a timed-out
drain remains pending for an explicit retry.

The stdio MCP adapter accepts a literal loopback HTTPS address, its current
certificate fingerprint, and a credential only from its trusted launcher.
The desktop makes a new in-memory certificate at listener startup. Native
pairing and Settings display the fingerprint. The adapter releases no HTTP
bytes until the same TLS socket proves possession of the pinned key. A stale
port or untrusted replacement listener receives no credential. It exposes
five strict read tools and cannot
receive a URL, credential, or arbitrary command through them. It uses no HTTP
proxy or redirect, limits four active forwards, limits each to five seconds
and 128 KiB of result, and validates fixed result fields before returning
them. The SDK bounds its stdio read buffer to 16 KiB; the adapter caps eight
unanswered requests, four pending writes and 256 KiB per response. It closes
on overflow. Incoming responses and unused notifications are discarded. An
initialization notification is admitted once and cancellation is bounded by
outstanding request IDs and actual response progress. The desktop tracks raw
sockets through TLS negotiation and destroys them on listener shutdown.
The in-memory pin protects against a different local listener,
not compromise of the app, trusted launcher or OS account. Client secret
enrollment, packaged host and managed delivery need separate qualification.

Managed parity must recheck existing OIDC, membership and row-security
authority, including for streams, receipts and worker replay. Neither synthetic
tests nor localhost timing qualify production deployment. Compromise of the OS
account or trusted host remains outside the protection claim. Revocation cannot
recall context already delivered. Rollback disables the connector and
presentation routes, invalidates their grants and preserves committed data,
ordinary UI access and evidence.
The internal operation store partitions receipts by verified organization and
hashes the complete principal, client, workspace, operation and key scope.
Receipts hold a fingerprint and the minimum saved revision reference; change
entries hold only workspace-scoped system and revision identifiers and a
sequence. The store checks the host's synchronous authorization fence
around its transaction and replays. The application must separately check
current resource authority before lookup and before any response leaves the
host. After result expiry the retained key stops another write; capacity
exhaustion and unknown outcomes require reconciliation.
The optional authoring route uses the same pinned literal loopback listener
and frame limits. It accepts only the finite authoring contract and requires
an explicit writer grant for the exact workspace. Before the response, it
rechecks current registration and its synchronous grant fence. The response
admits only fixed errors, bounded preview consequences, and saved revision
references. This adapter does not activate the authoring route by itself.
Desktop authoring rechecks the existing organization policy and saved
workspace status inside the owning SQLite transaction, using the same
platform and organization views as the application. This prevents an earlier
authorization result from surviving a workspace or membership change that
commits first. The outer admission and response still check live policy.

The read-only saved-system feed authenticates opaque cursor tags with a private
host-incarnation key. Tags bind the organization, workspace, registered client
and sequence. A cursor is never authority: snapshot and replay recheck the
current paired grant and workspace policy before returning data. Cross-scope,
old-host or retired cursors require a new snapshot. Results are bounded saved
references and status; the feed never carries draft data, secrets or UI state.

Headless workflow metadata rechecks the same exact workspace before and after
the existing use cases run. A fixed profile and action allowlist omits
deployment, mutation and execution. The projection does not relay private
labels, defaults, transcripts, record values, artifact previews or errors.
Fields marked sensitive or referring to secrets remove the entire action
from the projection.
Preparation of a reviewed conversation can also return a bounded list of
approved session identifiers to a current conversation grant. It includes
only sessions the existing read model marks ready for a new message. It does
not return labels, transcripts or approval records. The list is advisory. The exact
plan, session, approval and runtime are checked again before dispatch.

The internal conversation dispatch reservation separates current permission
to observe from permission to start a new turn. Observation leaves an
absent key and its capacity unchanged. The owning transaction rechecks
dispatch policy before reserving a new key. The caller checks the grant
before passing the detached prepared target and fence to trusted submission,
and checks observation again before returning the result. The future
invocation owner must enforce the same exact target and live fence. A
pending reservation cannot dispatch again after a crash or uncertain reply.
The host-keyed receipt stores no prompt or reply text. A confirmed receipt
stores only the turn and run identifiers with the fingerprint and expiry.

Approved conversation execution uses a separate native desktop consent. The
dialog discloses saved-system read access and sending turns to approved sessions.
Existing read and edit registrations do not gain execution permission. The
host shows the option only when it supplies the application access callback.
Issuing, exchanging and verifying conversation credentials requires current
workspace policy. A missing or unavailable callback denies the credential, and
revocation during verification invalidates the pending grant. Actual dispatch
must still recheck the current workspace, client and session approval. This
change leaves conversation dispatch unwired.

The optional approved-turn route is absent unless the host provides a handler.
The pinned loopback transport requires a current conversation grant for the
exact workspace and host. Its strict request excludes approvals, privileges,
providers and runtime controls. A credential-derived, domain-separated HMAC
binds the receipt to the same verified registration; neither the credential nor
message text enters the receipt. The response contains only turn/run IDs or a
fixed error and is suppressed after grant loss. The stdio launcher advertises
the tool only by opt-in, grants no additional permission, and does not
automatically resend an uncertain request.
The authenticated request is admitted only while its connection is open.
Once admitted to the trusted handler, registration and workspace policy,
not the HTTP socket, govern the host-owned conversation task. Disconnects
cannot disclose a result and do not themselves cancel a saved task.

Delegated turn admission carries an in-process policy callback and the
exact saved target. The callback is never sent to the worker. The SQLite
owner compares the saved session and approval and reserves the operation ID
in the same transaction as the initial transcript and lifecycle records. A
failed commit fence rolls those writes back. After asynchronous runtime policy
checks, the owning store compares the same session and approval snapshots in
one no-write transaction. The adapter checks the live grant before task start.
These checks protect admission. They do not cancel a task already started.
