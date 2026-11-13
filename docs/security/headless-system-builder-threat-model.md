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
actual user credential. The adapter is not yet wired to a listener or UI.

Managed parity must recheck existing OIDC, membership and row-security
authority, including for streams, receipts and worker replay. Neither synthetic
tests nor localhost timing qualify production deployment. Compromise of the OS
account or trusted host remains outside the protection claim. Revocation cannot
recall context already delivered. Rollback disables the connector and
presentation routes, invalidates their grants and preserves committed data,
ordinary UI access and evidence.
