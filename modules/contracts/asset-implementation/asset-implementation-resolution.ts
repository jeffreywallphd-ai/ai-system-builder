import type { AssetReference } from "../asset";
import type { WorkspaceId } from "../workspace";
import type {
  AssetImplementationDeploymentProfile,
  AssetImplementationFacetKind,
  AssetImplementationReadinessStatus,
  AssetImplementationTrustLevel,
} from "./asset-implementation-enums";
import type { AssetImplementationReleaseId } from "./asset-implementation-identity";
import type {
  AssetImplementationDiagnostic,
  AssetImplementationFacet,
} from "./asset-implementation-models";

export interface AssetImplementationResolutionRequest {
  readonly workspaceId: WorkspaceId;
  readonly definitionRef: AssetReference;
  readonly requiredFacets: readonly AssetImplementationFacetKind[];
  readonly deploymentProfile: AssetImplementationDeploymentProfile;
  readonly availableCapabilities: readonly string[];
  readonly permittedTrustLevels: readonly AssetImplementationTrustLevel[];
  readonly lockedReleaseId?: AssetImplementationReleaseId;
  readonly hostApiVersion: string;
  readonly runtimeAbiVersion?: string;
}

export interface AssetImplementationReleaseSummary {
  readonly releaseId: AssetImplementationReleaseId;
  readonly definitionRef: AssetReference;
  readonly version: string;
  readonly status: "published" | "deprecated";
  readonly trustLevel: AssetImplementationTrustLevel;
  readonly facetKinds: readonly AssetImplementationFacetKind[];
  readonly packageDigest: string;
  readonly publishedAt: string;
  readonly revoked: boolean;
}

export interface AssetImplementationResolutionResult {
  readonly status: AssetImplementationReadinessStatus;
  readonly definitionRef: AssetReference;
  readonly selectedRelease?: AssetImplementationReleaseSummary;
  readonly selectedFacets: readonly AssetImplementationFacet[];
  readonly diagnostics: readonly AssetImplementationDiagnostic[];
}
