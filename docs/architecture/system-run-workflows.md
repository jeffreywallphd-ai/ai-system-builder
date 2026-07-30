# System Run Workflows

- Status: current
- Related decisions: ADR-0023, ADR-0024, ADR-0029, ADR-0033, ADR-0038
- Verification: `npm run docs:check`

## Purpose

Systems Run & Test is a capability-driven interaction surface for exact approved
releases and exact reviewed execution plans. It is not a list of reference
templates and it is not a renderer-controlled workflow engine.

Routine install, activate, start, stop, deactivate, and uninstall controls for
a published build belong to Publish and use the narrower published-lifecycle
facade documented in
[System Build and Release](system-build-and-release.md). The generic workflow
catalog remains an application boundary for advanced capability interaction and
diagnostics, but it is not mounted as a standalone Systems tab and is not the
routine lifecycle interface. No renderer surface may require users to enter
deployment or run identifiers.

## Boundary

The dependency flow is:

1. a host composes application-owned capability handlers;
2. the catalog discovers inert profile summaries for an exact source;
3. the user selects one available profile;
4. preparation reads only that profile's bounded snapshot;
5. an explicit action submits normalized scalar values and, when required,
   confirmation;
6. the handler delegates to the existing authoritative use case and returns a
   new bounded snapshot.

Discovery is read-only. Preparation and invocation both re-check exact source
identity. Approved releases use release ID plus release digest. Reviewed
execution plans use plan ID plus exact revision. A source that changes between
steps is stale and cannot be invoked.

## Contract primitives

The shared contract permits a finite set of inputs: text, multiline text,
integer, number, boolean, select, and secret-reference. Results are bounded
notice, status, key-value, table, transcript, artifact, audit, and diagnostic
blocks. Collection sizes, text lengths, row counts, preview bytes, identifiers,
versions, and scalar values are normalized at the application boundary.

Descriptors are presentation data only. They cannot carry code, component
references, policies, host capabilities, selectors, raw HTML, or arbitrary
renderer instructions. State-changing and executable actions require explicit
confirmation.

## Capability handlers

- Conversation adapts reviewed controlled-conversation plans and existing
  session, approval, transcript, submit, cancel, and retry use cases.
- Records adapts verified release-bound form, record, and redacted audit use
  cases.
- Artifact review adapts verified release-bound browse, detail, safe preview,
  and redacted audit use cases.
- Deployment adapts approved-release installation, activation, health,
  rollback, revocation, run, and audit use cases. Installation policy and host
  qualification are supplied by the host, never the renderer. Routine
  published-build lifecycle actions use the dedicated facade instead of this
  configurable diagnostic workflow.

The record families remain separate. The catalog coordinates discoverability
and presentation; it does not replace their domain rules.

## Runtime identity and compatibility

New deployment records use a stable runtime profile ID such as
`builtin.runtime.controlled-chatbot@1.0.0`. Runtime adapters advertise supported
profile IDs. Legacy records containing a closed reference runtime kind are
decoded through an explicit compatibility map on repository reads. A record
whose legacy and current identity disagree is invalid, and an unknown or
unqualified profile remains unavailable.

## Host and transport security

Managed API requests derive actor roles and organization identity from trusted
middleware. Desktop IPC injects the explicit local trusted principal. Payload
fields cannot broaden either context. API and IPC expose the same list,
prepare, and invoke operation family and sanitize failures.

Imported or authored executable content remains denied without the separately
qualified sandbox required by ADR-0032 and ADR-0033.

## Advanced workflow interaction

The reusable `SystemRunWorkflow` presenter and its desktop/thin transport
adapters remain available to a future explicitly approved advanced-diagnostics
surface. They are not mounted in the Systems navigation. If mounted in a
controlled surface, the ordered interaction is:

1. choose a workflow from read-only summaries;
2. open that workflow to prepare its current bounded snapshot;
3. choose and configure one projected action;
4. review the exact source, action, effect, and masked values when confirmation
   is required;
5. inspect bounded results and history.

Only summary discovery occurs when that advanced surface mounts. Action fields and result
blocks are loaded for the explicitly opened profile, and stale asynchronous
responses are discarded when the profile or workspace changes. Read actions
invoke directly after local shape validation. Change and execution actions
cannot invoke until the explicit confirmation control is accepted.

The presenter renders only native controls and the finite contract primitives.
It never interprets raw HTML or arbitrary component instructions. Image
previews use bounded bytes and revoke object URLs when their result leaves the
tree. Transport errors are mapped to sanitized workflow failures.

## Adding a workflow

Extend the application catalog with a uniquely identified handler that adapts
an existing authoritative use case. Supply bounded discovery, preparation, and
invocation projections; exact source verification; denial and stale-source
tests; and host-composition coverage. The generic contract, transports, host
clients, and presenter should not require a reference-specific branch. A
capability that needs new executable policy or an unbounded presentation
primitive requires separate architecture and security review.

## Verification

Focused tests cover contract bounds, discovery without side effects, duplicate
handler rejection, exact-source stale failures, application-handler denial
propagation, legacy runtime-profile migration, API/IPC principal parity,
read-action invocation, input denial, explicit confirmation, sensitive-value
masking, all bounded result primitives, object-URL cleanup, host client failure
mapping, and lazy host-page mounting. Desktop preload and both host composition
roots are covered by their boundary checks.
