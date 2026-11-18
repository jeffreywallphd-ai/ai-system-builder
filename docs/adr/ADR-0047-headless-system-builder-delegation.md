# ADR-0047: Delegated Headless System Builder Access

The approved Data handoff extends the same finite presentation protocol with
exact source/file/revision, dataset/version/digest and accepted task intents.
It adds no generic navigation, filesystem, provider or task execution tool.
Both hosts reuse the existing consent, current artifact-read policy and display
delivery fences. Accepted transient task lookup requires the same actor and
host before lazy Data access; a distinct presentation registration cannot gain
the original plan client's execution, status, review or save permission. The
interactive resource panel shows bounded metadata; connector context remains
identifier-only. Revocation leaves independent business work intact.

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

The opt-in managed saved-state routes reuse the same bounded journal and
application replay use case through existing OIDC and organization authorization.
The host pairs each cursor with the verified principal and organization,
workspace and current worker incarnation. A different worker or a restart
requires a fresh scoped snapshot. Polling and the short-lived authenticated
application stream return saved metadata and do not grant agent editing or
interactive browser authority.

Managed admission can distinguish registered OIDC clients through the issuer's
signed `client_id` claim on a typed access token. The existing verifier first
checks signature, issuer, audience and expiry. The optional client identifier
grants no application permission. Existing ordinary OIDC calls keep their
current behavior. Interactive document ownership needs its own proof.
See [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068.html).

The thin client consumes authenticated saved-state checkpoints. It binds
each passive list and downstream saved-revision read to the current tab
and connection. Hide, disconnect, credential replacement and resync retire
that ownership. Refresh leaves an open Composer visible if its saved
system is archived elsewhere, and disables saving or building it.

The managed host can resolve separate agent and browser registrations from
its trusted issuer configuration. Partial or identical registrations fail
closed. The request supplies an explicit organization selection that must
match the authenticated organization context. The host derives a stable
registration identifier from the issuer and configured client for receipt
scoping. A match classifies the request for later policy checks.

When managed agent access is enabled, the agent routes and saved-state feed
share the same server incarnation and application providers. Explicit workspace
selection, current policy and the PostgreSQL transaction protect finite reads
and authoring requests. Discovery does not list workspaces.

Desktop and managed hosts have a separate plan-review registration. The
client previews, submits and checks a bounded plan, then requests the next
approved step by fingerprint and approval revision. It receives no direct
authoring, approval, or window-control grant from this registration.

The user can approve the scoped plan or each change in the app popup or
signed-in approval chat. The host verifies the current user and binds the
decision to the exact plan view. All decision channels use the same saved
approval and revision. A client whose chat cannot prove the person's
decision routes them to the matching app popup.

The host commits each approved change with its scoped retry receipt.
An exact retry can recover the receipt under current approval and access.
The host rechecks authority before sending a result. Desktop serializes
this check with its SQLite owner. Managed PostgreSQL locks the exact
permission and approval records through one successful send.

Desktop and a configured Managed host can include a save for an exact staged
file the user selected for that client. The saved-system plan format stays valid. A
plan that includes a file save uses a separate version and shows the
workspace, upload and file references in both approval surfaces.
The plan owner checks current artifact permissions, the app selection
and the approved plan before issuing each write. The owner records its
approval fence with the same transaction as the byte or origin issue.
File work continues through the existing ingestion flow after each
acknowledged issue. An exact replay checks the committed source and
the original issue records. If a run ends after the upload enters
finalizing and before the source commits, the connector reports an
unconfirmed result. Use the existing Data task recovery to inspect
that upload.

A configured Managed browser can stage one local file and record the user's
choice for the registered plan-review client. The Managed connector offers
the same bounded preview and holds the selected task and current
authorization through the PostgreSQL read fence. Approved file saves reuse
the existing ingestion protocol and its exact retry receipt. Direct **Add
data** uses the existing browser import.

Keeping one application owner preserves existing validation and allows a client
to disconnect independently of the UI. It requires durable retry and replay
state and a separate window-control lifecycle. Roll back by disabling the new
admission paths and revoking grants and leases; keep saved systems, drafts,
audit and durable evidence.

Provider file saves use the same exact plan and decision channels. A version 3
preview declares provider reads and the approval view lists use of saved
provider access. The host verifies the selected immutable source and commits
its local source records with a distinct plan effect receipt. Current
authorization protects both commit and replay. Source expiry is checked at
the commit boundary. The effect registers the remote origin. Downstream
localization and dataset preparation remain their own application actions.

Passive dataset inspection uses authorized dataset-version point-read owners.
The fixed tools expose at most 16 selected versions and exact same-dataset comparisons
only to plan-review registrations with current artifact read access. These
metadata-only queries do not initialize model or preparation runtimes and grant
no content export, dataset mutation or publication authority.

The finite dataset-preparation preview uses the same plan-review and current
artifact read boundary. It validates exact completed local source revisions,
provided-row mapping, reproducible split and quality preset through the existing
ingestion point readers. Hosts return only the matching bounded public preview;
compiled commands and storage keys stay private. Preview starts no runtime,
model, provider request or mutation and grants no execution approval.

### Increment 5: finite local dataset tasks

The existing concrete-plan workflow gains an opt-in v4 provided-row dataset step. Both hosts compose the same saved-source compiler, durable once-issued effect and existing dataset processor. This extends the accepted typed application delegation and two-channel approval design; it adds no general runtime-command API. Accepted task receipts and passive status remain separate from result approval, immutable version publication and presentation. Runtime effects stay outside retriable persistence transactions. Uncertain issuance cannot be adopted or restarted. Fixed local input limits, current artifact authority and native lifecycle guards remain independent controls.

An additive opt-in v5 result-save step binds the accepted task, exact quality
report and safe output name. Passive result review returns bounded quality and
split metadata. Separate approval in either existing mode/channel permits one
artifact materialization through the current Data owner. Immutable version
metadata and its causal receipt share one owned transaction after fresh current
plan, role, report and deadline checks. File IO remains outside transactions.
A lost commit acknowledgement permits one exact private-receipt read, never a
publication retry or ordinary-version adoption. Current authority separately gates
the reply. Older plan versions and ordinary Data finalization remain compatible.

Selected instruction/output columns use an explicit provided-only source map.
Legacy `inputField` keeps its existing meaning. The worker derives all canonical
instruction/output aliases solely from the selected columns and omits unrelated
context. Missing selected fields remain a mapping failure. The exact map is
retained in recipe lineage and the approved processing digest.

### Context metadata before execution

The approved Context increment first adds passive `context.models` and
`context.preview-generation` reads on dedicated plan-review connections. Reuse
the existing Context capability/command contracts and owning repositories.
Do not reuse active source inspection, detail or query services for this read:
they can resolve runtime work. Recorded model point reads have a separate port
that cannot fall through to filesystem discovery. Public DTOs contain bounded
identifiers, hashes, sizes, settings and unverified runtime readiness. Exact
saved source/version and model witnesses are private execution inputs, not new
authority. Actual build/query/rebuild/save and revocable display remain separate
increment work under the existing approval and Context lifecycle owners.

The Context owner now has an internal exact-source start admission seam for the
subsequent approved-plan composition. It consumes trusted current-authority and
atomic one-use issue callbacks; no client command can supply those functions.
Unknown dispatch preserves new owned staging without task adoption or retries.
This seam alone neither advertises a new operation nor proves readiness, durable
issuance or actual model execution. Those remain required before public use.

Context processing uses an additive installed-only internal registry/supervisor
path. It reuses existing installation predicates, authentication and owned
lifecycle without invoking ordinary dependency preparation. Missing support or a
failed verifier refuses without an installer fallback. A bounded passive request
snapshot and exact acknowledgement distinguish nonstart from uncertainty. This
implements the existing separation of routine processing and install/download
authority; it selects no new provider, dependency, engine or topology. Both hosts compose this private path with a one-use bound host admission guard
at the actual spawn/POST boundary. Shared worker recovery captures restrictive
policy before owned stop, preserves Dataset protection and uses installed-only
start without an ordinary installer fallback. This extends the existing owned
lifecycle decision; no new recovery owner or provider is selected. Public Context
plan actions and actual model/runtime qualification remain subsequent work.

The approved Context implementation also extends the existing concrete plan with
`context.generate-pack` (preview v6). Both decision channels/modes list no-model
source processing, fixed source/chunk limits and separate result review/save.
A distinct Context reserve/issue/accept record composes with the same root-owned
approval fence and installed-only Context owner; it is not a new execution or
approval framework. `context.task` proves accepted actor/client/host lineage
before processor access and returns minimized progress/review counts. Uncertain
work is never adopted or redispatched. Recorded non-open and unknown license
terms keep their meanings. Initial active support is source-derived Markdown;
active RAG, Context save/query/rebuild/presentation and parent qualification
remain later work. This adds no installer, provider or model-download authority.

### Recorded Context embedding model references

The approved existing-Context-owner extension also permits an internal saved-
model witness and existing-file resolver. Application code owns current model
and actor checks; the filesystem adapter owns bounded configured-root inspection.
Only trusted host composition supplies a runtime-only local model reference.
The existing embedding engine loads local safe weights without remote code or
installer fallback, while portable manifests retain the logical model id only.
Ordinary UI loading is unchanged. This adds no provider, engine, topology,
native custody or memory guarantee. Public RAG plan wiring and actual model
qualification still require their own implementation and evidence.
