import type { OrganizationId } from "../../../contracts/organization";
import type {
  SystemDeployment,
  SystemDeploymentAuditEntry,
  SystemDeploymentId,
  SystemDeploymentRun,
  SystemDeploymentRunId,
} from "../../../contracts/system-deployment";
import type { SystemReleaseId } from "../../../contracts/system-build";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface SystemDeploymentRepositoryPort {
  createDeployment(deployment: SystemDeployment): Promise<SystemDeployment>;
  readDeployment(
    organizationId: OrganizationId,
    workspaceId: WorkspaceId,
    deploymentId: SystemDeploymentId,
  ): Promise<SystemDeployment | undefined>;
  listDeployments(
    organizationId: OrganizationId,
    workspaceId: WorkspaceId,
    releaseId?: SystemReleaseId,
  ): Promise<readonly SystemDeployment[]>;
  readCurrentDeployment(
    organizationId: OrganizationId,
    workspaceId: WorkspaceId,
    releaseId: SystemReleaseId,
    hostTargetId: string,
  ): Promise<SystemDeployment | undefined>;
  createCurrentDeployment(
    deployment: SystemDeployment,
  ): Promise<SystemDeployment>;
  updateDeployment(
    deployment: SystemDeployment,
    expectedRevision: number,
  ): Promise<SystemDeployment>;
  retireCurrentDeployment(
    deployment: SystemDeployment,
    expectedRevision: number,
  ): Promise<SystemDeployment>;
  createRun(run: SystemDeploymentRun): Promise<SystemDeploymentRun>;
  readRun(
    organizationId: OrganizationId,
    workspaceId: WorkspaceId,
    runId: SystemDeploymentRunId,
  ): Promise<SystemDeploymentRun | undefined>;
  listRuns(
    organizationId: OrganizationId,
    workspaceId: WorkspaceId,
    deploymentId?: SystemDeploymentId,
  ): Promise<readonly SystemDeploymentRun[]>;
  updateRun(
    run: SystemDeploymentRun,
    expectedRevision: number,
  ): Promise<SystemDeploymentRun>;
  appendAudit(entry: SystemDeploymentAuditEntry): Promise<void>;
  listAudit(
    organizationId: OrganizationId,
    workspaceId: WorkspaceId,
    deploymentId: SystemDeploymentId,
    limit: number,
  ): Promise<readonly SystemDeploymentAuditEntry[]>;
}
