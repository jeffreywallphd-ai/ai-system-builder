import type {
  AssetImplementationBackingResourceRecord,
  AssetImplementationReleaseId,
} from "../../../contracts/asset-implementation";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface AssetImplementationBackingResourceRepositoryPort {
  save(
    record: AssetImplementationBackingResourceRecord,
  ): Promise<AssetImplementationBackingResourceRecord>;
  readByRelease(
    releaseId: AssetImplementationReleaseId,
    workspaceId?: WorkspaceId,
  ): Promise<AssetImplementationBackingResourceRecord | undefined>;
  list(
    workspaceId?: WorkspaceId,
  ): Promise<readonly AssetImplementationBackingResourceRecord[]>;
}
