import type {
  SystemBuildPreparation,
  SystemBuildRecord,
  SystemBuildResult,
  SystemPublicationWorkspace,
  SystemRelease,
  SystemReleaseComparison,
} from "../../../contracts/system-build";

/**
 * Shared safe client surface for guided build and publication experiences.
 * Host-owned build policy is deliberately absent from renderer requests.
 */
export interface SystemBuildClient {
  prepare(input: {
    workspaceId: string;
    systemId: string;
    systemRevisionId: string;
  }): Promise<SystemBuildResult<SystemBuildPreparation>>;
  request(input: {
    workspaceId: string;
    buildId: string;
    systemId: string;
    systemRevisionId: string;
  }): Promise<SystemBuildResult<SystemBuildRecord>>;
  cancel(input: {
    workspaceId: string;
    buildId: string;
  }): Promise<SystemBuildResult<SystemBuildRecord>>;
  listBuilds(input: {
    workspaceId: string;
    systemId?: string;
  }): Promise<SystemBuildResult<readonly SystemBuildRecord[]>>;
  approve(input: {
    workspaceId: string;
    buildId: string;
    expectedLockDigest: string;
  }): Promise<SystemBuildResult<SystemRelease>>;
  listReleases(input: {
    workspaceId: string;
    systemId?: string;
  }): Promise<SystemBuildResult<readonly SystemRelease[]>>;
  publicationWorkspace(input: {
    workspaceId: string;
  }): Promise<SystemBuildResult<SystemPublicationWorkspace>>;
  compare(input: {
    workspaceId: string;
    leftReleaseId: string;
    rightReleaseId: string;
  }): Promise<SystemBuildResult<SystemReleaseComparison>>;
}
