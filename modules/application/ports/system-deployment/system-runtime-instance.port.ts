import type { OrganizationId } from "../../../contracts/organization";
import type { SystemReleaseId } from "../../../contracts/system-build";
import type {
  SystemDeploymentId,
  SystemRuntimeDatabaseBackup,
  SystemRuntimeDatabaseEngine,
  SystemRuntimeDatabaseHealth,
  SystemRuntimeDataBindingId,
  SystemRuntimeInstance,
  SystemRuntimeDeploymentBinding,
  SystemRuntimeInstanceDeletionConfirmation,
  SystemRuntimeInstanceId,
} from "../../../contracts/system-deployment";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface SystemRuntimeInstanceRepositoryPort {
  createRuntimeInstance(instance: SystemRuntimeInstance): Promise<SystemRuntimeInstance>;
  readRuntimeInstance(
    organizationId: OrganizationId,
    workspaceId: WorkspaceId,
    runtimeInstanceId: SystemRuntimeInstanceId,
  ): Promise<SystemRuntimeInstance | undefined>;
  readRuntimeInstanceByDeployment(
    organizationId: OrganizationId,
    workspaceId: WorkspaceId,
    deploymentId: SystemDeploymentId,
  ): Promise<SystemRuntimeInstance | undefined>;
  listRuntimeInstances(
    organizationId: OrganizationId,
    workspaceId: WorkspaceId,
  ): Promise<readonly SystemRuntimeInstance[]>;
  updateRuntimeInstance(
    instance: SystemRuntimeInstance,
    expectedRevision: number,
  ): Promise<SystemRuntimeInstance>;
  bindRuntimeInstanceDeployment(
    instance: SystemRuntimeInstance,
    binding: SystemRuntimeDeploymentBinding,
    expectedRevision: number,
  ): Promise<SystemRuntimeInstance>;
}

export interface ProvisionSystemRuntimeDatabaseRequest {
  readonly runtimeInstanceId: SystemRuntimeInstanceId;
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
}

export interface ProvisionedSystemRuntimeDatabase {
  readonly dataBindingId: SystemRuntimeDataBindingId;
  readonly databaseEngine: SystemRuntimeDatabaseEngine;
}

/** Host-owned physical database boundary; callers never provide physical details. */
export interface SystemRuntimeDatabaseLifecyclePort {
  provision(request: ProvisionSystemRuntimeDatabaseRequest): Promise<ProvisionedSystemRuntimeDatabase>;
  open(instance: SystemRuntimeInstance): Promise<SystemRuntimeDatabaseHealth>;
  migrate(instance: SystemRuntimeInstance): Promise<SystemRuntimeDatabaseHealth>;
  close(instance: SystemRuntimeInstance): Promise<void>;
  retain(instance: SystemRuntimeInstance): Promise<void>;
  createBackup(instance: SystemRuntimeInstance): Promise<SystemRuntimeDatabaseBackup>;
  restoreBackup(instance: SystemRuntimeInstance, backupId: string): Promise<SystemRuntimeDatabaseHealth>;
  deleteRetained(
    instance: SystemRuntimeInstance,
    confirmation: SystemRuntimeInstanceDeletionConfirmation,
  ): Promise<void>;
}

export interface AllocateSystemRuntimeInstanceRequest {
  readonly runtimeInstanceId: SystemRuntimeInstanceId;
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly deploymentId: SystemDeploymentId;
  readonly releaseId: SystemReleaseId;
}

export interface SystemRuntimeInstanceLifecyclePort {
  allocate(request: AllocateSystemRuntimeInstanceRequest): Promise<SystemRuntimeInstance>;
  activate(instance: SystemRuntimeInstance): Promise<SystemRuntimeInstance>;
  migrate(
    instance: SystemRuntimeInstance,
    binding: Omit<SystemRuntimeDeploymentBinding, "boundAt">,
  ): Promise<SystemRuntimeInstance>;
  stop(instance: SystemRuntimeInstance): Promise<SystemRuntimeInstance>;
  retain(instance: SystemRuntimeInstance): Promise<SystemRuntimeInstance>;
  backup(instance: SystemRuntimeInstance): Promise<SystemRuntimeDatabaseBackup>;
  restore(instance: SystemRuntimeInstance, backupId: string): Promise<SystemRuntimeInstance>;
  deleteRetained(
    instance: SystemRuntimeInstance,
    confirmation: SystemRuntimeInstanceDeletionConfirmation,
  ): Promise<SystemRuntimeInstance>;
}
