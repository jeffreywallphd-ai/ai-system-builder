import type { AssetReference } from "../asset";
import type { OrganizationId } from "../organization";
import type { WorkspaceId } from "../workspace";
import type { AssetImplementationArtifactDescriptor } from "./asset-implementation-artifact";
import type {
  AssetImplementationBindingId,
  AssetImplementationBuildId,
  AssetImplementationDraftId,
  AssetImplementationFacetId,
  AssetImplementationReleaseId,
  AssetImplementationRevocationId,
  AssetSourceSnapshotId,
} from "./asset-implementation-identity";
import type {
  AssetImplementationBindingStatus,
  AssetImplementationBuildStatus,
  AssetImplementationDeploymentProfile,
  AssetImplementationDraftStatus,
  AssetImplementationFacetKind,
  AssetImplementationReleaseStatus,
  AssetImplementationRuntimeKind,
  AssetImplementationTrustLevel,
} from "./asset-implementation-enums";

export interface AssetImplementationCompatibility {
  readonly definitionVersion: string;
  readonly hostApiRange: string;
  readonly runtimeAbiRange?: string;
  readonly deploymentProfiles: readonly AssetImplementationDeploymentProfile[];
}

export interface AssetImplementationFacet {
  readonly facetId: AssetImplementationFacetId;
  readonly kind: AssetImplementationFacetKind;
  readonly runtimeKind: AssetImplementationRuntimeKind;
  readonly entryKey: string;
  readonly artifact?: AssetImplementationArtifactDescriptor;
  readonly requiredCapabilities: readonly string[];
  readonly compatibility: AssetImplementationCompatibility;
}

export interface AssetImplementationDraft {
  readonly draftId: AssetImplementationDraftId;
  readonly workspaceId: WorkspaceId;
  readonly definitionRef: AssetReference;
  readonly displayName: string;
  readonly status: AssetImplementationDraftStatus;
  readonly sourceSnapshotId?: AssetSourceSnapshotId;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
}

export interface AssetSourceSnapshot {
  readonly snapshotId: AssetSourceSnapshotId;
  readonly workspaceId: WorkspaceId;
  readonly draftId: AssetImplementationDraftId;
  readonly artifact: AssetImplementationArtifactDescriptor;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface AssetImplementationBuild {
  readonly buildId: AssetImplementationBuildId;
  readonly workspaceId: WorkspaceId;
  readonly draftId: AssetImplementationDraftId;
  readonly sourceSnapshotId: AssetSourceSnapshotId;
  readonly toolchainProfile: string;
  readonly status: AssetImplementationBuildStatus;
  readonly requestedFacets: readonly AssetImplementationFacetKind[];
  readonly outputArtifacts: readonly AssetImplementationArtifactDescriptor[];
  readonly evidenceArtifacts: readonly AssetImplementationArtifactDescriptor[];
  readonly diagnostics: readonly AssetImplementationDiagnostic[];
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly requestedBy: string;
}

export interface AssetImplementationRelease {
  readonly releaseId: AssetImplementationReleaseId;
  readonly workspaceId?: WorkspaceId;
  readonly organizationId?: OrganizationId;
  readonly definitionRef: AssetReference;
  readonly version: string;
  readonly status: AssetImplementationReleaseStatus;
  readonly trustLevel: AssetImplementationTrustLevel;
  readonly sourceSnapshotId?: AssetSourceSnapshotId;
  readonly sourceBuildId?: AssetImplementationBuildId;
  readonly facets: readonly AssetImplementationFacet[];
  readonly packageDigest: string;
  readonly evidenceArtifacts: readonly AssetImplementationArtifactDescriptor[];
  readonly createdAt: string;
  readonly publishedAt: string;
  readonly publishedBy: string;
}

export interface AssetImplementationBinding {
  readonly bindingId: AssetImplementationBindingId;
  readonly workspaceId?: WorkspaceId;
  readonly organizationId?: OrganizationId;
  readonly definitionRef: AssetReference;
  readonly releaseId: AssetImplementationReleaseId;
  readonly status: AssetImplementationBindingStatus;
  readonly priority: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly approvedBy: string;
}

export interface AssetImplementationRevocation {
  readonly revocationId: AssetImplementationRevocationId;
  readonly releaseId: AssetImplementationReleaseId;
  readonly organizationId?: OrganizationId;
  readonly reasonCode: string;
  readonly message: string;
  readonly revokedAt: string;
  readonly revokedBy: string;
}

export interface AssetImplementationDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
}
