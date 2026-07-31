import type { SystemBuildArtifactDescriptor, SystemBuildArtifactKind } from "../../../contracts/system-build";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface SystemBuildArtifactWriteRequest<TContent = Uint8Array> {
  readonly workspaceId: WorkspaceId;
  readonly kind: SystemBuildArtifactKind;
  readonly content: TContent;
  readonly mediaType: string;
  readonly expectedDigest?: string;
}

export interface SystemBuildArtifactPort {
  putImmutable<TContent = Uint8Array>(request: SystemBuildArtifactWriteRequest<TContent>): Promise<SystemBuildArtifactDescriptor>;
  readVerified<TContent = Uint8Array>(workspaceId: WorkspaceId, descriptor: SystemBuildArtifactDescriptor): Promise<TContent>;
}
