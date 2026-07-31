import type {
  AssetImplementationArtifactDescriptor,
  AssetImplementationDiagnostic,
  AssetImplementationFacet,
  AssetImplementationFacetKind,
  AssetSourceSnapshot,
} from "../../../contracts/asset-implementation";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface AssetImplementationBuilderRequest {
  readonly workspaceId: WorkspaceId;
  readonly sourceSnapshot: AssetSourceSnapshot;
  readonly toolchainProfile: string;
  readonly requestedFacets: readonly AssetImplementationFacetKind[];
}

export interface AssetImplementationBuilderResult {
  readonly succeeded: boolean;
  readonly facets: readonly AssetImplementationFacet[];
  readonly outputArtifacts: readonly AssetImplementationArtifactDescriptor[];
  readonly evidenceArtifacts: readonly AssetImplementationArtifactDescriptor[];
  readonly diagnostics: readonly AssetImplementationDiagnostic[];
}

export interface AssetImplementationBuilderPort {
  build(
    request: AssetImplementationBuilderRequest,
  ): Promise<AssetImplementationBuilderResult>;
}
