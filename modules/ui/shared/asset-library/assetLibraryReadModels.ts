import type {
  AssetMutationResult,
  AssetFamily,
  AssetLifecycleStatus,
  AssetMetadata,
  AssetPackSourceKind,
  AssetPackTrustStatus,
  AssetReference,
  AssetResourceBackedViewKind,
  AssetSourceLayer,
  AssetType,
} from "../../../contracts/asset";
import type {
  AssetLibraryDefinitionExpansion,
  AssetLibraryDetailOptions,
  AssetLibraryQuery,
  AssetLibraryResourceBackedViewDetailOptions,
  AssetLibraryResourceBackedViewExpansion,
  AssetLibraryResourceBackedViewQuery,
} from "./assetLibraryQueries";
import type {
  FinalizeGeneratedOutputCommand,
  ImportExternalRepositoryObjectCommand,
  LocalizeExternalRepositoryObjectCommand,
  RegisterResourceBackedViewCommand,
} from "../../../contracts/asset";

export interface AssetLibraryDefinitionCard {
  readonly id: string;
  readonly definitionId: string;
  readonly definitionRef?: AssetReference;
  readonly version: string;
  readonly displayName: string;
  readonly summary?: string;
  readonly assetType?: AssetType;
  readonly assetTypeLabel?: string;
  readonly assetFamily?: AssetFamily;
  readonly assetFamilyLabel?: string;
  readonly lifecycleStatus?: AssetLifecycleStatus;
  readonly lifecycleStatusLabel?: string;
  readonly builtIn: boolean;
  readonly sourcePackId?: string;
  readonly sourcePackVersion?: string;
  readonly sourcePackDisplayName?: string;
  readonly sourceKind?: AssetPackSourceKind;
  readonly sourceLayer?: AssetSourceLayer;
  readonly trustStatus?: AssetPackTrustStatus;
  readonly packCategoryId?: string;
  readonly packCategoryDisplayName?: string;
  readonly packTags?: readonly string[];
  readonly systemDefault?: boolean;
  readonly installedPack?: boolean;
  readonly importedPack?: boolean;
  readonly workspacePack?: boolean;
  readonly workspaceOverride?: boolean;
  readonly organizationOverride?: boolean;
  readonly userOverride?: boolean;
  readonly sourceBadgeLabel?: string;
  readonly packLabel?: string;
  readonly categoryLabel?: string;
  readonly updatedAt?: string;
  readonly badges?: readonly string[];
}

export interface AssetLibraryOverviewSection {
  readonly description?: string;
  readonly reviewStatus?: string;
}

export interface AssetLibraryAiContextSummary {
  readonly purpose?: string;
  readonly userFacingSummary?: string;
  readonly developerFacingSummary?: string;
  readonly capabilityCount?: number;
  readonly limitationCount?: number;
  readonly safetyNoteCount?: number;
}

export interface AssetLibraryConfigurationSummary {
  readonly schemaId?: string;
  readonly schemaVersion?: string;
  readonly fieldCount: number;
  readonly requiredFieldCount: number;
  readonly strict?: boolean;
  readonly description?: string;
}

export interface AssetLibraryPortsSummary {
  readonly totalCount: number;
  readonly inputCount: number;
  readonly outputCount: number;
  readonly eventCount: number;
  readonly controlCount: number;
}

export interface AssetLibraryRequirementsSummary {
  readonly totalCount: number;
  readonly requiredCount: number;
  readonly runtimeCapabilityIds: readonly string[];
  readonly hostKinds: readonly string[];
  readonly safetyStatuses: readonly string[];
}

export interface AssetLibraryProvenanceSummary {
  readonly sourceKind?: string;
  readonly authorship?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly redactedGenerationSummary?: string;
}

export interface AssetLibraryValidationSummary {
  readonly status?: string;
  readonly issueCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly validatedAt?: string;
}

export interface AssetLibraryDefinitionDetail extends AssetLibraryDefinitionCard {
  readonly overview?: AssetLibraryOverviewSection;
  readonly aiContextSummary?: AssetLibraryAiContextSummary;
  readonly configurationSummary?: AssetLibraryConfigurationSummary;
  readonly portsSummary?: AssetLibraryPortsSummary;
  readonly requirementsSummary?: AssetLibraryRequirementsSummary;
  readonly provenanceSummary?: AssetLibraryProvenanceSummary;
  readonly validationSummary?: AssetLibraryValidationSummary;
  readonly metadata?: AssetMetadata;
  readonly overridesDefinitionRef?: AssetReference;
  readonly overriddenByDefinitionRefs?: readonly AssetReference[];
  readonly effectiveResolutionStatus?: string;
  readonly resolutionSummary?: string;
}

export interface AssetLibraryResourceBackedViewCard {
  readonly id: string;
  readonly viewId: string;
  readonly displayName: string;
  readonly summary?: string;
  readonly viewKind?: AssetResourceBackedViewKind;
  readonly viewKindLabel?: string;
  readonly assetType?: AssetType;
  readonly assetTypeLabel?: string;
  readonly assetFamily?: AssetFamily;
  readonly assetFamilyLabel?: string;
  readonly lifecycleStatus?: AssetLifecycleStatus;
  readonly lifecycleStatusLabel?: string;
  readonly sourceKind?: string;
  readonly registrationStatusLabel: string;
  readonly badges?: readonly string[];
  readonly diagnostics?: readonly string[];
}

export interface AssetLibraryResourceBackedViewDetail extends AssetLibraryResourceBackedViewCard {
  readonly metadata?: AssetMetadata;
  readonly resourceBackingSummary?: {
    readonly resourceKind?: string;
    readonly role?: string;
    readonly displayName?: string;
    readonly contentType?: string;
    readonly format?: string;
    readonly sizeBytes?: number;
  };
  readonly validationSummary?: AssetLibraryValidationSummary;
}

export interface AssetLibraryListResult<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
  readonly diagnostics?: readonly {
    readonly severity: "info" | "warning" | "error";
    readonly code: string;
    readonly message: string;
  }[];
}

export interface AssetLibraryClientError {
  readonly code: string;
  readonly message: string;
  readonly fieldIssues?: readonly {
    readonly field?: string;
    readonly message: string;
  }[];
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly status?: number;
}

export type AssetLibraryClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AssetLibraryClientError };

export interface AssetLibraryClient {
  readonly listAssetDefinitions: (
    query?: AssetLibraryQuery,
  ) => Promise<AssetLibraryClientResult<AssetLibraryListResult<AssetLibraryDefinitionCard>>>;
  readonly readAssetDefinition: (
    input: { readonly definitionId: string },
    options?: AssetLibraryDetailOptions,
  ) => Promise<AssetLibraryClientResult<AssetLibraryDefinitionDetail>>;
  readonly readAssetDefinitionVersion: (
    input: { readonly definitionId: string; readonly version: string },
    options?: AssetLibraryDetailOptions,
  ) => Promise<AssetLibraryClientResult<AssetLibraryDefinitionDetail>>;
  readonly listAssetResourceBackedViews: (
    query?: AssetLibraryResourceBackedViewQuery,
  ) => Promise<AssetLibraryClientResult<AssetLibraryListResult<AssetLibraryResourceBackedViewCard>>>;
  readonly readAssetResourceBackedView: (
    input: { readonly viewId: string },
    options?: AssetLibraryResourceBackedViewDetailOptions,
  ) => Promise<AssetLibraryClientResult<AssetLibraryResourceBackedViewDetail>>;
  readonly registerResourceBackedViewAsAsset: (
    command: RegisterResourceBackedViewCommand,
  ) => Promise<AssetLibraryClientResult<AssetMutationResult>>;
  readonly finalizeGeneratedOutputAsAsset: (
    command: FinalizeGeneratedOutputCommand,
  ) => Promise<AssetLibraryClientResult<AssetMutationResult>>;
  readonly importExternalRepositoryObjectAsAsset: (
    command: ImportExternalRepositoryObjectCommand,
  ) => Promise<AssetLibraryClientResult<AssetMutationResult>>;
  readonly localizeExternalRepositoryObjectAsAsset: (
    command: LocalizeExternalRepositoryObjectCommand,
  ) => Promise<AssetLibraryClientResult<AssetMutationResult>>;
}

export type {
  AssetLibraryDefinitionExpansion,
  AssetLibraryDetailOptions,
  AssetLibraryQuery,
  AssetLibraryResourceBackedViewDetailOptions,
  AssetLibraryResourceBackedViewExpansion,
  AssetLibraryResourceBackedViewQuery,
};
