import type { AssetImplementationReleaseId } from "../../../contracts/asset-implementation";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface SystemDeploymentRevocationPort {
  listRevokedImplementationReleaseIds(
    workspaceId: WorkspaceId,
    releaseIds: readonly AssetImplementationReleaseId[],
  ): Promise<readonly AssetImplementationReleaseId[]>;
}
