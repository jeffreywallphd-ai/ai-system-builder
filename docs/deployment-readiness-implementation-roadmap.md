# Deployment Readiness Implementation Roadmap

- Status: Recommendations 1-7 implemented end to end at the repository level;
  controlled-environment qualification remains open
- Decision authority: [ADR-0025](adr/ADR-0025-deployment-shaped-structured-persistence.md)
- Architecture authority: [Persistence and Storage](architecture/persistence-and-storage.md) and [Host Model](architecture/host-model.md)

This is a delivery tracker, not a canonical architecture source. If this plan
conflicts with an accepted ADR, architecture document, or standard, the canonical
source wins and this plan must be corrected.

## Production-readiness continuation (recommendations 1-7)

The dependency order is supply-chain integrity, continuously exercised live
PostgreSQL, atomic concurrency, recoverability, deployment artifact
qualification, accepted tenancy/identity design, then tenant-aware object
storage. This prevents later qualification from being built on an untrusted
artifact, an unexercised database, or an undecided ownership boundary.

| Order | Recommendation                                                             | Status                       | Exit evidence                                                                                                                                                                   |
| ----- | -------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Reproducible dependency and supply-chain baseline                          | verified                     | Committed lockfile, clean `npm ci`, runtime/toolchain audit policy, production SBOM validation, pinned CI actions, Dependabot                                                   |
| 2     | Continuous disposable PostgreSQL qualification                             | verified in CI configuration | Health-checked PostgreSQL 18 service runs the live migration, rollback, revision, isolation, namespace, and health suite on each change                                         |
| 3     | Atomic mutations and multi-process concurrency                             | verified at repository level | Revision-zero insert, bounded compare-and-swap, Serializable PostgreSQL retry, pure mutation seam, independent-adapter and multi-pool contention tests, anti-drift fitness test |
| 4     | Automated backup/restore and recovery drills                               | verified in CI configuration | Destructive disposable custom-format restore drill, digest/count reconciliation, retained sanitized evidence, documented RPO/RTO measurement                                    |
| 5     | OCI, Compose, and Kubernetes single-replica qualification                  | verified in CI configuration | Digest-pinned non-root image build/scan, restricted Compose managed-shape smoke, static Kubernetes policy and syntax validation, immutable image guidance                       |
| 6     | Identity, organization tenancy, authorization, and audit                    | verified at repository level | Managed OIDC, local profile, membership policy, request context, append-only audit, schema v2, forced RLS, explicit assignment, pooled default and dedicated placement       |
| 7     | Tenant-aware object storage                                                | verified at repository level | Adapter-derived organization prefixes, context-required object/generated/unregistered operations, stable logical keys, and cross-organization denial/integration tests      |

## Target deployment shapes

| Shape            | Structured persistence target      | Artifact/resource storage                                           | Operational posture       |
| ---------------- | ---------------------------------- | ------------------------------------------------------------------- | ------------------------- |
| Local            | SQLite in desktop application data | Local filesystem plus configured repository providers               | Zero-service, single-host |
| Campus server    | PostgreSQL                         | Mounted filesystem or institution service plus repository providers | Institution-operated      |
| Corporate server | PostgreSQL                         | Managed volume/object service plus repository providers             | Enterprise-operated       |
| Cloud            | Managed PostgreSQL                 | Object/blob service plus repository providers                       | Cloud-operated            |

Runtime installations and caches remain outside both structured persistence and
artifact storage. Secrets remain in environment/credential-store boundaries.

## Recommendation 6 decision checkpoint

ADR-0029 is accepted. It defines organization-as-tenant,
pooled managed PostgreSQL with an explicit partition key and forced row-level
security, OIDC identity for managed hosts, an explicit local organization and
principal for desktop, deny-by-default application authorization, and separate
structured audit records. Alternatives and their isolation/operating tradeoffs
are recorded in the ADR.

The implementation now carries explicit request contracts, durable tenancy
schema, local and OIDC identity adapters, membership authorization, audit,
tenant-aware storage keys, and pooled/dedicated placement. Controlled target
environments must still qualify their IdP, database roles, ingress, recovery,
capacity, and artifact service before production support is claimed.

## Current baseline

- Desktop composition actively uses SQLite for structured records. Explicit
  campus, corporate, and cloud server shapes actively use PostgreSQL; only an
  unshaped non-production server retains named JSON compatibility behavior.
- `modules/contracts/config` now records finite deployment shapes and target
  databases.
- `modules/adapters/persistence/sqlite` now provides the Electron-compatible
  SQLite runtime, schema-version-2 migrations, transactions, health, backup, restore,
  portable export, and active desktop repository composition.
- `modules/adapters/persistence/postgres` provides a bounded `pg` pool,
  advisory-locked migration, JSONB document repository seam, transactionally consistent
  export, health, readiness data, and graceful drain; a live service remains
  necessary for environment qualification.
- Whole-document repository writes now use bounded revision compare-and-swap;
  PostgreSQL application transactions use Serializable full-callback retry for
  retryable SQLSTATEs, and a fitness test prevents adapters from returning to
  stale read-then-write collection updates.
- The continuous PostgreSQL job now creates a custom-format logical backup,
  inspects it, drops and recreates the disposable database, restores it, runs
  application health and marker checks, and compares canonical export count and
  digest. Sanitized timing and checksum evidence is retained as a CI artifact.
- The deployment-artifact job builds the digest-pinned non-root server image,
  starts the read-only/capability-dropped Compose stack to healthy readiness,
  smokes separate liveness/readiness endpoints, parses the restricted
  single-replica Kubernetes resources, blocks fixed critical image findings,
  and retains static, runtime, image, scan, and rendered-manifest evidence.
- Existing allowlisted JSON data has inventory, rollback-preserving import,
  reconciliation, activation marking, and source-divergence rejection.
- Existing unassigned structured documents remain in the legacy/platform
  partition until an operator selects namespaces, reviews a fingerprint, writes
  a rollback source, and confirms an atomic organization assignment.
- Managed production requires OIDC and active membership. The default pooled
  profile uses explicit organization predicates plus forced PostgreSQL RLS;
  premium dedicated placement rejects every organization other than its fixed
  configured id without changing the release or schema.
- Managed filesystem artifact operations derive physical organization prefixes
  from request context while preserving logical keys.
- Managed environment profiles, OCI/Compose/Kubernetes templates, maintenance
  commands, operational runbooks, and a qualification matrix are checked in.
- Server and thin-client build gates are clean after correcting compiler scope and
  thin-client contract/import drift in Increment 1.

## Increment 1: Deployment target and safety guardrails

- Status: verified
- Deliverables:
  - accepted deployment-shaped persistence decision,
  - typed local/campus/corporate/cloud target mapping,
  - contained local SQLite path and connection policy,
  - explicit current-state and no-silent-migration documentation,
  - direct anti-drift tests for target selection and SQLite policy.
- Exit evidence:
  - config and SQLite policy tests pass,
  - docs, architecture, and agent-support checks pass,
  - active JSON host behavior is unchanged.

## Increment 2: Local SQLite runtime foundation

- Status: verified in the Electron production runtime
- Deliverables:
  - select and document a driver compatible with the supported Node test runtime,
    Electron packaging, Windows/macOS/Linux targets, and backup requirements,
  - connection factory with deterministic open/close lifecycle and safe errors,
  - enforced WAL/full-sync/foreign-key/busy-timeout policy on every connection,
  - monotonic migration ledger, exclusive migration lock, and newer-schema guard,
  - transaction helper and database health diagnostics without raw paths or SQL,
  - online backup, restore-to-new-file, integrity check, and atomic replacement.
- Exit evidence:
  - fresh-create, upgrade, downgrade-rejection, lock contention, crash recovery,
    backup/restore, corruption, disk-full, and packaging tests pass on supported
    desktop operating systems.

Current evidence covers fresh create, revision conflict, transactional rollback,
health, online backup, integrity/schema validation, and restore under the pinned
Electron runtime on Windows. Cross-platform packaging, deliberate corruption,
disk-full, and lock-contention cases remain in the Increment 5 qualification
matrix rather than blocking the repository-level runtime foundation.

## Increment 3: JSON import and local repository cutover

- Status: implemented; qualification continues in Increment 5
- Deliverables:
  - inventory every JSON repository family, manifest version, record count, and
    stable identity without mutating the source,
  - define logical SQLite schemas, constraints, indexes, and workspace ownership,
  - import in dependency order inside restart-safe transactions,
  - reconcile source/target counts, identifiers, relationships, and representative
    semantic reads,
  - preserve a timestamped read-only JSON rollback source and produce sanitized
    migration diagnostics,
  - switch desktop composition only after successful verification; never dual-write
    and never silently fall back to JSON.
- Suggested repository order:
  1. workspace records, active selection, settings excluding secrets,
  2. Asset Kernel definitions/instances/bindings/compositions,
  3. user library, authoring, projections, and composition plans,
  4. runtime readiness, execution plans/runs, and conversations,
  5. model/image/artifact catalogs as structured metadata only.
- Exit evidence:
  - empty, typical, malformed, interrupted, retry, rollback, and cross-workspace
    isolation fixtures pass; desktop host integration proves SQLite is active and
    JSON is no longer written after cutover.

Implemented evidence includes an allowlisted JSON/NDJSON inventory, canonical
hashes and counts, immutable pre-import copies, one-transaction import plus marker,
restart idempotence, source-divergence rejection, and representative typed
workspace repository reads/writes under the Electron SQLite runtime with no JSON
directory created. Desktop composition selects SQLite before registering IPC and
passes the database seam through workspace, settings, asset kernel, user library,
authoring, projections, composition, readiness, plans, conversations, runs,
model/image metadata, artifact catalog, and artifact binding adapters. Artifact
content remains in storage adapters. Broader cross-platform and fault-injection
cases remain in Increment 5.

## Increment 4: PostgreSQL managed-server persistence

- Status: implemented; live environment qualification continues in Increment 5
- Deliverables:
  - production connection pool with startup validation, timeouts, graceful drain,
    TLS configuration, and secret-safe diagnostics,
  - PostgreSQL migration ledger and deployment-safe locking,
  - PostgreSQL implementations for every repository activated in the server host,
  - shared semantic conformance fixtures used by both SQLite and PostgreSQL,
  - deployment-shape configuration with explicit failure for missing/invalid
    database configuration,
  - import tooling for existing server JSON data with the same validation and
    rollback guarantees as local migration.
- Exit evidence:
  - server integration and thin-client flows pass against PostgreSQL; concurrent
    writer, transaction isolation, pool exhaustion, restart, migration, and
    workspace isolation tests pass; active server composition no longer writes
    structured records to JSON.

Managed shape selection, fail-closed configuration, TLS defaults, bounded pool,
same-client transactions, migration advisory lock, newer-schema guard, optimistic
revision conflicts, import/cutover, repository wiring, and graceful drain are
implemented. Unit and host selection tests pass. The checked-in live conformance
test is gated by `TEST_POSTGRES_URL` and was skipped on the implementation
workstation because no PostgreSQL service or Docker runtime is available; that
test is mandatory in the Increment 5 qualification environment.

## Increment 5: Multi-shape operational qualification

- Status: implementation complete; controlled-environment qualification remains
- Deliverables:
  - supported deployment manifests and operator configuration for campus,
    corporate, and cloud shapes,
  - database and artifact-store health/readiness signals with sanitized failures,
  - documented and rehearsed backup/restore, upgrade, rollback, and disaster
    recovery procedures per shape,
  - observability for connection pressure, query latency, migration state, backup
    age, capacity, and failures without record/secret leakage,
  - release qualification matrix covering local packaging, managed server startup,
    cloud rollout, and data portability exports,
  - explicit compatibility policy for application/database schema versions.
- Exit evidence:
  - restore drills and upgrade/rollback drills meet approved objectives; deployment
    smoke tests and security checks run in CI or a controlled qualification
    environment for every supported shape.

Implemented evidence includes separate liveness and dependency-aware readiness,
sanitized database latency/pool/schema and artifact-capacity reporting,
fail-closed production security, idempotent graceful drain, SQLite and PostgreSQL
health/export commands, guarded SQLite backup/restore commands, Node 24 LTS OCI,
isolated PostgreSQL Compose, Kubernetes probe/secret/volume templates,
shape-specific environment profiles, schema compatibility rules, recovery
runbooks, and an explicit qualification matrix. Windows Electron integration and
repository gates are executable locally. Live PostgreSQL, container, Kubernetes,
macOS/Linux packaging, and recovery-objective evidence remain mandatory in the
owning controlled environments; absence of those environments is not recorded as
a pass.

### Repository completion evidence (2026-07-17)

- The full non-browser repository runner completed with report status `passed`,
  exit code `0`, 2,233 passing test events, no actionable failures, and one
  intentionally environment-gated live-PostgreSQL conformance test across 2,234
  test events.
- Windows x64 Electron packaging completed through Forge webpack/native
  preparation and Electron Packager finalization; the packaged output contains
  application `0.1.0`, Electron `41.10.2`, and both main and renderer bundles.
- Server TypeScript and thin-client production builds completed successfully.
- Documentation drift, module architecture, and agent-support gates completed
  successfully; the agent-support catalog contains 26 packs and 19 scenarios.
- The checked-in deployment profiles, maintenance commands, health endpoints,
  data-portability export, container/Compose/Kubernetes examples, and operator
  runbooks form an end-to-end implementation path for local and managed shapes.
- Production support is not yet claimed for campus, corporate, or cloud shapes.
  The live PostgreSQL concurrency, restore, pool-pressure, container, Kubernetes,
  identity/tenancy, and recovery-objective rows in the qualification matrix must
  pass in their owning environments first. Until shared-repository concurrency
  and tenancy are qualified, managed deployments remain single-replica.

## Cross-cutting priorities

1. Keep the now-clean server and thin-client build gates required for every
   database increment that changes a host or shared contract.
2. Preserve ADR-0029 identity, organization tenancy, authorization, audit, and
   placement invariants as repository families evolve.
3. Keep artifact/object storage replaceable: filesystem is suitable locally and
   for some campus installs; corporate/cloud deployments need qualified object or
   managed-volume adapters without changing application contracts.
4. Move persisted credentials out of ordinary JSON settings into platform or
   managed secret stores; decide encryption-at-rest through the existing security
   decision process.
5. Add bounded database observability and health checks before calling a shared
   deployment production-ready.
6. Define support, upgrade, rollback, retention, recovery-point, and recovery-time
   objectives for each managed deployment shape.
7. Keep hybrid/offline synchronization out of database adapter work until conflict,
   authority, and ownership semantics have an accepted decision.

## Delivery rules

- Begin each increment with current primary-source research, repository impact
  inspection, and an updated test/rollback plan.
- Implement one repository family end to end before broad mechanical conversion.
- Use shared semantic conformance fixtures while retaining engine-specific
  integration tests.
- Do not claim a deployment shape is supported until its active host composition,
  migration, backup/restore, security, and operator evidence all exist.
- Run the checks required by [AGENTS.md](../AGENTS.md), the
  [change-impact matrix](standards/change-impact-matrix.md), and affected app
  builds before closing an increment.
