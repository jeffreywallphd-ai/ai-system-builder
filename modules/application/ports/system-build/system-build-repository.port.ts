import type { SystemBuildId, SystemBuildRecord, SystemRelease, SystemReleaseId } from "../../../contracts/system-build";
import type { SystemBuilderSystemId } from "../../../contracts/system-builder";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface SystemBuildRepositoryPort {
  createBuild(build: SystemBuildRecord): Promise<SystemBuildRecord>;
  readBuild(workspaceId: WorkspaceId, buildId: SystemBuildId): Promise<SystemBuildRecord | undefined>;
  listBuilds(workspaceId: WorkspaceId, systemId?: SystemBuilderSystemId): Promise<readonly SystemBuildRecord[]>;
  updateBuild(build: SystemBuildRecord, expectedRevision: number): Promise<SystemBuildRecord>;
  saveRelease(release: SystemRelease): Promise<SystemRelease>;
  readRelease(workspaceId: WorkspaceId, releaseId: SystemReleaseId): Promise<SystemRelease | undefined>;
  listReleases(workspaceId: WorkspaceId, systemId?: SystemBuilderSystemId): Promise<readonly SystemRelease[]>;
}
