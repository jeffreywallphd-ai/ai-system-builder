import type {
  AssetImplementationArtifactDescriptor,
  AssetImplementationArtifactWriteRequest,
} from "../../../contracts/asset-implementation";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface AssetImplementationArtifactPort {
  putImmutable<TContent = Uint8Array>(
    request: AssetImplementationArtifactWriteRequest<TContent>,
  ): Promise<AssetImplementationArtifactDescriptor>;
  readVerified<TContent = Uint8Array>(
    workspaceId: WorkspaceId,
    descriptor: AssetImplementationArtifactDescriptor,
  ): Promise<TContent>;
}
