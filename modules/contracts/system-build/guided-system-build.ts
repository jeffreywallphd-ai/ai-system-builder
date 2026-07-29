import type { WorkspaceId } from "../workspace";
import type {
  SystemBuilderRevisionId,
  SystemBuilderSystemId,
} from "../system-builder";
import type { SystemBuildId, SystemReleaseId } from "./system-build-id";
import type { SystemBuildStatus } from "./system-build-models";

export type SystemBuildPreparationStatus = "ready" | "blocked";

export interface SystemBuildPreparationCheck {
  readonly id: "saved" | "active" | "current" | "valid" | "implementations";
  readonly label: string;
  readonly status: "passed" | "blocked";
  readonly message: string;
}

export interface SystemBuildPreparation {
  readonly systemId: SystemBuilderSystemId;
  readonly systemRevisionId: SystemBuilderRevisionId;
  readonly systemName: string;
  readonly revisionNumber: number;
  readonly targetLabel: string;
  readonly status: SystemBuildPreparationStatus;
  readonly checks: readonly SystemBuildPreparationCheck[];
}

export interface PrepareGuidedSystemBuildQuery {
  readonly workspaceId: WorkspaceId;
  readonly systemId: SystemBuilderSystemId;
  readonly systemRevisionId: SystemBuilderRevisionId;
}

export interface RequestGuidedSystemBuildCommand
  extends PrepareGuidedSystemBuildQuery {
  readonly buildId: SystemBuildId;
  readonly actorId: string;
}

export type SystemPublicationStatus = "ready" | "published" | "unavailable";

export interface SystemPublicationBuildSummary {
  readonly buildId: SystemBuildId;
  readonly systemRevisionId: SystemBuilderRevisionId;
  readonly versionNumber: number;
  readonly status: SystemBuildStatus;
  readonly publicationStatus: SystemPublicationStatus;
  readonly statusMessage: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly expectedLockDigest?: string;
  readonly releaseId?: SystemReleaseId;
  readonly publishedAt?: string;
  readonly outputCount: number;
  readonly evidenceCount: number;
  readonly diagnosticCount: number;
}

export interface SystemPublicationSystemSummary {
  readonly systemId: SystemBuilderSystemId;
  readonly name: string;
  readonly builds: readonly SystemPublicationBuildSummary[];
}

export interface SystemPublicationWorkspace {
  readonly systems: readonly SystemPublicationSystemSummary[];
}

export interface ListSystemPublicationWorkspaceQuery {
  readonly workspaceId: WorkspaceId;
}
