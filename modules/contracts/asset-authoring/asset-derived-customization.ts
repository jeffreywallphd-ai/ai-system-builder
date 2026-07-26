import type {
  AssetAiContext,
  AssetCompositionDependency,
  AssetCompositionRule,
  AssetConfigurationSchema,
  AssetConfigurationValues,
  AssetPort,
  AssetReference,
  AssetRequirement,
} from "../asset";
import type {
  AssetImplementationArtifactDescriptor,
  AssetImplementationBackingResourceRole,
  AssetImplementationDraftId,
  AssetImplementationReleaseId,
  AssetSourceSnapshotId,
  Sha256Digest,
} from "../asset-implementation";
import type { WorkspaceId } from "../workspace";
import type { AssetAuthoringDiagnostic } from "./asset-authoring-diagnostics";
import type { SafeAssetEditableFieldPatch } from "./asset-authoring-editable-fields";
import type { AssetCustomizationId } from "./asset-authoring-identity";
import type { AssetCustomizationTargetSourceKind } from "./asset-authoring-models";

export const ASSET_DERIVED_CUSTOMIZATION_STATUSES = [
  "draft",
  "ready-for-review",
  "reviewed",
  "published",
  "abandoned",
  "conflicted",
  "invalid",
] as const;

export type AssetDerivedCustomizationStatus =
  (typeof ASSET_DERIVED_CUSTOMIZATION_STATUSES)[number];

export const ASSET_CUSTOMIZATION_PROTECTED_FIELDS = [
  "asset-identity",
  "asset-version",
  "ownership",
  "provenance",
  "lifecycle",
  "trust",
  "package",
  "implementation-release",
  "source-snapshot",
  "artifact-digest",
  "revocation",
  "capability-policy",
  "deployment-policy",
] as const;

export type AssetCustomizationProtectedField =
  (typeof ASSET_CUSTOMIZATION_PROTECTED_FIELDS)[number];

export interface AssetDerivedCustomizationBaseIdentity {
  readonly definitionRef: AssetReference;
  readonly implementationReleaseId: AssetImplementationReleaseId;
  readonly sourceSnapshotId: AssetSourceSnapshotId;
  readonly sourceArtifact: AssetImplementationArtifactDescriptor;
}

export const ASSET_CUSTOMIZATION_SOURCE_OVERLAY_MEDIA_TYPE =
  "application/vnd.ai-system-builder.customization-source-overlay.v1+json" as const;

export type AssetCustomizationSourceFileChange =
  | {
      readonly operation: "upsert";
      readonly path: string;
      readonly role?: AssetImplementationBackingResourceRole;
      readonly mediaType?: string;
      readonly content: string;
    }
  | {
      readonly operation: "delete";
      readonly path: string;
    };

export interface AssetCustomizationSourceOverlayV1 {
  readonly formatVersion: "1.0";
  readonly changes: readonly AssetCustomizationSourceFileChange[];
}

export interface AssetCustomizationSourceOverlayDescriptor {
  readonly artifact: AssetImplementationArtifactDescriptor;
  readonly changeCount: number;
  readonly upsertCount: number;
  readonly deleteCount: number;
  readonly totalCharacters: number;
}

export interface AssetDerivedCustomizationProvenance {
  readonly kind: "layered-derived-customization";
  readonly sourceKind: AssetCustomizationTargetSourceKind;
  readonly baseDefinitionRef: AssetReference;
  readonly baseImplementationReleaseId: AssetImplementationReleaseId;
  readonly baseSourceSnapshotId: AssetSourceSnapshotId;
  readonly derivedAt: string;
  readonly derivedBy: string;
}

export interface AssetDerivedCustomizationReview {
  readonly implementationDraftId: AssetImplementationDraftId;
  readonly sourceSnapshotId: AssetSourceSnapshotId;
  readonly sourceArtifact: AssetImplementationArtifactDescriptor;
  readonly semanticPatchDigest: Sha256Digest;
  readonly sourceOverlayDigest?: Sha256Digest;
  readonly materializedFromRevision: number;
  readonly materializedAt: string;
  readonly materializedBy: string;
}

export interface AssetDerivedCustomizationPublication {
  readonly definitionRef: AssetReference;
  readonly implementationDraftId: AssetImplementationDraftId;
  readonly sourceSnapshotId: AssetSourceSnapshotId;
  readonly publishedAt: string;
  readonly publishedBy: string;
}

/**
 * Sparse, controlled semantic edits. Identity, ownership, provenance, lifecycle,
 * trust, package, and implementation lineage remain protected. The complete
 * derived definition is still validated before review or publication.
 */
export type AssetDerivedCustomizationSemanticPatch =
  SafeAssetEditableFieldPatch & {
    readonly "configuration-schema"?: AssetConfigurationSchema;
    readonly "default-configuration"?: AssetConfigurationValues;
    readonly ports?: readonly AssetPort[];
    readonly "ai-context"?: AssetAiContext;
    readonly requirements?: readonly AssetRequirement[];
    readonly "composition-rules"?: readonly AssetCompositionRule[];
    readonly dependencies?: readonly AssetCompositionDependency[];
  };

export interface AssetDerivedCustomizationDraftRecord {
  readonly customizationId: AssetCustomizationId;
  readonly workspaceId: WorkspaceId;
  readonly base: AssetDerivedCustomizationBaseIdentity;
  readonly derivedDefinitionRef: AssetReference;
  readonly semanticPatch: AssetDerivedCustomizationSemanticPatch;
  readonly sourceOverlay?: AssetCustomizationSourceOverlayDescriptor;
  readonly status: AssetDerivedCustomizationStatus;
  readonly revision: number;
  readonly provenance: AssetDerivedCustomizationProvenance;
  readonly review?: AssetDerivedCustomizationReview;
  readonly publication?: AssetDerivedCustomizationPublication;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly diagnostics?: readonly AssetAuthoringDiagnostic[];
}
