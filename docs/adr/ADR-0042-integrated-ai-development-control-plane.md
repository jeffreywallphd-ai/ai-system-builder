# ADR-0042: Integrated AI Development Control Plane

- Status: accepted
- Date: 2026-10-20
- Related: ADR-0015, `docs/architecture/ai-development-control-plane.md`, `skills/manage-implementation-roadmaps/SKILL.md`

## Context

The existing roadmap workflow preserves intent, approvals and continuity, but its
evidence records are declarative. Contributor execution, independent review,
coordination, realistic evaluation and user outcomes need a common integration
boundary. A second planning hierarchy would add migration and divided authority.

## Decision

Extend the existing roadmap workflow with one bounded contributor CLI and make
`AGENTS.md` the discovery entry point. Use outcome-scoped lightweight work for
established fixes and the existing approved roadmap for substantial work.
Execution stays outside the portable state engine. New governed completion binds
source, acceptance, check policy, actual check results and separate-invocation
review; historical evidence remains explicitly legacy.

Reuse suitable project-neutral primitives and tests from the comparison control
plane with provenance and applicable notices. Adapters own this repository's
authority and paths. No CAP/SLI/WRK hierarchy or product-runtime dependency is added.

Provide a dynamically populated local read-only review site backed exclusively
by versioned JSON. On workflow work requests, agents start or safely reuse the
server and share its verified link. The site cannot grant approval or perform
mutations. It is loopback-only and has fixed routes and inert rendering.

## Consequences

The workflow gains explicit user outcomes, current verification, review,
ownership, recovery and evaluation seams while preserving existing artifacts.
The repository maintains focused behavioral tests and one canonical guide.
The local threat model assumes cooperative authorized processes. Hashes,
claims and attestation IDs do not provide hostile-code isolation, authenticated
reviewer identity or protection from an unrestricted local administrator.
Remote execution, identity integration, provider egress and product policy
changes retain their separate decisions and authority.

## Fixed Windows qualification lifecycle

Within the cooperative-local execution boundary, a separate bounded Windows
qualification launcher can own newly created model-free test commands. Keep the
public self-test roles closed and real package/UI command factories separately
reviewed and identity-bound. Preserve the earlier closed Python fixture rather
than extending its proof to other commands.

Use suspended creation-time job membership, explicit private standard handles,
noninherited kill-on-close ownership and finite process/commit/output/deadline
limits. Require exact native root exit, zero active members and acknowledged
stream/handle retirement. Qualify crash, failure and timeout behavior before
real workloads. Unknown retirement fences the new attempt; observed failure
never becomes a product pass. No arbitrary command service, old-process
adoption, failed-output recovery, privilege change or offload policy change is
authorized. This mechanism cannot establish hostile same-user isolation or
machine-wide resource bounds.

Pipe-only qualification uses detached creation and explicit standard handles.
Fixed fixture counts and native retirement proof stay strict. A separately
reviewed source-revision family can test a correction after proven retirement
of the earlier owned job; its failed journal and fence remain immutable. No
generic reset or exception for an unidentified process is introduced.
