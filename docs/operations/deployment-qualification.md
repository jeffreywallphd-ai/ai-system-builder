# Deployment Qualification

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

- Status: active qualification procedure
- Supporting plan: [Deployment Readiness Implementation Roadmap](../deployment-readiness-implementation-roadmap.md)
- Operations: [Persistence Operations](persistence-operations.md)

"Implemented" means the repository contains the active composition, configuration,
tests, and operator surface. "Production-qualified" additionally requires evidence
from the actual operating system, PostgreSQL service, artifact service, network,
identity boundary, and backup platform. Repository unit tests cannot substitute
for those controlled-environment results.

## Repository gates

Run from a clean dependency install using the supported Node LTS line:

```text
npm run docs:check
npm run architecture:check
npm run agent-support:check
npm run asset-system:check
npm run deployment:check
npm test
npm run build:server
npm run build:thin-client
npm run package
```

Asset/system profiles and evidence truth rules are defined in
[Asset and System Support Qualification](asset-system-support-qualification.md).
Repository gates do not satisfy its controlled recovery, performance, security,
accessibility, or cross-platform checks by themselves.

For Windows desktop releases, also run the packaged Visual Composer project in
[Asset and System Support Qualification](asset-system-support-qualification.md).
It exercises the dedicated published-system window, controlled conversation
turns, restart persistence, and physical runtime/control-plane data separation
against a package rebuilt from the current worktree.

The companion thin-client Visual Composer project uses an explicit
qualification-only, per-runtime in-memory data plane because the supported
Node 20 browser-test host does not expose Electron's SQLite runtime. Production
server startup rejects this seam. Treat the thin project as HTTP lifecycle and
isolation evidence only; PostgreSQL live/recovery evidence remains mandatory
for managed-server durability and physical database isolation claims.

CI additionally builds and scans the image, boots the isolated Compose stack,
smokes both probes, and renders the checked-in Kubernetes Kustomize composition
without contacting a cluster. The equivalent local container gate is:

```text
POSTGRES_PASSWORD=<qualification-only> \
docker compose -f deployments/server/compose.qualification.yaml up --build --detach --wait --wait-timeout 240
npm run deployment:smoke
docker compose -f deployments/server/compose.qualification.yaml down --volumes --remove-orphans
```

Node.js recommends production use of Active or Maintenance LTS releases; the
server image currently pins Node 24 LTS. See the official
[Node.js release table](https://nodejs.org/en/about/previous-releases).

## Engine and host matrix

| Target           | Required evidence                                                                                                                                                             | Current repository automation                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Local / Windows  | Electron SQLite create, migration, revision conflict, rollback, health, backup, restore, portable export, typed workspace read/write, no JSON write, packaged desktop startup | Electron integration and Forge package gates                                    |
| Local / macOS    | Same semantics plus signed/notarized package as release policy requires                                                                                                       | Must run on a controlled macOS runner                                           |
| Local / Linux    | Same semantics plus packaged desktop startup and filesystem fault cases                                                                                                       | Must run on a controlled Linux runner                                           |
| Campus server    | Production config, secure listener, PostgreSQL live conformance, durable mounted artifacts, backup/restore drill, thin-client smoke                                           | Compose qualification template plus controlled service test                     |
| Corporate server | Campus evidence plus enterprise secret, certificate, monitoring, capacity, audit/identity, and recovery controls                                                              | Environment profile and OCI/Kubernetes template; organization evidence required |
| Cloud            | Managed PostgreSQL TLS, pinned image, probes, controlled recreate upgrade/rollback, durable artifacts, backup/PITR restore, availability and capacity evidence                | Cloud profile and Kubernetes template; cloud-platform evidence required         |

## Live PostgreSQL qualification

Point `TEST_POSTGRES_URL` at an isolated disposable database and run:

```text
npm run test:postgres-live
```

Repository CI runs this command against a health-checked PostgreSQL 18 service
on a private runner network. It proves adapter conformance and concurrent
migration startup on every change. It also provisions two isolated system
runtime databases and roles, proves their data remains distinct through
migration, and denies foreign database access plus database, role, and schema
DDL from runtime credentials. It does not replace TLS, capacity, backup, or
platform qualification against the target managed service.

The same CI job then runs `npm run test:postgres-recovery`. It takes a
custom-format logical backup, destroys and recreates the disposable database,
restores it, and retains sanitized count, digest, backup checksum, and recovery
timing evidence for 14 days. A passing logical drill proves the repository's
backup/restore procedure is executable; it does not qualify managed PITR,
cross-region recovery, target RPO/RTO, or coordinated artifact restoration.

Then qualify managed startup with `NODE_ENV=production`, the selected
`DEPLOYMENT_SHAPE`, `oidc-bearer`, exact IdP configuration, real TLS material,
an RLS-safe runtime database role, provisioned memberships, and the same database.
Verify `/health/live`, `/health/ready`, a representative thin-client workflow,
multi-pool collection contention without lost updates, same-record revision
conflicts, pool timeout/recovery, graceful SIGTERM drain, JSON
import retry/divergence behavior, portable export, pooled cross-organization
denial, dedicated-placement rejection, transaction-local context clearing,
physical object-prefix separation, redacted audit output, and database plus
artifact restore. The live test must never target a production database.

For the isolated Compose profile, inject unique qualification-only secrets and
run `docker compose -f deployments/server/compose.qualification.yaml up --build`.
The profile intentionally uses unencrypted PostgreSQL only inside its private
network; this does not qualify a production TLS connection.

## Kubernetes or managed platform qualification

Repository CI runs `kubectl kustomize deployments/server` to parse and compose
both reviewed example manifests without API discovery. This local render proves
YAML and KRM composition only; it does not replace server-side validation
against the target cluster version and admission policy.

Render `deployments/server/kubernetes-deployment.example.yaml` through the owning
platform's configuration system, replace the image placeholder with an immutable
digest, and validate server-side before rollout. The manifest deliberately keeps
liveness independent of PostgreSQL while readiness includes PostgreSQL and
artifact storage, so a dependency outage removes traffic without creating a
restart storm.

Render `deployments/server/kubernetes-runner.example.yaml` separately in an
isolated qualification namespace. Keep the specimen job suspended; have the
deployment controller create a fresh immutable job from a reviewed equivalent.
Verify Restricted Pod Security admission, default-deny ingress and egress,
namespace and per-container CPU/memory/ephemeral-storage limits, opaque tenant
labels, secret-reference injection, active deadline, cancellation pre-stop,
termination grace, and distinct startup/readiness/liveness behavior. Add only
the DNS and destination-specific egress rules required by an admitted run. The
template does not select or certify a container/WASI sandbox, and imported or
authored execution must remain `sandbox-unavailable` until the injected adapter
has separate escape, isolation, resource, and cancellation qualification.

Until multi-replica tenancy, capacity, and target-platform qualification pass, the
template enforces one replica with a `Recreate` strategy so a nominal
single-replica upgrade cannot overlap old and new Pods. It also requires
non-root execution, runtime-default seccomp, no privilege escalation, no Linux
capabilities, a read-only root filesystem, no service-account token, bounded
temporary storage, and explicit resource requests/limits.

Run a canary first. Confirm migration serialization, OIDC key rotation,
organization membership, pooled or dedicated placement, readiness,
secret/certificate rotation, volume permissions, storage capacity alerting,
termination within the grace period, and rollback compatibility. Do not increase
replicas until shared repository concurrency, RLS-safe roles, tenant isolation,
object storage, and audit behavior are qualified for that deployment.

## Release evidence record

For each shape, retain the source revision and image/package digest, OS/runtime and
database versions, configuration profile name (without secret values), command
results, backup identifiers, restore timings, data/export counts and hashes,
security scan references, known exceptions, approver, and timestamp. A failed,
skipped, or unavailable environment check remains visible; it must not be rewritten
as a pass.
