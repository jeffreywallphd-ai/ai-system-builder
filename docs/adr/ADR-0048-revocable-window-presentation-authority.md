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
identifiers. This initial reservation implementation adds no API, IPC,
MCP, renderer effects or deployed authority by itself.

## Rollback

Stop admitting new presentation requests and retire exact open reservations.
The local revoke gate restores manual control before transport work. Keep
ordinary saved state updates, current application permission checks and
independent work. Never restore a previous lease after restart or rollback.
