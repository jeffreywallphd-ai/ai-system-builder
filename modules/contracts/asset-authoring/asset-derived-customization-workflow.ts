import type {
  AssetDefinition,
  AssetFamily,
  AssetReference,
  AssetType,
} from "../asset";
import type {
  AssetImplementationBackingResourceFileDescriptor,
  AssetImplementationBackingResourceRole,
  AssetImplementationArtifactDescriptor,
  AssetImplementationReleaseId,
  AssetSourceSnapshotId,
  AssetImplementationTrustLevel,
} from "../asset-implementation";
import type { WorkspaceId } from "../workspace";
import type { AssetAuthoringResult } from "./asset-authoring-results";
import type { AssetCustomizationId } from "./asset-authoring-identity";
import type { AssetCustomizationTargetSourceKind } from "./asset-authoring-models";
import type {
  AssetCustomizationProtectedField,
  AssetCustomizationSourceFileChange,
  AssetDerivedCustomizationDraftRecord,
  AssetDerivedCustomizationSemanticPatch,
  AssetDerivedCustomizationStatus,
} from "./asset-derived-customization";

export type AssetDerivedCustomizationEligibilityCode =
  | "eligible"
  | "definition-unavailable"
  | "implementation-unavailable"
  | "backing-resources-unavailable"
  | "backing-resources-unreadable"
  | "exact-base-required";

export interface AssetDerivedCustomizationEligibility {
  readonly eligible: boolean;
  readonly code: AssetDerivedCustomizationEligibilityCode;
  readonly message: string;
}

export interface AssetDerivedCustomizationResourceCounts {
  readonly total: number;
  readonly editable: number;
  readonly frontendStructure: number;
  readonly frontendStyle: number;
  readonly backendLogic: number;
  readonly other: number;
}

export interface AssetDerivedCustomizationTargetSummary {
  readonly workspaceId: WorkspaceId;
  readonly sourceKind: AssetCustomizationTargetSourceKind;
  readonly definitionRef: AssetReference;
  readonly implementationReleaseId?: AssetImplementationReleaseId;
  readonly displayName: string;
  readonly description: string;
  readonly assetType?: AssetType;
  readonly assetFamily?: AssetFamily;
  readonly implementationVersion?: string;
  readonly trustLevel?: AssetImplementationTrustLevel;
  readonly eligibility: AssetDerivedCustomizationEligibility;
  readonly resources: AssetDerivedCustomizationResourceCounts;
}

export interface AssetDerivedCustomizationBackingResourceView
  extends AssetImplementationBackingResourceFileDescriptor {
  readonly role: AssetImplementationBackingResourceRole;
  readonly content: string;
}

export interface AssetDerivedCustomizationTargetDetail
  extends AssetDerivedCustomizationTargetSummary {
  readonly definition?: AssetDefinition;
  readonly baseSourceSnapshotId?: AssetSourceSnapshotId;
  readonly baseSourceArtifact?: AssetImplementationArtifactDescriptor;
  readonly backingResources: readonly AssetDerivedCustomizationBackingResourceView[];
  readonly protectedFields: readonly AssetCustomizationProtectedField[];
}

export interface ListAssetDerivedCustomizationTargetsQuery {
  readonly workspaceId: WorkspaceId;
  readonly text?: string;
  readonly sourceKind?: AssetCustomizationTargetSourceKind;
  readonly eligibility?: "all" | "eligible" | "ineligible";
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ListAssetDerivedCustomizationTargetsResult {
  readonly targets: readonly AssetDerivedCustomizationTargetSummary[];
  readonly nextCursor?: string;
}

export interface ReadAssetDerivedCustomizationTargetQuery {
  readonly workspaceId: WorkspaceId;
  readonly definitionRef: AssetReference;
  readonly implementationReleaseId: AssetImplementationReleaseId;
}

export interface CreateAssetDerivedCustomizationCommand {
  readonly workspaceId: WorkspaceId;
  readonly baseDefinitionRef: AssetReference;
  readonly baseImplementationReleaseId: AssetImplementationReleaseId;
  readonly derivedDefinitionRef: AssetReference;
  readonly semanticPatch: AssetDerivedCustomizationSemanticPatch;
  readonly sourceChanges?: readonly AssetCustomizationSourceFileChange[];
  readonly actorId: string;
}

export interface UpdateAssetDerivedCustomizationCommand {
  readonly workspaceId: WorkspaceId;
  readonly customizationId: AssetCustomizationId;
  readonly expectedRevision: number;
  readonly semanticPatch: AssetDerivedCustomizationSemanticPatch;
  readonly sourceChanges?: readonly AssetCustomizationSourceFileChange[];
  readonly clearSourceOverlay?: boolean;
  readonly actorId: string;
}

export interface ReviewAssetDerivedCustomizationCommand {
  readonly workspaceId: WorkspaceId;
  readonly customizationId: AssetCustomizationId;
  readonly expectedRevision: number;
  readonly actorId: string;
}

export interface PublishAssetDerivedCustomizationCommand
  extends ReviewAssetDerivedCustomizationCommand {}

export interface AbandonAssetDerivedCustomizationCommand
  extends ReviewAssetDerivedCustomizationCommand {}

export interface ListAssetDerivedCustomizationsQuery {
  readonly workspaceId: WorkspaceId;
  readonly status?: AssetDerivedCustomizationStatus;
  readonly text?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export type CreateAssetDerivedCustomizationResult =
  AssetAuthoringResult<AssetDerivedCustomizationDraftRecord>;
export type UpdateAssetDerivedCustomizationResult =
  AssetAuthoringResult<AssetDerivedCustomizationDraftRecord>;
export type ReviewAssetDerivedCustomizationResult =
  AssetAuthoringResult<AssetDerivedCustomizationDraftRecord>;
export type PublishAssetDerivedCustomizationResult =
  AssetAuthoringResult<AssetDerivedCustomizationDraftRecord>;
export type AbandonAssetDerivedCustomizationResult =
  AssetAuthoringResult<AssetDerivedCustomizationDraftRecord>;
