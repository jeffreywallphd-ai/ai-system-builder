# ADR-0048: Revocable Window Presentation Authority

- Status: accepted
- Date: 2026-11-14
- Deciders: repository owner, by approval of the merged Headless roadmap
- Related: ADR-0003, ADR-0015, ADR-0029, ADR-0047

## Decision

The app owns one transient presentation reservation per registered window.
The transport authenticates the interactive document and supplies an owner for
its exact current host, window, UI incarnation, and workspace. The existing
agent grant supplies organization, principal, client, verified session, and
current workspace permission. An agent request can create a prompt. Only the
owning interactive document can accept it and signal readiness for that lease.
The application rechecks current policy and the exact reservation after any
asynchronous read before committing the transition.

The contract accepts only canonical identifiers for a request, attempt, lease
and generation. A presentation request has a separate retry key scoped to
the verified agent and session. Changing its task or window target is denied.
Revocation is exact, including the attempt
before the lease identifier is known. Ended reservations cannot be revived.

The initial host policy admits up to 32 windows, 256 current and retained
requests and 16 concurrent policy reads. Requests time out after 60 seconds,
readiness after 10 seconds, and active leases after 15 seconds without an exact
authorized renewal. Terminal targets are retained for 60 seconds for exact
retry. Expired records and unknown IDs grant no authority. A
new request admission must commit within five seconds of its initial policy
check. Authorization readings that take longer cannot create a new prompt.
Use the host's monotonic clock for all deadlines. Host startup creates new
window and host identities. A workspace switch or main-frame reload
retires the corresponding document. After user revoke, any new request must
come from a fresh user instruction.

Window control grants the finite saved-resource presentation actions and
identifier-only context defined by the roadmap. Window context uses its
own publication fence. Saved-system reads and independently owned tasks retain
their existing authorization and lifetime. Only finite metadata leaves the
application boundary. The interactive transport must independently recheck
current workspace permission before returning even pending task and session
identifiers. Desktop checks workspace and membership in one local transaction.
It checks the exact live reservation again before returning acceptance or
readiness to the owning frame. The renderer discards poll results from earlier
local states. A busy poll leaves the current state intact. A denied poll
returns the window to manual control. Each exact revoke has at most one
outstanding IPC call, with up to 32 held calls and a 60-second local retry
record. A held call does not delay another attempt's revoke.

The desktop opens consent in the shared, portaled dialog, above any existing
dialog. The user can decline with Escape, the close button, or the initial
focused action. A dirty draft adds a save decision in the same dialog.
Once accepted, the shell keeps a fixed revoke control and ordinary dialogs
keep their own reachable revoke control. Consent and revoke status do not
add a row to the shell layout.

The presentation queue admits five fixed saved-resource intents. Every
command has a lease-scoped ID, increasing sequence and five-second deadline.
The host retains up to 256 command outcomes and up to 32 unfinished commands.
The renderer holds at most 16 positions beyond its current sequence and
requests the missing position. An unresolved gap ends attachment. A terminal
command cannot repeat its effect on retry. Preparation may await resource
reads, then the renderer calls the exact current effect synchronously.
A delivered command without an acknowledgment has an unconfirmed outcome.
Only an exact acknowledgment from its still-owned renderer resolves that
outcome. The host never delivers that sequence again.

The paired desktop connector exposes a separate finite window operation
family. Only the explicit presentation pairing can request control. That
dedicated registration is the stable identity of a chat
client session. A caller cannot select that identity in a request. The app
checks the exact current workspace and resource permissions for an intent,
including artifact and runtime read scopes as applicable. The desktop uses
the already-owned workspace, record, artifact catalog and run services.
The interactive app may show a bounded saved-resource detail. The connector
receives only an identifier projection, with an exact current lease check
after asynchronous reads and before the response is written.
Each context read and renewal requires a new 750 ms challenge response
from the current renderer. Stale or cached editor state cannot answer a new
request. The deadline is checked when the host consumes the response and
again when it publishes context or renews a lease. A renderer that already
sent an answer cannot recall it. Once the user revokes, the renderer answers
no new challenge. The renderer commits the bounded detail view before acknowledging
application. Revoked registrations and dialogs keep their exact owner.

## Local audit

Desktop writes fixed request, acceptance, activation, revoke, delivery and
receipt events to the existing local security audit port. A local revoke
entry means the owning frame's revoke reached the host. A distinct host
entry records the transition to ended. A lost revoke signal can only be
measured in the interactive document. Independent backend audit labels
distinguish preview, commit and replay from observation of a conversation
handle and an unconfirmed dispatch. Conversation completion remains in the
existing task lifecycle. Desktop stores up to 4,096 sanitized events per
organization, each at most 2 KiB. The event and its capacity counter commit
together. At capacity the store preserves prior evidence and refuses new
entries. The audit writer never delays the local fence.

## Rollback

Stop admitting new presentation requests and retire exact open reservations.
The local revoke gate restores manual control before transport work. Keep
ordinary saved state updates, current application permission checks and
independent work. Never restore a previous lease after restart or rollback.
