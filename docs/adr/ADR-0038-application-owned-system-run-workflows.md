# ADR-0038: Application-Owned System Run Workflows

- Status: accepted
- Date: 2026-07-28
- Deciders: ai-system-builder maintainers
- Related: ADR-0023, ADR-0024, ADR-0029, ADR-0033, `docs/architecture/system-run-workflows.md`

## Context

Systems Run & Test originally mounted one presenter for each shipped reference
system plus a separate deployment presenter. That made reference-template
identity a UI routing mechanism and required another top-level workflow whenever
a reference system was added. Deployment records also persisted a closed
reference-system-kind discriminator.

The existing conversation, release-bound data, release-bound review, and
deployment application families already own their policy and state. The missing
seam was a bounded way to discover which of those application capabilities an
exact approved release or reviewed execution plan supports.

## Decision

- The application layer owns a versioned catalog of registered system-run
  workflow handlers. Hosts compose the supported handlers; renderers cannot
  register handlers, select authority, or provide policy.
- Discovery returns inert summaries for exact approved releases or exact
  reviewed execution plans. It performs no mutation or runtime invocation.
- Preparation and invocation require the same exact source identity. Approved
  releases carry their immutable digest; reviewed plans carry their exact
  revision. Stale or inconsistent identities fail closed.
- A shared renderer may display only the closed, bounded field and result
  primitives in the workflow contract. Descriptors contain no executable code,
  component names, selectors, policies, or arbitrary renderer instructions.
- Explicit application handlers adapt the existing conversation, data, review,
  and deployment use cases. Those families retain authorization, validation,
  audit, state, and runtime ownership.
- API authentication/organization context and the desktop local principal are
  injected at trusted transport boundaries. Renderer-supplied principal,
  organization, host capability, deployment policy, and sandbox claims are
  ignored.
- Deployment records use a stable application-owned runtime profile identity.
  Existing closed-kind records are decoded through an explicit one-to-one
  compatibility map; conflicting, missing, unknown, or unsupported identities
  remain unavailable.
- Imported or authored executable content remains unsupported until a qualified
  sandbox adapter and its policy are independently accepted and evidenced.

## Consequences

### Positive

- New reference systems that reuse registered capabilities need no new Systems
  page or top-level Run & Test panel.
- Desktop and thin client share one finite interaction model while application
  policy remains outside the renderer.
- Exact source identity, host support, confirmation, and bounded result handling
  are consistent across capability families.
- Runtime dispatch is extensible by stable profile registration instead of a
  template-kind union.

### Negative

- A genuinely new interaction primitive requires a reviewed contract and shared
  renderer change.
- Hosts must register each supported capability handler and qualify transport
  parity.
- Legacy deployment records require compatibility decoding until their retained
  lifecycle ends.

## Non-goals

- No universal dynamic workflow language, remote component loading, arbitrary
  forms, raw HTML, or executable release metadata.
- No merger of conversation, data, artifact review, deployment, or execution
  record families.
- No claim that release approval grants activation or execution authority.
