import type { AssetPackManifest, AssetReference } from "../asset";
import type {
  AssetImplementationCompatibility,
  AssetImplementationDeploymentProfile,
  AssetImplementationFacetId,
  AssetImplementationFacetKind,
  AssetImplementationReleaseId,
  AssetImplementationRuntimeKind,
  AssetImplementationTrustLevel,
  Sha256Digest,
} from "../asset-implementation";
import type { WorkspaceId } from "../workspace";

export const ASSET_PACKAGE_FORMAT_VERSION = "1.0" as const;
export const ASSET_PACKAGE_MEDIA_TYPE = "application/vnd.ai-system-builder.package.v1+json" as const;

export type AssetPackageLifecycleStatus =
  | "quarantined"
  | "inspected"
  | "rejected"
  | "installed"
  | "active"
  | "disabled";

export type AssetPackageEvidenceStatus = "verified" | "unverified" | "missing" | "failed";

export interface AssetPackageEntryDeclaration {
  readonly path: string;
  readonly mediaType: string;
  readonly digest: Sha256Digest;
  readonly sizeBytes: number;
  readonly contentBase64: string;
}

export interface AssetPackageFacetDeclaration {
  readonly facetId: AssetImplementationFacetId;
  readonly kind: AssetImplementationFacetKind;
  readonly runtimeKind: AssetImplementationRuntimeKind;
  readonly entryKey: string;
  readonly packageEntryPath?: string;
  readonly requiredCapabilities: readonly string[];
  readonly compatibility: AssetImplementationCompatibility;
}

export interface AssetPackageImplementationDeclaration {
  readonly releaseId: AssetImplementationReleaseId;
  readonly definitionRef: AssetReference;
  readonly version: string;
  readonly facets: readonly AssetPackageFacetDeclaration[];
  readonly evidenceEntryPaths?: readonly string[];
}

export interface AssetPackageManifestV1 {
  readonly formatVersion: typeof ASSET_PACKAGE_FORMAT_VERSION;
  readonly packageId: string;
  readonly version: string;
  readonly displayName: string;
  readonly publisher?: string;
  readonly semanticManifest: AssetPackManifest;
  readonly implementations: readonly AssetPackageImplementationDeclaration[];
  readonly requestedCapabilities: readonly string[];
  readonly supportedDeploymentProfiles: readonly AssetImplementationDeploymentProfile[];
  readonly dependencies?: readonly {
    readonly packageId: string;
    readonly versionRange: string;
    readonly required: boolean;
  }[];
  readonly sbomEntryPath?: string;
  readonly provenanceEntryPath?: string;
}

export interface AssetPackageContainerV1 {
  readonly mediaType: typeof ASSET_PACKAGE_MEDIA_TYPE;
  readonly manifest: AssetPackageManifestV1;
  readonly entries: readonly AssetPackageEntryDeclaration[];
  readonly signature?: {
    readonly kind: "sigstore-bundle" | "local-signature";
    readonly signerIdentity: string;
    readonly artifactDigest: Sha256Digest;
    readonly bundleBase64: string;
  };
}

export interface AssetPackageInspectionIssue {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface AssetPackageInspectionSummary {
  readonly inspectionId: string;
  readonly workspaceId: WorkspaceId;
  readonly packageDigest: Sha256Digest;
  readonly packageId?: string;
  readonly version?: string;
  readonly displayName?: string;
  readonly publisher?: string;
  readonly formatVersion?: string;
  readonly definitionCount: number;
  readonly implementationCount: number;
  readonly entryCount: number;
  readonly expandedSizeBytes: number;
  readonly requestedCapabilities: readonly string[];
  readonly supportedDeploymentProfiles: readonly AssetImplementationDeploymentProfile[];
  readonly signatureStatus: AssetPackageEvidenceStatus;
  readonly provenanceStatus: AssetPackageEvidenceStatus;
  readonly sbomStatus: AssetPackageEvidenceStatus;
  readonly conflicts: readonly string[];
  readonly issues: readonly AssetPackageInspectionIssue[];
  readonly eligibleForAdmission: boolean;
  readonly inspectedAt: string;
}

export interface AssetPackageArtifactDescriptor {
  readonly artifactId: string;
  readonly digest: Sha256Digest;
  readonly mediaType: typeof ASSET_PACKAGE_MEDIA_TYPE;
  readonly sizeBytes: number;
}

export interface AssetPackageRecord {
  readonly recordId: string;
  readonly workspaceId: WorkspaceId;
  readonly packageId: string;
  readonly version: string;
  readonly displayName: string;
  readonly publisher?: string;
  readonly packageDigest: Sha256Digest;
  readonly artifact: AssetPackageArtifactDescriptor;
  readonly status: AssetPackageLifecycleStatus;
  readonly trustLevel?: AssetImplementationTrustLevel;
  readonly definitionCount: number;
  readonly implementationCount: number;
  readonly requestedCapabilities: readonly string[];
  readonly admittedBy?: string;
  readonly admittedAt?: string;
  readonly activatedBy?: string;
  readonly activatedAt?: string;
  readonly disabledAt?: string;
  readonly previousActiveRecordId?: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AssetPackageInspectionRecord {
  readonly inspectionId: string;
  readonly workspaceId: WorkspaceId;
  readonly summary: AssetPackageInspectionSummary;
  readonly artifact: AssetPackageArtifactDescriptor;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface InspectAssetPackageCommand {
  readonly workspaceId: WorkspaceId;
  readonly bytes: Uint8Array;
  readonly actorId: string;
}

export interface AdmitAssetPackageCommand {
  readonly workspaceId: WorkspaceId;
  readonly inspectionId: string;
  readonly packageDigest: Sha256Digest;
  readonly approvalScope: "workspace" | "organization";
  readonly approvedCapabilities: readonly string[];
  readonly actorId: string;
}

export interface SetAssetPackageActivationCommand {
  readonly workspaceId: WorkspaceId;
  readonly recordId: string;
  readonly actorId: string;
}
