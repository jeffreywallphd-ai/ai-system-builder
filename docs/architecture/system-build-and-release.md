# System Build and Release

- Status: current
- Implementation: deterministic builds, immutable release approval, and trusted-reference deployment handoff are implemented; imported/authored execution still requires an independently qualified sandbox adapter
- Related decisions: ADR-0020, ADR-0021, ADR-0022, ADR-0023, ADR-0024, ADR-0029, ADR-0030, ADR-0033, ADR-0034
- Verification: `docs/architecture/architecture-verification.md`

## Purpose

This architecture defines the path from a workspace-owned design to an immutable, evidence-backed release that can be previewed or deployed without conflating design, build, release, deployment, and runtime state.

## Lifecycle separation

| Family                | Responsibility                                                       | Mutable?                  |
| --------------------- | -------------------------------------------------------------------- | ------------------------- |
| `SystemBuilderRecord` | identity, name, current revision pointer, archive state              | revisioned                |
| `SystemRevision`      | exact Asset Kernel composition snapshot and design diagnostics       | immutable                 |
| `SystemBuild`         | one attempt to validate/materialize/test a frozen input set          | append-only status/events |
| `SystemRelease`       | content-addressed bundles, lock, compatibility, provenance, evidence | immutable                 |
| `SystemDeployment`    | activation target, rollout/rollback, health                          | operational               |
| execution session/run | approved interaction and runtime progress/results                    | operational               |

Design changes create revisions. Build retries create attempts. A successful changed build creates a release. No operation mutates an old revision or release.

## Deterministic build input

A build lock contains exact digests/versions for:

- system revision and composition;
- effective asset definitions;
- selected implementation releases/facets;
- selected implementation trust levels and runtime kinds;
- foundation and imported package versions;
- deployment profile and host/runtime API targets;
- configuration and schema versions;
- policy compiler and workflow interpreter versions;
- build toolchain and dependency lock;
- required migration baseline.

The lock excludes credentials, raw paths, environment secrets, provider payloads, and user-private runtime content.

For a controlled conversational release, the lock also contains one exact
workspace model-record binding and one typed composer-to-history interaction.
The model evidence includes a deterministic digest of the authority-owned model
revision, not provider credentials or local paths. Release activation and each
runtime start re-read the immutable release, re-resolve the model record in the
target workspace, and compare that digest. Missing, changed, unavailable,
cross-workspace, or incompatible bindings fail closed and require correction or
a new build; a host never substitutes a default model.

## Build pipeline

1. Freeze and normalize the requested system revision.
2. Validate asset definitions, configuration, ports, bindings, cardinality, cycles, and dependencies.
3. Compile platform and composed security policy; reject incomplete or weakening policy.
4. Resolve one compatible, permitted implementation facet per required asset.
5. Evaluate deployment, runtime, storage, model/provider, secret-reference, quota, and migration readiness.
6. Materialize deterministic UI route/shell, logic/workflow, data schema/migration, and configuration inputs.
7. Build in the qualified isolated builder.
8. Run contract, unit, integration, accessibility, security, and reference tests required by the composition.
9. Produce digests, SBOM, provenance, compatibility manifest, bounded evidence, and reproducibility result.
10. Require an authorized release approval and persist an immutable release.

Partial outputs remain quarantined and are deleted or retained as failed-build evidence according to policy. They never become active release content.

## Security and workflow compilation

Composed policy is the intersection of platform, organization, system, and asset permissions. A composition can narrow but not widen the upstream authority. Missing required authorization, isolation, masking, audit, or approval declarations block the build.

The initial workflow language is finite and typed. Its compiler proves action availability, type-compatible mappings, bounded branches, no cycles, and declared error paths. Runtime execution invokes only capability broker actions and records each step. General shell or dynamic-code workflow nodes are unsupported.

## Deployment profiles

- Local desktop: SQLite metadata, desktop artifact storage, trusted built-ins and qualified constrained local sandbox.
- Campus/corporate: PostgreSQL, institution object/filesystem storage, isolated server builders/runners, organization policy.
- Cloud: PostgreSQL, tenant-aligned object storage, ephemeral tenant-isolated builders/runners, managed secrets, quota and audit.
- Thin client: server-owned metadata/build/execution; browser receives only safe read models and sandboxed UI facets.

The same logical release may contain multiple target facets. A target activates only when every required facet and capability is compatible. Unsupported shapes fail before execution.

## UI placement

Systems owns Manage, Compose, and Publish. Compose Connections is the
system-specific relationship workflow, so Systems has no duplicate Plans
page. Build & test is a focused Compose modal for one exact saved revision.
Publish lists active systems and application-projected build versions, is the
only Systems surface that requests immutable release approval, and owns routine
published-build lifecycle controls. Install also activates; eligible actions are
derived from authoritative state; starting a visual system opens its exact
trusted declarative interface automatically; starting a service has no UI.
There is no standalone Run & Test tab and no renderer-entered deployment or run
identifier. Assets owns
Catalog and Studio. Operational deployment/runtime status remains separate from
design/build records. Desktop and thin-client render the same safe read models
and command outcomes.

## Current implementation status

The repository now implements the design/build/release boundary end to end for
both desktop and server hosts:

- `modules/contracts/system-build` separates attempts, frozen locks, artifacts,
  evidence, releases, compatibility, and comparison results from design records;
- `RequestSystemBuildUseCase` re-reads an exact immutable system revision,
  reruns canonical composition validation, resolves permitted implementation
  releases, creates a canonical lock, and materializes deterministic bundles;
- the materializer emits a system manifest, applicable UI/logic/workflow
  bundles, deny-by-default policy, configuration schema, non-destructive
  migration intent, and SPDX 2.3 SBOM;
- content-addressed storage verifies SHA-256 integrity at write and again before
  release approval; releases derive their identity from the lock and artifact
  set and are immutable;
- automatically generated in-toto/SLSA-style provenance and bounded build
  evidence distinguish same-environment `repeatable` results from a future
  independently reproduced result;
- workspace-scoped structured persistence, authenticated API routes, desktop
  IPC/preload, and shared desktop/thin-client Build & test and Publish UX use
  the same application behavior; renderer requests cannot select deployment,
  capability, trust, ABI, or toolchain policy; and
- cancelled, invalid, unresolved, incompatible, secret-bearing, policy-missing,
  and tampered builds fail without activating partial outputs.

Build outputs live under a non-active content-addressed build namespace. Failed
or interrupted output may be retained as quarantined evidence or garbage
collected by operator retention policy; it is never a release until approval
re-verifies every referenced artifact.

The guided build boundary is intentionally narrower than the low-level build
command. `PrepareGuidedSystemBuildUseCase` re-reads and evaluates the exact
saved revision and resolves every referenced implementation against the
host-owned profile before it may report `ready`, while
`RequestGuidedSystemBuildUseCase` injects that same host-owned build profile.
Current System Foundation 3.0.0 definitions have exact, separately addressable
trusted implementation releases and backing resources; historical 1.0.0 and
2.0.0 releases remain immutable and available. `ListSystemPublicationWorkspaceUseCase` supplies stable,
plain-language build-version and publication status projections. API and IPC
allowlists reject renderer-supplied technical policy fields. Publication still
uses the existing authorized approval operation with the expected lock digest;
the application layer re-verifies artifacts and derives the immutable release.

## Qualification, limits, and recovery

- `npm run test:visual-composer` qualifies the supported packaged Windows
  Electron and local Chrome targets through fresh isolated stores. Packaged
  qualification rebuilds the current worktree before launch. The browser run
  uses an ephemeral least-privilege credential with token enforcement and an
  isolated dedicated qualification organization; its credential is not retained
  in traces and the stored credential record is removed at teardown. The
  sanitized report is exact-environment evidence, not a claim for other
  browsers, operating systems, physical assistive technology, or production
  capacity.
- The shared persistence conformance scenario retains successful, failed, and
  cancelled attempts across a representative 36-build history and verifies
  workspace isolation, exact associations, optimistic conflicts, immutable and
  idempotent releases, deterministic newest-first publication projection,
  transaction rollback, and restart-safe reads. Thirty-six builds is a
  regression workload, not a product maximum or performance service level.
- SQLite runs that scenario in Electron's production database runtime together
  with health, online backup, explicit restore confirmation, and rollback
  checks. PostgreSQL parity is claimed only when the same scenario runs against
  an isolated disposable `TEST_POSTGRES_URL`; a skipped live test is not
  evidence. Managed backup/PITR and production load remain environment-owned
  qualification.
- Builds reject revisions above 5,000 instances and retain at most 200 bounded
  diagnostics in a build result. Larger supported histories and capacity
  targets require measured environment evidence rather than raising these
  safety bounds casually.
- Interrupted, failed, or cancelled attempts never become releases. On local
  recovery, stop writes and follow
  [Persistence Operations](../operations/persistence-operations.md) for health,
  verified backup, explicit restore, and post-restore release/artifact checks.
  Managed operators must restore the matching structured database and
  content-addressed artifacts, then rerun integrity verification before
  publication. Rollback does not bypass authorization, revocation, lock, or
  artifact checks.

The separate `system-deployment` family consumes an approved release,
re-verifies every artifact at install, resolves the intersection of frozen
facet compatibility, and records organization/workspace-scoped install,
activation, readiness, rollback, revocation, run, and audit state. Its retained
records are operational history; uninstall retires the one current deployment
pointer for an exact organization, workspace, release, and host target without
deleting earlier deployments, runs, or audit evidence.

Routine published-build controls use the narrower
`system-published-lifecycle` application facade. A renderer supplies only the
exact release ID, one projected action, and the opaque revision it last read.
The application resolves deployment and run identifiers, injects host policy,
capabilities, secrets, egress, profile, target, and authority, and rejects stale
or ineligible actions. The projected action states are:

| Current state                                              | Available actions                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Not installed                                              | Install                                                                              |
| Active and stopped                                         | Start, Deactivate, Uninstall                                                         |
| Inactive and stopped                                       | Activate, Uninstall                                                                  |
| Running                                                    | Stop                                                                                 |
| Interrupted stop                                           | Stop                                                                                 |
| Interrupted uninstall                                      | Uninstall                                                                            |
| Stopped with invalid release binding or runtime allocation | Safe cleanup actions only; Start/Activate are withheld with an actionable diagnostic |
| Other transitional state                                   | No action until authoritative reconciliation completes                               |

Install atomically creates the current deployment and activates it. Start
persists a long-lived `running` session instead of reporting a completed
handoff. Stop persists `stopping` before invoking the runtime so interruption
cannot falsely project a stopped system. Uninstall is permitted only while
stopped, persists `uninstalling`, deactivates runtime authority, marks the
record `uninstalled`, and atomically removes its current pointer. Conflicting
install requests converge on the already-current exact deployment; stale
revisions and cross-workspace identities fail closed.

Desktop maps trusted exact releases to the `local-desktop` target. Server maps
campus/corporate and cloud shapes to host-owned managed targets. Both verify
that the immutable release still exists with its exact digest before activation
or start. A visual run may return a bounded launch descriptor containing only
the exact release, digest, runtime profile, and host-owned surface kind; a
service run has no UI descriptor. Thin client remains a command and safe-read
surface and never becomes execution authority.

Lifecycle projection revalidates the exact release binding and opaque runtime
instance before presenting Start or Activate. Historical immutable chatbot
releases without a selected model must be rebuilt and republished; they are not
silently mutated or assigned a default. A valid historical release whose
installation predates runtime-instance allocation may be explicitly uninstalled
and reinstalled to receive a new isolated allocation. Failed actions remain
visible after the authoritative status refresh instead of appearing to do
nothing.

Explicit Deactivate and Uninstall cleanup remains available for deployments
created before runtime-instance records existed. Those actions may close and
retain an exact associated instance when one is found, but they do not create,
guess, or attach a data allocation during cleanup.

Imported or authored UI/logic, independently qualified rebuilds, arbitrary
provider execution, and a qualified container/WASI sandbox are not implied and
remain unavailable until their explicit adapters and environment evidence
exist.
