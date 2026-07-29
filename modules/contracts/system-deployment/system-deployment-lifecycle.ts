import type { SystemReleaseId } from "../system-build";
import type { SystemPublishedLifecycleAction } from "./system-deployment-commands";
import type {
  SystemDeploymentDiagnostic,
  SystemDeploymentHealthStatus,
  SystemDeploymentLaunchDescriptor,
  SystemDeploymentRuntimeKind,
} from "./system-deployment-models";

export const SYSTEM_PUBLISHED_LIFECYCLE_SCHEMA_VERSION = "1.0" as const;

export type SystemPublishedLifecycleState =
  | "not-installed"
  | "active-stopped"
  | "inactive-stopped"
  | "running"
  | "recovering";

export interface SystemPublishedLifecycleProjection {
  readonly schemaVersion: typeof SYSTEM_PUBLISHED_LIFECYCLE_SCHEMA_VERSION;
  readonly releaseId: SystemReleaseId;
  readonly state: SystemPublishedLifecycleState;
  readonly revision: string;
  readonly eligibleActions: readonly SystemPublishedLifecycleAction[];
  readonly health: SystemDeploymentHealthStatus;
  readonly runtimeKind?: SystemDeploymentRuntimeKind;
  readonly launchDescriptor?: SystemDeploymentLaunchDescriptor;
  readonly diagnostics: readonly SystemDeploymentDiagnostic[];
}
