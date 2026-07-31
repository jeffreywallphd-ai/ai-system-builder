# ADR-0033: System Builds, Releases, Security, and Workflows

- Status: accepted
- Date: 2026-07-17
- Deciders: ai-system-builder maintainers
- Related: ADR-0015, ADR-0020, ADR-0021, ADR-0022, ADR-0023, ADR-0024, ADR-0029, ADR-0030, ADR-0032, `docs/architecture/system-build-and-release.md`

## Context

System Builder needs CRUD, revision-safe composition editing, deterministic validation/build, immutable releases, and controlled execution. Security and workflow assets must be composable without allowing a composition to weaken platform authorization or smuggle an arbitrary orchestration engine into the first release.

## Decision

- A `SystemBuilderRecord` owns design identity; immutable `SystemRevision` records own composition snapshots. Optimistic revision tokens prevent lost updates. Archive/restore changes record lifecycle without deleting revisions.
- System Builder uses Asset Kernel instances, compositions, ports, bindings, rules, and requirements. It does not create a parallel component graph.
- A build freezes one system revision, effective definitions, implementation bindings, deployment target, toolchain, and policy inputs into a lock manifest. All resolution is exact and deterministic.
- `SystemBuild` records attempts and bounded evidence. `SystemRelease` is immutable and content-addressed, references compiled bundles/migrations/SBOM/provenance/test evidence in artifact storage, and is distinct from design records and runtime/deployment state.
- Builds fail closed for unresolved, ambiguous, incompatible, revoked, untrusted, or setup-missing implementations; invalid schemas/bindings; incomplete security policy; unavailable capabilities; and unsafe migrations.
- Security assets are declarative policy modules interpreted by platform-owned policy compilers. They may narrow access or request capabilities but cannot bypass organization/workspace authorization, platform route policy, tenant isolation, audit requirements, secret handling, or sandbox policy. Platform denial always wins.
- Initial workflow assets form a finite, typed, acyclic orchestration language over approved actions, conditions, mappings, validation, and bounded error branches. Arbitrary shell commands, dynamic code loading, recursion, unbounded loops, self-modifying graphs, and implicit network/filesystem access are prohibited.
- Preview/run/deploy consumes an approved immutable release through existing readiness and controlled-execution boundaries. Runtime sessions, runs, deployments, health, and logs remain operational records.
- Local and managed builders share contracts. Desktop uses SQLite/artifact storage and qualified local builders; managed shapes use PostgreSQL/object storage and isolated workers. Thin clients never build or execute privileged logic locally.
- The non-technical Build & test surface is a narrow guided command: application
  code re-reads the exact saved revision and injects host-owned deployment,
  capability, trust, ABI, and toolchain policy. Renderer, API, and IPC callers
  cannot override those fields.
- Publish uses an application-owned systems/build-version projection and requires
  explicit confirmation. Release approval still requires the expected lock
  digest, re-verifies every referenced artifact, and creates an immutable,
  content-addressed release. Publishing does not install, activate, deploy, or
  execute the system.

## Consequences

### Positive

- Designs remain editable while releases remain reproducible.
- Composed security cannot weaken platform controls.
- Finite workflows are analyzable, testable, and sandbox-compatible.
- One logical release model supports all deployment shapes.

### Negative

- Arbitrary general-purpose workflow code is not supported by the first engine.
- Build and release evidence require durable storage and retention policy.
- Policy compilation and migration analysis add build gates.

### Follow-up

- Implement system CRUD/editor in Increment 5 and build/release in Increment 6.
- Broader workflow control flow or security delegation requires a successor ADR.
