# Managed Server Deployment Templates

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

The image build consumes the repository's tracked `package-lock.json` through
`npm ci`. Dependency resolution must therefore be reviewed before the image is
built; the image build does not create or update a dependency tree.

These templates package the server host for the `campus-server`,
`corporate-server`, and `cloud` deployment shapes. They preserve the architecture
boundary: PostgreSQL stores structured records, `SERVER_STORAGE_ROOT` stores
artifact bytes on a durable mounted service, and `SERVER_RUNTIME_ROOT` stores
replaceable runtime installations and caches.

## Files

- `Dockerfile` builds the server from a digest-pinned Node.js 24 LTS base and
  runs as an unprivileged user.
- `compose.qualification.yaml` is an isolated PostgreSQL 18 qualification stack.
  It disables database TLS only on the private Compose network and is not a
  production manifest. Its database image is digest-pinned and its application
  container uses a read-only root filesystem, no new privileges, no Linux
  capabilities, and bounded temporary storage.
- `kubernetes-deployment.example.yaml` is a production-oriented starting point
  with secret references, TLS mounts, a durable artifact volume, ephemeral
  runtime storage, graceful termination, and distinct liveness/readiness probes.
  It is intentionally `Recreate` plus one replica until target-platform
  multi-replica tenancy, capacity, and recovery are qualified.
- `kubernetes-runner.example.yaml` is a deliberately suspended managed-runner
  specimen plus Restricted namespace, quota, limit, and default-deny network
  resources. A host controller must create one immutable job per admitted run;
  operators must not unsuspend the placeholder or interpret these controls as
  qualification for imported or authored execution.
- `kustomization.yaml` composes both reviewed Kubernetes templates for offline
  `kubectl kustomize` parsing in CI. It is an inspection and rendering target,
  not an automatic production deployment.
- `config/environments/server/*.env.example` are shape-specific environment
  profiles. They intentionally omit secret values.

## Required operator choices

Before deployment, pin the built image by immutable digest, provision PostgreSQL
and artifact storage, inject `DATABASE_URL`, the PostgreSQL CA, and TLS material
through the platform secret boundary, configure the exact OIDC issuer, audience,
and JWKS values, provision organization memberships, and replace the Kubernetes
storage claims with qualified services. The filesystem adapter derives physical
organization prefixes on a durable mounted path. An external object-service
adapter remains replaceable behind the same ownership contract.

ADR-0029 chooses pooled organization tenancy by default and premium dedicated
one-organization placement over the same release. The repository does not choose
retention, RPO, RTO, high availability, or backup schedules. Operators must obtain those approved values
and apply the procedures in `docs/operations/persistence-operations.md` before a
shape can be declared production-qualified.

The runner template denies all ingress and egress. Add narrowly scoped egress
policies only for origins admitted by the application policy, use opaque secret
references rather than secret values in deployment records, retain the
application deadline in addition to cluster quotas, and verify cancellation and
probe behavior against the actual runner image. Kubernetes security context and
RuntimeClass configuration are operator evidence; they do not independently
qualify a sandbox against the executable-asset threat model.

CI continuously exercises a destructive custom-format PostgreSQL logical backup
and restore against a disposable service and retains sanitized evidence. Repeat
that procedure against the target PostgreSQL toolchain, then separately qualify
the platform's physical/PITR service and the matching artifact-store recovery.

System-release install, activation, readiness, runner policy, rollback,
revocation, and recovery procedures are in
`docs/operations/system-deployment-operations.md`.
