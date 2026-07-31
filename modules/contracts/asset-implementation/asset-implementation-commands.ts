import type { AssetReference } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { AssetImplementationArtifactKind } from "./asset-implementation-artifact";
import type {
  AssetImplementationDeploymentProfile,
  AssetImplementationFacetKind,
  AssetImplementationRuntimeKind,
  AssetImplementationTrustLevel,
} from "./asset-implementation-enums";
import type {
  AssetImplementationBindingId,
  AssetImplementationBuildId,
  AssetImplementationDraftId,
  AssetImplementationReleaseId,
  AssetSourceSnapshotId,
} from "./asset-implementation-identity";
import type { AssetImplementationFacet } from "./asset-implementation-models";

export interface CreateAssetImplementationDraftCommand {
  readonly draftId: AssetImplementationDraftId;
  readonly workspaceId: WorkspaceId;
  readonly definitionRef: AssetReference;
  readonly displayName: string;
  readonly actorId: string;
}

export interface SnapshotAssetImplementationSourceCommand<
  TContent = Uint8Array,
> {
  readonly snapshotId: AssetSourceSnapshotId;
  readonly workspaceId: WorkspaceId;
  readonly draftId: AssetImplementationDraftId;
  readonly content: TContent;
  readonly mediaType: string;
  readonly actorId: string;
}

export interface RequestAssetImplementationBuildCommand {
  readonly buildId: AssetImplementationBuildId;
  readonly workspaceId: WorkspaceId;
  readonly draftId: AssetImplementationDraftId;
  readonly sourceSnapshotId: AssetSourceSnapshotId;
  readonly toolchainProfile: string;
  readonly requestedFacets: readonly AssetImplementationFacetKind[];
  readonly actorId: string;
}

export interface PublishAssetImplementationReleaseCommand {
  readonly releaseId: AssetImplementationReleaseId;
  readonly workspaceId?: WorkspaceId;
  readonly definitionRef: AssetReference;
  readonly version: string;
  readonly trustLevel: AssetImplementationTrustLevel;
  readonly sourceSnapshotId?: AssetSourceSnapshotId;
  readonly sourceBuildId?: AssetImplementationBuildId;
  readonly facets: readonly AssetImplementationFacet[];
  readonly packageDigest: string;
  readonly actorId: string;
}

export interface BindAssetImplementationReleaseCommand {
  readonly bindingId: AssetImplementationBindingId;
  readonly workspaceId?: WorkspaceId;
  readonly definitionRef: AssetReference;
  readonly releaseId: AssetImplementationReleaseId;
  readonly priority?: number;
  readonly actorId: string;
}

export interface DisableAssetImplementationBindingCommand {
  readonly bindingId: AssetImplementationBindingId;
  readonly workspaceId?: WorkspaceId;
  readonly expectedRevision: number;
  readonly actorId: string;
}

export interface RevokeAssetImplementationReleaseCommand {
  readonly releaseId: AssetImplementationReleaseId;
  readonly reasonCode: string;
  readonly message: string;
  readonly actorId: string;
}

export interface AssetImplementationArtifactWriteRequest<
  TContent = Uint8Array,
> {
  readonly workspaceId: WorkspaceId;
  readonly kind: AssetImplementationArtifactKind;
  readonly content: TContent;
  readonly mediaType: string;
  readonly expectedDigest?: string;
}

export interface TrustedBuiltInImplementationSeed {
  readonly definitionRef: AssetReference;
  readonly releaseId: AssetImplementationReleaseId;
  readonly bindingId: AssetImplementationBindingId;
  readonly version: string;
  readonly entryKey: string;
  readonly facetKind: AssetImplementationFacetKind;
  readonly runtimeKind: AssetImplementationRuntimeKind;
  readonly deploymentProfiles: readonly AssetImplementationDeploymentProfile[];
  readonly packageDigest: string;
}
