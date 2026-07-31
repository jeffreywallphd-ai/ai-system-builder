const checks = {
  dockerfile: [
    [
      /^FROM node:24-bookworm-slim@sha256:[a-f0-9]{64} AS build$/m,
      "build base image is not digest-pinned",
    ],
    [
      /^FROM node:24-bookworm-slim@sha256:[a-f0-9]{64} AS runtime$/m,
      "runtime base image is not digest-pinned",
    ],
    [
      /npm ci --ignore-scripts --no-audit --no-fund/,
      "build does not use the locked dependency tree",
    ],
    [
      /npm ci --omit=dev --ignore-scripts --no-audit --no-fund/,
      "runtime installs development dependencies",
    ],
    [/^USER node$/m, "runtime image does not declare a non-root user"],
    [/^HEALTHCHECK /m, "runtime image has no health check"],
  ],
  compose: [
    [
      /image: postgres:18-bookworm@sha256:[a-f0-9]{64}/,
      "Compose PostgreSQL image is not digest-pinned",
    ],
    [
      /image: ai-system-builder:qualification/,
      "Compose does not name the qualified application image",
    ],
    [
      /condition: service_healthy/,
      "Compose does not wait for PostgreSQL health",
    ],
    [/read_only: true/, "Compose application root filesystem is writable"],
    [/no-new-privileges:true/, "Compose does not prevent privilege escalation"],
    [/cap_drop:\s*\n\s*- ALL/, "Compose does not drop Linux capabilities"],
    [
      /AI_SYSTEM_BUILDER_SECURITY_MODE: oidc-bearer/,
      "Compose does not use managed OIDC",
    ],
    [
      /AI_SYSTEM_BUILDER_TENANT_PLACEMENT_MODE: pooled/,
      "Compose does not qualify the default pooled placement",
    ],
    [
      /tmpfs:\s*\n\s*- \/tmp:/,
      "Compose does not provide bounded temporary storage",
    ],
  ],
  kubernetes: [
    [/replicas: 1/, "Kubernetes template is not explicitly single-replica"],
    [
      /strategy:\s*\n\s*type: Recreate/,
      "Kubernetes template may create overlapping replicas",
    ],
    [
      /automountServiceAccountToken: false/,
      "Kubernetes template mounts an unused service-account token",
    ],
    [
      /runAsNonRoot: true/,
      "Kubernetes template does not require a non-root identity",
    ],
    [
      /seccompProfile:\s*\n\s*type: RuntimeDefault/,
      "Kubernetes template does not use the runtime-default seccomp profile",
    ],
    [
      /allowPrivilegeEscalation: false/,
      "Kubernetes container allows privilege escalation",
    ],
    [
      /readOnlyRootFilesystem: true/,
      "Kubernetes container root filesystem is writable",
    ],
    [
      /capabilities:\s*\n\s*drop:\s*\n\s*- ALL/,
      "Kubernetes container does not drop all capabilities",
    ],
    [
      /startupProbe:[\s\S]*path: \/health\/live/,
      "Kubernetes startup probe is missing",
    ],
    [
      /livenessProbe:[\s\S]*path: \/health\/live/,
      "Kubernetes liveness probe is missing",
    ],
    [
      /readinessProbe:[\s\S]*path: \/health\/ready/,
      "Kubernetes readiness probe is missing",
    ],
    [
      /resources:\s*\n\s*requests:[\s\S]*limits:/,
      "Kubernetes resource requests or limits are missing",
    ],
    [
      /image: [^\s]+@sha256:/,
      "Kubernetes image is not expressed as an immutable digest",
    ],
    [/value: oidc-bearer/, "Kubernetes template does not use managed OIDC"],
    [
      /value: pooled/,
      "Kubernetes template does not declare pooled default placement",
    ],
  ],
  runner: [
    [
      /pod-security\.kubernetes\.io\/enforce: restricted/,
      "runner namespace does not enforce the Restricted Pod Security standard",
    ],
    [/kind: ResourceQuota/, "runner namespace has no aggregate resource quota"],
    [
      /kind: LimitRange/,
      "runner namespace has no per-container resource defaults and ceilings",
    ],
    [
      /kind: NetworkPolicy[\s\S]*podSelector: \{\}[\s\S]*- Egress/,
      "runner namespace is not default-deny for network egress",
    ],
    [/suspend: true/, "runner specimen is not safely suspended"],
    [/backoffLimit: 0/, "runner jobs may retry execution implicitly"],
    [
      /activeDeadlineSeconds: 300/,
      "runner jobs have no bounded execution deadline",
    ],
    [
      /automountServiceAccountToken: false/,
      "runner mounts an unused service-account token",
    ],
    [/runAsNonRoot: true/, "runner does not require a non-root identity"],
    [
      /seccompProfile:\s*\n\s*type: RuntimeDefault/,
      "runner does not use runtime-default seccomp",
    ],
    [/allowPrivilegeEscalation: false/, "runner permits privilege escalation"],
    [/readOnlyRootFilesystem: true/, "runner root filesystem is writable"],
    [
      /capabilities:\s*\n\s*drop:\s*\n\s*- ALL/,
      "runner does not drop all Linux capabilities",
    ],
    [
      /startupProbe:[\s\S]*path: \/health\/startup/,
      "runner startup probe is missing",
    ],
    [
      /readinessProbe:[\s\S]*path: \/health\/ready/,
      "runner readiness probe is missing",
    ],
    [
      /livenessProbe:[\s\S]*path: \/health\/live/,
      "runner liveness probe is missing",
    ],
    [
      /preStop:[\s\S]*path: \/control\/cancel/,
      "runner has no graceful cancellation hook",
    ],
    [/ephemeral-storage: 128Mi/, "runner temporary-storage limit is missing"],
    [
      /image: [^\s]+@sha256:/,
      "runner image is not expressed as an immutable digest",
    ],
    [
      /secretKeyRef:/,
      "runner does not inject opaque secret references through the platform boundary",
    ],
    [
      /tenant\.ai-system-builder\.io\/scope:/,
      "runner workload has no opaque tenant scope label",
    ],
  ],
  kustomization: [
    [
      /apiVersion: kustomize\.config\.k8s\.io\/v1beta1/,
      "Kustomize composition has no supported API version",
    ],
    [/kind: Kustomization/, "Kustomize composition has no resource kind"],
    [
      /- kubernetes-deployment\.example\.yaml/,
      "Kustomize composition omits the managed deployment template",
    ],
    [
      /- kubernetes-runner\.example\.yaml/,
      "Kustomize composition omits the managed runner template",
    ],
  ],
  workflow: [
    [
      /deployment-artifacts:/,
      "CI has no deployment-artifact qualification job",
    ],
    [
      /docker compose .* up --build --detach --wait/,
      "CI does not wait for the Compose application to become healthy",
    ],
    [
      /kubectl kustomize deployments\/server/,
      "CI does not render the Kubernetes resources offline",
    ],
    [
      /anchore\/scan-action@[a-f0-9]{40}/,
      "CI image scanner is not pinned to a full action SHA",
    ],
    [
      /docker compose .* down --volumes --remove-orphans/,
      "CI does not tear down the qualification stack",
    ],
  ],
};

export function inspectServerDeploymentArtifacts(sources) {
  const violations = [];
  for (const [sourceName, sourceChecks] of Object.entries(checks)) {
    const source = sources[sourceName];
    for (const [pattern, message] of sourceChecks) {
      if (!pattern.test(source)) violations.push(`${sourceName}: ${message}`);
    }
  }
  if (
    /\b(?:node|postgres):latest\b/.test(
      `${sources.dockerfile}\n${sources.compose}`,
    )
  ) {
    violations.push("container inputs must not use latest tags");
  }
  if (/\bhostPath:/.test(sources.kubernetes)) {
    violations.push(
      "kubernetes: hostPath storage is not allowed in the managed template",
    );
  }
  if (/\bhostPath:/.test(sources.runner)) {
    violations.push(
      "runner: hostPath storage is not allowed in the managed runner template",
    );
  }
  return violations;
}
