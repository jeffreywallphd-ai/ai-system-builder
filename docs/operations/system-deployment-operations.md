# System Deployment Operations

> AI documentation reminder: when behavior in this area changes, update the related architecture docs, context packs, and README files in the same change.

- Status: implemented trusted-reference handoff; environment qualification required
- Architecture: [System Build and Release](../architecture/system-build-and-release.md)
- Platform qualification: [Deployment Qualification](deployment-qualification.md)

## Supported boundary

An operator may install an immutable approved release, inspect compatibility,
activate it after readiness, reconcile health, restore the previous active
deployment, revoke it, and inspect bounded run/audit history. Desktop supports
the `local-desktop` profile. Managed server maps campus/corporate to
`campus-server` and cloud to `cloud-server`. Thin client sends authenticated
commands to that server and owns no privileged runtime.

The default runtime recognizes only `secured-data-entry`,
`controlled-chatbot`, and `secured-data-review` release manifests. Imported or
authored executable content is deliberately `sandbox-unavailable`. Do not
change that result to ready based only on a container image, RuntimeClass, WASI
engine, or Kubernetes security context.

## Install and activate

1. Build and approve an exact system revision; record the release and artifact
   digests.
2. Choose the active host profile and request install with policy that is no
   broader than platform ceilings. Keep capabilities and secret references
   empty unless their host brokers are explicitly configured and qualified.
3. Review compatibility evidence. Host API/runtime ABI, trust/runtime kinds,
   required capabilities, profile, and sandbox diagnostics must all be ready.
4. Activate. The previous deployment remains active until the new adapter
   reports ready. An interrupted or not-ready activation becomes a failed
   deployment and does not silently replace the previous active release.
5. Record deployment ID, release digest, actor, profile, status, health, and
   audit outcome. Never record secret values, paths, provider responses, or raw
   sandbox output.

## Run, cancellation, and quotas

Every run is authorized against the deployment policy before the runtime call.
Capability names, opaque secret-reference IDs, egress origins, and concurrency
must be subsets of policy. Duration, memory, output, and concurrent-run ceilings
remain application requirements even when a platform also applies quotas.

Cancellation is explicit and records terminal state. An interrupted runtime
call is reconciled to a failed run with a safe diagnostic. For a managed runner,
qualify the suspended `deployments/server/kubernetes-runner.example.yaml`
specimen, deadline, pre-stop cancellation, termination grace, probes,
default-deny networking, resource/ephemeral-storage limits, immutable image,
tenant labels, and secret-reference injection on the target cluster.

## Rollback and revocation

Rollback is a transition to the recorded previous deployment, never mutation of
an old release. The previous runtime must become ready before the current one is
deactivated. If readiness fails, the current deployment returns to active.

Deployment revocation deactivates the runtime and denies new starts. Frozen
implementation revocation is also re-read during install, activation, health,
rollback selection, and every run start. Newly revoked active content is
best-effort deactivated, persisted as revoked, and denied; unavailable
revocation truth fails closed. Treat implementation, package, or release
revocation as an incident input: identify affected deployments by immutable
release identity, revoke them through trusted-host maintenance, retain redacted
audit, select an approved unaffected release, install and activate it, and
verify readiness before restoring traffic. Follow
[Asset and System Support Qualification](asset-system-support-qualification.md)
for advisory correlation and evidence requirements.

## Backup, restore, and upgrade

Back up structured deployment/run/audit records together with System Builder,
build, release, organization, and workspace records. Back up immutable release
artifacts through the owning artifact-store procedure. A usable restore requires
both sides and digest verification; database-only recovery is not proof that a
release can activate.

Before an application or runtime upgrade, retain the current image/package
digest, database backup, release artifacts, compatibility evidence, and active
deployment ID. Restore into an isolated environment, verify artifact digests,
reconcile deployments without starting revoked content, and exercise activation
plus rollback. Follow the approved RPO/RTO in
[Persistence Operations](persistence-operations.md); repository tests do not
choose those values.
