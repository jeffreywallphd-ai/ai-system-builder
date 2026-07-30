import type { AssetImplementationDeploymentProfile } from "../asset-implementation";
import type { OrganizationId } from "../organization";
import type { SystemReleaseId } from "../system-build";
import type { WorkspaceId } from "../workspace";
import type {
  SystemDeploymentId,
  SystemDeploymentRunId,
} from "./system-deployment-id";
import type { SystemDeploymentCapabilityPolicy } from "./system-deployment-models";

export interface SystemDeploymentContext {
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly actorId: string;
}

export interface InstallSystemDeploymentCommand extends SystemDeploymentContext {
  readonly deploymentId: SystemDeploymentId;
  readonly releaseId: SystemReleaseId;
  readonly deploymentProfile: AssetImplementationDeploymentProfile;
  readonly hostTargetId?: string;
  readonly hostApiVersion: string;
  readonly runtimeAbiVersion?: string;
  readonly hostCapabilities: readonly string[];
  readonly sandboxQualified: boolean;
  readonly policy: SystemDeploymentCapabilityPolicy;
}

export interface ActivateSystemDeploymentCommand extends SystemDeploymentContext {
  readonly deploymentId: SystemDeploymentId;
}

export interface DeactivateSystemDeploymentCommand
  extends SystemDeploymentContext {
  readonly deploymentId: SystemDeploymentId;
}

export interface UninstallSystemDeploymentCommand
  extends SystemDeploymentContext {
  readonly deploymentId: SystemDeploymentId;
}

export interface RollbackSystemDeploymentCommand extends SystemDeploymentContext {
  readonly deploymentId: SystemDeploymentId;
}

export interface RevokeSystemDeploymentCommand extends SystemDeploymentContext {
  readonly deploymentId: SystemDeploymentId;
}

export interface ReconcileSystemDeploymentHealthCommand extends SystemDeploymentContext {
  readonly deploymentId: SystemDeploymentId;
}

export interface ReadSystemDeploymentQuery extends SystemDeploymentContext {
  readonly deploymentId: SystemDeploymentId;
}

export interface ListSystemDeploymentsQuery extends SystemDeploymentContext {
  readonly releaseId?: SystemReleaseId;
}

export interface StartSystemDeploymentRunCommand extends SystemDeploymentContext {
  readonly deploymentId: SystemDeploymentId;
  readonly runId: SystemDeploymentRunId;
  readonly requestedCapabilities: readonly string[];
  readonly requestedSecretReferences: readonly string[];
  readonly requestedEgressOrigins: readonly string[];
}

export interface CancelSystemDeploymentRunCommand extends SystemDeploymentContext {
  readonly runId: SystemDeploymentRunId;
}

export interface ListSystemDeploymentRunsQuery extends SystemDeploymentContext {
  readonly deploymentId?: SystemDeploymentId;
  readonly limit?: number;
}

export interface ListSystemDeploymentAuditQuery extends SystemDeploymentContext {
  readonly deploymentId: SystemDeploymentId;
  readonly limit?: number;
}

export type SystemPublishedLifecycleAction =
  | "install"
  | "activate"
  | "deactivate"
  | "start"
  | "stop"
  | "uninstall";

export interface ReadSystemPublishedLifecycleQuery
  extends SystemDeploymentContext {
  readonly releaseId: SystemReleaseId;
}

export interface InvokeSystemPublishedLifecycleCommand
  extends ReadSystemPublishedLifecycleQuery {
  readonly action: SystemPublishedLifecycleAction;
  /** Opaque freshness guard; never an authority-bearing deployment id. */
  readonly expectedRevision: string;
}
