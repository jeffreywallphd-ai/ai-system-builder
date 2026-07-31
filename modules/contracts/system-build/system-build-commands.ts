import type { AssetImplementationDeploymentProfile, AssetImplementationTrustLevel } from "../asset-implementation";
import type { WorkspaceId } from "../workspace";
import type { SystemBuilderRevisionId, SystemBuilderSystemId } from "../system-builder";
import type { SystemBuildId, SystemReleaseId } from "./system-build-id";

export interface RequestSystemBuildCommand {
  readonly buildId: SystemBuildId;
  readonly workspaceId: WorkspaceId;
  readonly systemId: SystemBuilderSystemId;
  readonly systemRevisionId: SystemBuilderRevisionId;
  readonly deploymentProfile: AssetImplementationDeploymentProfile;
  readonly availableCapabilities: readonly string[];
  readonly permittedTrustLevels: readonly AssetImplementationTrustLevel[];
  readonly hostApiVersion: string;
  readonly runtimeAbiVersion?: string;
  readonly toolchainProfile: string;
  readonly actorId: string;
}

export interface CancelSystemBuildCommand {
  readonly workspaceId: WorkspaceId;
  readonly buildId: SystemBuildId;
  readonly actorId: string;
}

export interface ApproveSystemReleaseCommand {
  readonly workspaceId: WorkspaceId;
  readonly buildId: SystemBuildId;
  readonly releaseId?: SystemReleaseId;
  readonly expectedLockDigest: string;
  readonly actorId: string;
}

export interface ReadSystemBuildQuery { readonly workspaceId: WorkspaceId; readonly buildId: SystemBuildId; }
export interface ListSystemBuildsQuery { readonly workspaceId: WorkspaceId; readonly systemId?: SystemBuilderSystemId; }
export interface ReadSystemReleaseQuery { readonly workspaceId: WorkspaceId; readonly releaseId: SystemReleaseId; }
export interface ListSystemReleasesQuery { readonly workspaceId: WorkspaceId; readonly systemId?: SystemBuilderSystemId; }
export interface CompareSystemReleasesQuery { readonly workspaceId: WorkspaceId; readonly leftReleaseId: SystemReleaseId; readonly rightReleaseId: SystemReleaseId; }

export interface SystemReleaseComparison {
  readonly sameInputs: boolean;
  readonly sameArtifacts: boolean;
  readonly changedImplementationInstanceIds: readonly string[];
  readonly addedArtifactDigests: readonly string[];
  readonly removedArtifactDigests: readonly string[];
}
