# ADR-0047: Delegated Headless System Builder Access

- Status: accepted
- Date: 2026-11-13
- Deciders: repository owner, by approval of the desktop-first Headless Skills and Revocable UI Takeover roadmap
- Related: ADR-0003, ADR-0015, ADR-0026, ADR-0029, ADR-0037, ADR-0038

## Context

A chat client needs to author saved systems through the host already serving
the app. It also needs a separate way to present results in one window, only
when that window's user accepts. Sharing a database, an admin credential, or
general control of a window would undermine existing authority and draft
ownership. Desktop is the first target; the server and browser follow.

## Decision

- The running desktop host owns System Builder providers, persistence, and
  the optional loopback connector. IPC and the connector use the same lazy
  providers. A stdio MCP adapter forwards a fixed catalog; it cannot start
  a host or runtime on passive discovery or open a data store.
- Explicit pairing from a trusted interactive surface registers one client.
  A one-use, short-lived pairing exchange issues a bounded, revocable
  credential. The host establishes principal, organization, client, allowed
  workspaces and operations. Neither request fields nor selected UI context
  can establish those identities. Current application policy can further
  restrict a grant, including when returning a prior result.
- Separate process incarnation, registered-client identity and interactive
  window authority. A process restart changes the incarnation without
  changing the stable identity used for retry receipts. Presenting work in
  one window requires a separate user action there. Revoke fences the local
  presentation and context immediately; it does not cancel an independent
  backend operation. Agent credentials cannot accept control of a window.
- Admit finite typed operations only. Exclude arbitrary code, URLs, shell,
  selectors, administrator actions, secret access, release, publication,
  deployment and policy mutation. Reuse existing approvals and validation.
- For supported transactional operations, write the resource, retry receipt
  and committed-change event together. Scope receipts to verified
  organization, stable principal, registered client, workspace, operation
  and key. Bind the canonical input and check current authority on replay.
  Delivery is at least once; a gap requires an authorized resync. Saved
  state notifications do not steer navigation or replace a human draft's
  revision base.
- Managed access uses existing authenticated API, membership, application
  policy and PostgreSQL row security. Keep desktop/browser presentation
  mechanisms local to their target. This decision grants no hybrid sync,
  external relay, deployment scaling or work after the desktop host exits.

## Current implementation and consequences

The optional desktop connector shares the UI's existing application providers
and checks the exact host incarnation and current workspace authority. It
stores only credential digests and supports one-use pairing, expiry and
revocation. Desktop Settings asks for native confirmation for read, edit,
or approved conversation access in one workspace. These are distinct
registrations. No listener opens on launch or status reads. The renderer
does not receive the pairing code.

The desktop connector has fixed local routes for pairing, reads, saved
system edits and one approved conversation turn. A trusted client completes
the one-use pairing before the official SDK adapter starts. The adapter
verifies the current desktop certificate fingerprint before forwarding
authenticated read, edit or turn requests. The
conversation path reuses the existing approval, session, worker and task
records; it cannot create approval or change runtime settings. A saved
turn/run handle can return before generation finishes. A later disconnect
does not cancel work the host already owns. Desktop shutdown retires that
work before closing persistence. Window presentation and managed parity
are tracked separately in the approved roadmap. See the
[threat model](../security/headless-system-builder-threat-model.md) and the
[approved roadmap](../headless-skills-ui-takeover-implementation-roadmap.md).

The internal operation store keeps 24 hours of result replay per key. A
known expired key returns a reconciliation response and never runs again.
The bounded receipt namespace accepts 2,048 keys per registered
client/principal/workspace; reaching it denies new writes instead of evicting
key history. The workspace change log retains the latest 256 entries and
returns up to 64 per read. A cursor outside that range requires a fresh,
authorized snapshot. These are local storage bounds. The adapter advertises
tools; the current host and paired registration decide access.

Keeping one application owner preserves existing validation and allows a client
to disconnect independently of the UI. It requires durable retry and replay
state and a separate window-control lifecycle. Roll back by disabling the new
admission paths and revoking grants and leases; keep saved systems, drafts,
audit and durable evidence.
