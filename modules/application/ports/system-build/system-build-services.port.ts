import type { AssetImplementationResolutionRequest, AssetImplementationResolutionResult } from "../../../contracts/asset-implementation";
import type { SystemBuildArtifactKind, SystemBuildDigest, SystemBuildLockManifest } from "../../../contracts/system-build";
import type { SystemBuilderRevision } from "../../../contracts/system-builder";

export interface SystemBuildHasherPort {
  digest(content: string | Uint8Array): SystemBuildDigest;
}

export interface SystemBuildImplementationResolverPort {
  resolve(request: AssetImplementationResolutionRequest): Promise<AssetImplementationResolutionResult>;
}

export interface SystemBuildMaterializedArtifact {
  readonly kind: SystemBuildArtifactKind;
  readonly mediaType: string;
  readonly content: string | Uint8Array;
}

export interface SystemBuildMaterializerPort {
  materialize(input: { readonly revision: SystemBuilderRevision; readonly lock: SystemBuildLockManifest }): Promise<readonly SystemBuildMaterializedArtifact[]>;
}
