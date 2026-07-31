import type { OrganizationId } from "../organization";
import {
  normalizeSystemReleaseId,
  type SystemReleaseId,
} from "../system-build";
import type { WorkspaceId } from "../workspace";
import {
  normalizeSystemDeploymentId,
  type SystemDeploymentId,
} from "./system-deployment-id";

const SAFE_RUNTIME_INSTANCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;

export type SystemRuntimeInstanceId = string & {
  readonly __systemRuntimeInstanceIdBrand: unique symbol;
};

export type SystemRuntimeDataBindingId = string & {
  readonly __systemRuntimeDataBindingIdBrand: unique symbol;
};

function normalizeOpaqueId<T extends string>(value: unknown, label: string): T {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    !SAFE_RUNTIME_INSTANCE_ID.test(normalized) ||
    normalized.includes("..") ||
    /[\\/]/.test(normalized)
  ) {
    const error = new Error(`${label} must be a safe opaque identifier.`);
    error.stack = undefined;
    throw error;
  }
  return normalized as T;
}

export const normalizeSystemRuntimeInstanceId = (value: unknown) =>
  normalizeOpaqueId<SystemRuntimeInstanceId>(value, "System runtime instance id");

export const normalizeSystemRuntimeDataBindingId = (value: unknown) =>
  normalizeOpaqueId<SystemRuntimeDataBindingId>(
    value,
    "System runtime data binding id",
  );

export type SystemRuntimeDatabaseEngine = "sqlite" | "postgres";

export type SystemRuntimeInstanceStatus =
  | "allocated"
  | "active"
  | "stopped"
  | "retained"
  | "failed"
  | "deleting"
  | "deleted";

export interface SystemRuntimeDeploymentBinding {
  readonly deploymentId: SystemDeploymentId;
  readonly releaseId: SystemReleaseId;
  readonly boundAt: string;
}

export interface SystemRuntimeInstance {
  readonly runtimeInstanceId: SystemRuntimeInstanceId;
  readonly dataBindingId: SystemRuntimeDataBindingId;
  readonly databaseEngine: SystemRuntimeDatabaseEngine;
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly deploymentId: SystemDeploymentId;
  readonly releaseId: SystemReleaseId;
  /** Includes the origin binding and every explicitly migrated compatible release. */
  readonly deploymentBindings?: readonly SystemRuntimeDeploymentBinding[];
  readonly status: SystemRuntimeInstanceStatus;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly activatedAt?: string;
  readonly stoppedAt?: string;
  readonly retainedAt?: string;
  readonly deletedAt?: string;
  readonly failureCode?: string;
}

export function normalizeSystemRuntimeDeploymentBindings(
  instance: Pick<
    SystemRuntimeInstance,
    "deploymentId" | "releaseId" | "createdAt" | "deploymentBindings"
  >,
): readonly SystemRuntimeDeploymentBinding[] {
  const source =
    instance.deploymentBindings?.length
      ? instance.deploymentBindings
      : [
          {
            deploymentId: instance.deploymentId,
            releaseId: instance.releaseId,
            boundAt: instance.createdAt,
          },
        ];
  if (source.length > 64) {
    throw new Error("A runtime instance cannot retain more than 64 deployment bindings.");
  }
  const seen = new Set<string>();
  return source.map((binding) => {
    const deploymentId = normalizeSystemDeploymentId(binding.deploymentId);
    const releaseId = normalizeSystemReleaseId(binding.releaseId);
    const key = `${deploymentId}/${releaseId}`;
    if (seen.has(key)) {
      throw new Error("Runtime deployment bindings must be unique.");
    }
    seen.add(key);
    return {
      deploymentId,
      releaseId,
      boundAt: binding.boundAt,
    };
  });
}

export function isSystemRuntimeInstanceBoundToDeployment(
  instance: SystemRuntimeInstance,
  deploymentId: SystemDeploymentId,
  releaseId: SystemReleaseId,
): boolean {
  return normalizeSystemRuntimeDeploymentBindings(instance).some(
    (binding) =>
      binding.deploymentId === deploymentId && binding.releaseId === releaseId,
  );
}

export interface SystemRuntimeDatabaseHealth {
  readonly healthy: boolean;
  readonly schemaVersion: number;
  readonly expectedSchemaVersion: number;
  readonly diagnosticCode?: string;
}

export interface SystemRuntimeDatabaseBackup {
  readonly backupId: string;
  readonly runtimeInstanceId: SystemRuntimeInstanceId;
  readonly createdAt: string;
  readonly verified: boolean;
}

export interface SystemRuntimeInstanceDeletionConfirmation {
  readonly runtimeInstanceId: SystemRuntimeInstanceId;
  readonly confirmation: "delete-retained-runtime-data";
}
