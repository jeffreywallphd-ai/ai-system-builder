import type {
  SystemDeploymentCapabilityPolicy,
  SystemDeploymentDiagnostic,
  SystemDeploymentRun,
} from "../../../contracts/system-deployment";

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const TOKEN_LIKE = /(?:secret|token|password|credential|api[_-]?key)=/i;

export class SystemDeploymentPolicyService {
  validate(
    policy: SystemDeploymentCapabilityPolicy,
  ): readonly SystemDeploymentDiagnostic[] {
    const diagnostics: SystemDeploymentDiagnostic[] = [];
    if (
      !integerBetween(policy.quotas.maximumRunSeconds, 1, 3600) ||
      !integerBetween(policy.quotas.maximumMemoryMiB, 64, 32768) ||
      !integerBetween(policy.quotas.maximumOutputBytes, 1, 64 * 1024 * 1024) ||
      !integerBetween(policy.quotas.maximumConcurrentRuns, 1, 32)
    )
      diagnostics.push(
        error(
          "deployment.policy.quota-invalid",
          "Deployment quotas are outside supported bounds.",
        ),
      );
    if (
      policy.allowedCapabilities.length > 64 ||
      policy.allowedCapabilities.some((value) => !SAFE_NAME.test(value))
    )
      diagnostics.push(
        error(
          "deployment.policy.capability-invalid",
          "Deployment capability declarations are invalid.",
        ),
      );
    if (
      policy.allowedSecretReferences.length > 32 ||
      policy.allowedSecretReferences.some(
        (value) => !SAFE_NAME.test(value) || TOKEN_LIKE.test(value),
      )
    )
      diagnostics.push(
        error(
          "deployment.policy.secret-reference-invalid",
          "Deployment secret references must be opaque identifiers.",
        ),
      );
    if (
      policy.egress.allowedOrigins.length > 32 ||
      policy.egress.allowedOrigins.some((value) => !safeOrigin(value)) ||
      (policy.egress.mode === "deny-all" && policy.egress.allowedOrigins.length)
    )
      diagnostics.push(
        error(
          "deployment.policy.egress-invalid",
          "Deployment egress policy is invalid.",
        ),
      );
    return diagnostics;
  }

  validateNarrowing(
    requested: SystemDeploymentCapabilityPolicy,
    platform: SystemDeploymentCapabilityPolicy,
  ): readonly SystemDeploymentDiagnostic[] {
    const diagnostics: SystemDeploymentDiagnostic[] = [];
    const platformCapabilities = new Set(platform.allowedCapabilities);
    const platformSecrets = new Set(platform.allowedSecretReferences);
    const platformOrigins = new Set(platform.egress.allowedOrigins);
    if (
      requested.allowedCapabilities.some(
        (value) => !platformCapabilities.has(value),
      )
    )
      diagnostics.push(
        error(
          "deployment.policy.capability-widening",
          "Deployment policy cannot widen platform capabilities.",
        ),
      );
    if (
      requested.allowedSecretReferences.some(
        (value) => !platformSecrets.has(value),
      )
    )
      diagnostics.push(
        error(
          "deployment.policy.secret-widening",
          "Deployment policy cannot widen platform secret references.",
        ),
      );
    if (
      requested.egress.mode === "allowlist" &&
      (platform.egress.mode === "deny-all" ||
        requested.egress.allowedOrigins.some(
          (value) => !platformOrigins.has(value),
        ))
    )
      diagnostics.push(
        error(
          "deployment.policy.egress-widening",
          "Deployment policy cannot widen platform egress.",
        ),
      );
    if (
      requested.quotas.maximumRunSeconds > platform.quotas.maximumRunSeconds ||
      requested.quotas.maximumMemoryMiB > platform.quotas.maximumMemoryMiB ||
      requested.quotas.maximumOutputBytes >
        platform.quotas.maximumOutputBytes ||
      requested.quotas.maximumConcurrentRuns >
        platform.quotas.maximumConcurrentRuns
    )
      diagnostics.push(
        error(
          "deployment.policy.quota-widening",
          "Deployment quotas cannot exceed platform ceilings.",
        ),
      );
    return diagnostics;
  }

  authorizeRun(
    policy: SystemDeploymentCapabilityPolicy,
    run: Pick<
      SystemDeploymentRun,
      | "requestedCapabilities"
      | "requestedSecretReferences"
      | "requestedEgressOrigins"
    >,
    activeRunCount: number,
  ): readonly SystemDeploymentDiagnostic[] {
    const diagnostics: SystemDeploymentDiagnostic[] = [];
    const allowedCapabilities = new Set(policy.allowedCapabilities);
    const allowedSecrets = new Set(policy.allowedSecretReferences);
    const allowedOrigins = new Set(policy.egress.allowedOrigins);
    if (
      run.requestedCapabilities.some((value) => !allowedCapabilities.has(value))
    )
      diagnostics.push(
        error(
          "deployment.capability.denied",
          "A requested capability is not allowed.",
        ),
      );
    if (
      run.requestedSecretReferences.some((value) => !allowedSecrets.has(value))
    )
      diagnostics.push(
        error(
          "deployment.secret-reference.denied",
          "A requested secret reference is not allowed.",
        ),
      );
    if (
      policy.egress.mode === "deny-all"
        ? run.requestedEgressOrigins.length > 0
        : run.requestedEgressOrigins.some((value) => !allowedOrigins.has(value))
    )
      diagnostics.push(
        error(
          "deployment.egress.denied",
          "A requested egress origin is not allowed.",
        ),
      );
    if (activeRunCount >= policy.quotas.maximumConcurrentRuns)
      diagnostics.push(
        error(
          "deployment.quota.concurrent-runs",
          "The concurrent-run quota is exhausted.",
        ),
      );
    return diagnostics;
  }
}

const integerBetween = (value: number, minimum: number, maximum: number) =>
  Number.isInteger(value) && value >= minimum && value <= maximum;

function safeOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

const error = (code: string, message: string): SystemDeploymentDiagnostic => ({
  severity: "error",
  code,
  message,
});
