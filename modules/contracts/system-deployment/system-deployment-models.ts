import type {
  AssetImplementationDeploymentProfile,
  AssetImplementationRuntimeKind,
  AssetImplementationTrustLevel,
} from "../asset-implementation";
import type { OrganizationId } from "../organization";
import type {
  SystemBuildDigest,
  SystemBuildRuntimeInteractionBinding,
  SystemBuildRuntimeResourceBinding,
  SystemReleaseId,
} from "../system-build";
import type { WorkspaceId } from "../workspace";
import type {
  SystemDeploymentAuditId,
  SystemDeploymentId,
  SystemDeploymentRunId,
} from "./system-deployment-id";
import type { SystemRuntimeInstanceId } from "./system-runtime-instance";

export type SystemReferenceRuntimeKind =
  | "secured-data-entry"
  | "controlled-chatbot"
  | "secured-data-review"
  | "custom";

export const SYSTEM_RUNTIME_PROFILE_IDS = {
  securedDataEntry: "builtin.runtime.secured-data-entry@1.0.0",
  controlledChatbot: "builtin.runtime.controlled-chatbot@1.0.0",
  securedDataReview: "builtin.runtime.secured-data-review@1.0.0",
  unqualifiedCustom: "custom.runtime.unqualified@1.0.0",
} as const;

export type SystemRuntimeProfileId = string;

const SAFE_RUNTIME_PROFILE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,199}$/;
const SAFE_HOST_TARGET_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;

export const normalizeSystemRuntimeProfileId = (
  value: unknown,
): SystemRuntimeProfileId => {
  if (
    typeof value !== "string" ||
    !SAFE_RUNTIME_PROFILE_ID.test(value.trim()) ||
    value.includes("..")
  )
    throw new Error("System runtime profile id is invalid.");
  return value.trim();
};

export const normalizeSystemDeploymentHostTargetId = (
  value: unknown,
): string => {
  if (
    typeof value !== "string" ||
    !SAFE_HOST_TARGET_ID.test(value.trim()) ||
    value.includes("..")
  )
    throw new Error("System deployment host target id is invalid.");
  return value.trim();
};

export const resolveSystemDeploymentHostTargetId = (
  deployment: Pick<SystemDeployment, "hostTargetId" | "deploymentProfile">,
): string =>
  normalizeSystemDeploymentHostTargetId(
    deployment.hostTargetId ?? deployment.deploymentProfile,
  );

export const mapLegacySystemReferenceRuntimeKind = (
  kind: SystemReferenceRuntimeKind,
): SystemRuntimeProfileId =>
  ({
    "secured-data-entry": SYSTEM_RUNTIME_PROFILE_IDS.securedDataEntry,
    "controlled-chatbot": SYSTEM_RUNTIME_PROFILE_IDS.controlledChatbot,
    "secured-data-review": SYSTEM_RUNTIME_PROFILE_IDS.securedDataReview,
    custom: SYSTEM_RUNTIME_PROFILE_IDS.unqualifiedCustom,
  })[kind];

export const normalizeSystemDeploymentRuntimeIdentity = <
  T extends {
    readonly runtimeProfileId?: unknown;
    readonly referenceRuntimeKind?: unknown;
  },
>(
  deployment: T,
): T & { readonly runtimeProfileId: SystemRuntimeProfileId } => {
  const legacy = deployment.referenceRuntimeKind;
  const legacyProfile =
    legacy === "secured-data-entry" ||
    legacy === "controlled-chatbot" ||
    legacy === "secured-data-review" ||
    legacy === "custom"
      ? mapLegacySystemReferenceRuntimeKind(legacy)
      : undefined;
  const runtimeProfileId =
    deployment.runtimeProfileId === undefined
      ? legacyProfile
      : normalizeSystemRuntimeProfileId(deployment.runtimeProfileId);
  if (!runtimeProfileId)
    throw new Error("System deployment runtime identity is missing.");
  if (legacyProfile && legacyProfile !== runtimeProfileId)
    throw new Error("System deployment runtime identities conflict.");
  return { ...deployment, runtimeProfileId };
};

export type SystemDeploymentStatus =
  | "installed"
  | "activating"
  | "active"
  | "degraded"
  | "inactive"
  | "uninstalling"
  | "uninstalled"
  | "rolling-back"
  | "failed"
  | "revoked";

export type SystemDeploymentHealthStatus =
  "unknown" | "starting" | "ready" | "not-ready" | "unhealthy" | "stopped";

export interface SystemDeploymentDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
}

export interface SystemDeploymentQuotaPolicy {
  readonly maximumRunSeconds: number;
  readonly maximumMemoryMiB: number;
  readonly maximumOutputBytes: number;
  readonly maximumConcurrentRuns: number;
}

export interface SystemDeploymentEgressPolicy {
  readonly mode: "deny-all" | "allowlist";
  readonly allowedOrigins: readonly string[];
}

export interface SystemDeploymentCapabilityPolicy {
  readonly allowedCapabilities: readonly string[];
  readonly allowedSecretReferences: readonly string[];
  readonly egress: SystemDeploymentEgressPolicy;
  readonly quotas: SystemDeploymentQuotaPolicy;
}

export interface SystemDeploymentCompatibilityEvidence {
  readonly compatible: boolean;
  readonly deploymentProfile: AssetImplementationDeploymentProfile;
  readonly hostApiVersion: string;
  readonly runtimeAbiVersion?: string;
  readonly runtimeKinds: readonly AssetImplementationRuntimeKind[];
  readonly trustLevels: readonly AssetImplementationTrustLevel[];
  readonly sandboxRequired: boolean;
  readonly sandboxQualified: boolean;
  readonly checkedAt: string;
  readonly diagnostics: readonly SystemDeploymentDiagnostic[];
}

export interface SystemDeploymentHealth {
  readonly status: SystemDeploymentHealthStatus;
  readonly checkedAt: string;
  readonly diagnostics: readonly SystemDeploymentDiagnostic[];
}

export interface SystemDeployment {
  readonly deploymentId: SystemDeploymentId;
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly releaseId: SystemReleaseId;
  readonly releaseDigest: SystemBuildDigest;
  /** Opaque host-owned data-plane identity; physical database details stay private. */
  readonly runtimeInstanceId?: SystemRuntimeInstanceId;
  /** Stable application-owned runtime handler identity for new records. */
  readonly runtimeProfileId?: SystemRuntimeProfileId;
  /** @deprecated Read-only compatibility input for records written before runtime profiles. */
  readonly referenceRuntimeKind?: SystemReferenceRuntimeKind;
  readonly deploymentProfile: AssetImplementationDeploymentProfile;
  /** Stable host-owned target. Legacy records use deploymentProfile. */
  readonly hostTargetId?: string;
  readonly status: SystemDeploymentStatus;
  readonly revision: number;
  readonly previousDeploymentId?: SystemDeploymentId;
  readonly compatibility: SystemDeploymentCompatibilityEvidence;
  readonly policy: SystemDeploymentCapabilityPolicy;
  readonly health: SystemDeploymentHealth;
  readonly installedAt: string;
  readonly installedBy: string;
  readonly updatedAt: string;
  readonly activatedAt?: string;
  readonly activatedBy?: string;
  readonly revokedAt?: string;
  readonly revokedBy?: string;
  readonly uninstalledAt?: string;
  readonly uninstalledBy?: string;
}

export type SystemDeploymentRunStatus =
  "queued" | "running" | "stopping" | "succeeded" | "failed" | "cancelled";

export type SystemDeploymentRuntimeKind = "visual" | "service";

export interface SystemDeploymentLaunchDescriptor {
  readonly schemaVersion: "1.0";
  readonly kind: "trusted-declarative";
  readonly releaseId: SystemReleaseId;
  readonly releaseDigest: SystemBuildDigest;
  readonly runtimeProfileId: SystemRuntimeProfileId;
  readonly runtimeResourceBindings?: readonly SystemBuildRuntimeResourceBinding[];
  readonly runtimeInteractionBindings?: readonly SystemBuildRuntimeInteractionBinding[];
}

export interface SystemDeploymentRunUsage {
  readonly durationMilliseconds: number;
  readonly outputBytes: number;
}

export interface SystemDeploymentRun {
  readonly runId: SystemDeploymentRunId;
  readonly deploymentId: SystemDeploymentId;
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly releaseId: SystemReleaseId;
  readonly runtimeKind?: SystemDeploymentRuntimeKind;
  readonly launchDescriptor?: SystemDeploymentLaunchDescriptor;
  readonly status: SystemDeploymentRunStatus;
  readonly revision: number;
  readonly cancellationRequested: boolean;
  readonly requestedCapabilities: readonly string[];
  readonly requestedSecretReferences: readonly string[];
  readonly requestedEgressOrigins: readonly string[];
  readonly diagnostics: readonly SystemDeploymentDiagnostic[];
  readonly usage?: SystemDeploymentRunUsage;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly requestedBy: string;
}

export interface SystemDeploymentAuditEntry {
  readonly auditId: SystemDeploymentAuditId;
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly deploymentId: SystemDeploymentId;
  readonly runId?: SystemDeploymentRunId;
  readonly action:
      | "install"
      | "activate"
      | "deactivate"
      | "uninstall"
      | "health"
    | "rollback"
    | "revoke"
    | "run-start"
    | "run-cancel"
    | "capability";
  readonly outcome: "allowed" | "denied" | "failed";
  readonly actorId: string;
  readonly reasonCode: string;
  readonly occurredAt: string;
}
