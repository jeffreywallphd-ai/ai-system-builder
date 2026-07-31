import type {
  AssetAiContext,
  AssetCompositionDependency,
  AssetCompositionRule,
  AssetConfigurationExample,
  AssetConfigurationSchema,
  AssetConfigurationValues,
  AssetFamily,
  AssetMetadata,
  AssetPort,
  AssetReference,
  AssetRequirement,
  AssetType,
} from "../asset";
import type {
  AssetImplementationArtifactDescriptor,
  AssetImplementationBackingResourceFile,
  AssetImplementationBackingResourceFileDescriptor,
  AssetImplementationDraftId,
  AssetSourceSnapshotId,
} from "../asset-implementation";
import type { AssetDraftId } from "../asset-authoring";
import type { WorkspaceId } from "../workspace";

export type AssetStudioAssetDraftId = string & {
  readonly __brand: "AssetStudioAssetDraftId";
};

export const ASSET_STUDIO_ASSET_DRAFT_STATUSES = [
  "draft",
  "reviewed",
  "published",
  "abandoned",
] as const;

export type AssetStudioAssetDraftStatus =
  (typeof ASSET_STUDIO_ASSET_DRAFT_STATUSES)[number];

export interface AssetStudioSemanticDefinitionInput {
  readonly assetType: AssetType;
  readonly assetFamily: AssetFamily;
  readonly displayName: string;
  readonly description: string;
  readonly configurationSchema?: AssetConfigurationSchema;
  readonly defaultConfiguration?: AssetConfigurationValues;
  readonly configurationExamples?: readonly AssetConfigurationExample[];
  readonly aiContext?: AssetAiContext;
  readonly requirements?: readonly AssetRequirement[];
  readonly requirementRefs?: readonly AssetReference[];
  readonly portRefs?: readonly AssetReference[];
  readonly ports?: readonly AssetPort[];
  readonly compositionRuleRefs?: readonly AssetReference[];
  readonly compositionRules?: readonly AssetCompositionRule[];
  readonly dependencies?: readonly AssetCompositionDependency[];
  readonly metadata?: AssetMetadata;
}

export interface AssetStudioAssetDraftSource {
  readonly artifact: AssetImplementationArtifactDescriptor;
  readonly files: readonly AssetImplementationBackingResourceFileDescriptor[];
  readonly totalCharacters: number;
}

export interface AssetStudioAssetDraftProvenance {
  readonly kind: "studio-from-scratch";
  readonly sourceLegacyDraftId?: AssetDraftId;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface AssetStudioAssetDraftReview {
  readonly sourceSnapshotId: AssetSourceSnapshotId;
  readonly sourceArtifact: AssetImplementationArtifactDescriptor;
  readonly materializedFromRevision: number;
  readonly materializedAt: string;
  readonly materializedBy: string;
}

export interface AssetStudioAssetDraftPublication {
  readonly definitionRef: AssetReference;
  readonly implementationDraftId: AssetImplementationDraftId;
  readonly sourceSnapshotId: AssetSourceSnapshotId;
  readonly publishedAt: string;
  readonly publishedBy: string;
}

export interface AssetStudioAssetDraftRecord {
  readonly draftId: AssetStudioAssetDraftId;
  readonly workspaceId: WorkspaceId;
  readonly definitionRef: AssetReference;
  readonly semanticDefinition: AssetStudioSemanticDefinitionInput;
  readonly implementationDraftId: AssetImplementationDraftId;
  readonly source: AssetStudioAssetDraftSource;
  readonly status: AssetStudioAssetDraftStatus;
  readonly revision: number;
  readonly provenance: AssetStudioAssetDraftProvenance;
  readonly review?: AssetStudioAssetDraftReview;
  readonly publication?: AssetStudioAssetDraftPublication;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
}

export interface AssetStudioAssetDraftSummary {
  readonly draftId: AssetStudioAssetDraftId;
  readonly definitionRef: AssetReference;
  readonly implementationDraftId: AssetImplementationDraftId;
  readonly displayName: string;
  readonly assetType: AssetType;
  readonly assetFamily: AssetFamily;
  readonly status: AssetStudioAssetDraftStatus;
  readonly revision: number;
  readonly sourceLegacyDraftId?: AssetDraftId;
  readonly resourceCount: number;
  readonly updatedAt: string;
}

export interface AssetStudioAssetDraftView {
  readonly record: AssetStudioAssetDraftRecord;
  readonly resources: readonly AssetImplementationBackingResourceFile[];
}

export interface AssetStudioAssetDraftListView {
  readonly drafts: readonly AssetStudioAssetDraftSummary[];
  readonly nextCursor?: string;
}

export interface CreateAssetStudioAssetDraftCommand {
  readonly workspaceId: WorkspaceId;
  readonly definitionRef: AssetReference;
  readonly semanticDefinition: AssetStudioSemanticDefinitionInput;
  readonly resources: readonly AssetImplementationBackingResourceFile[];
  readonly sourceLegacyDraftId?: AssetDraftId;
  readonly actorId: string;
}

export interface UpdateAssetStudioAssetDraftCommand {
  readonly workspaceId: WorkspaceId;
  readonly draftId: AssetStudioAssetDraftId;
  readonly expectedRevision: number;
  readonly semanticDefinition: AssetStudioSemanticDefinitionInput;
  readonly resources: readonly AssetImplementationBackingResourceFile[];
  readonly actorId: string;
}

export interface ReadAssetStudioAssetDraftQuery {
  readonly workspaceId: WorkspaceId;
  readonly draftId: AssetStudioAssetDraftId;
}

export interface ListAssetStudioAssetDraftsQuery {
  readonly workspaceId: WorkspaceId;
  readonly status?: AssetStudioAssetDraftStatus;
  readonly unpublishedOnly?: boolean;
  readonly text?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface TransitionAssetStudioAssetDraftCommand {
  readonly workspaceId: WorkspaceId;
  readonly draftId: AssetStudioAssetDraftId;
  readonly expectedRevision: number;
  readonly actorId: string;
}
