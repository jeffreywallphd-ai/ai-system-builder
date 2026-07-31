import type {
  WorkspaceId,
} from "../../../contracts/workspace";
import type { UserLibraryEffectiveSourceSummary } from "../../../contracts/user-library";
import type { AssetAuthoringEffectiveSourceSummary } from "../../../contracts/asset-authoring";
import type {
  AssetBinding,
  AssetComposition,
  AssetCompositionType,
  AssetConfigurationValues,
  AssetDefinition,
  AssetFamily,
  AssetInstance,
  AssetInstanceStateSummary,
  AssetLifecycleStatus,
  AssetMetadata,
  AssetPackSourceKind,
  AssetPackTrustStatus,
  AssetReference,
  AssetResourceBackedView,
  AssetResourceBackedViewKind,
  AssetSourceLayer,
  AssetType,
} from "../../../contracts/asset";
export type {
  AssetResourceBackedViewListQuery as AssetResourceBackedViewQuery,
  AssetResourceBackedViewListResult,
  AssetResourceBackedViewProvider,
  AssetResourceBackedViewProviderDiagnostic,
} from "../../ports/asset";
import type { AssetValidationResult } from "./asset-validation-helpers";

export interface AssetRegistryListQuery {
  readonly searchText?: string;
  readonly assetTypes?: readonly AssetType[];
  readonly assetFamilies?: readonly AssetFamily[];
  readonly lifecycleStatuses?: readonly AssetLifecycleStatus[];
  readonly viewKinds?: readonly AssetResourceBackedViewKind[];
  readonly includeBuiltIns?: boolean;
  readonly includeCustom?: boolean;
  readonly includeMetadata?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
  readonly workspaceId?: WorkspaceId | string;
}

export interface AssetRegistryReadOptions {
  readonly includeValidation?: boolean;
  readonly includeAiContext?: boolean;
  readonly includeConfigurationSchema?: boolean;
  readonly includePorts?: boolean;
  readonly includeRequirements?: boolean;
  readonly includeResourceBackings?: boolean;
  readonly includeMetadata?: boolean;
  readonly workspaceId?: WorkspaceId | string;
}

export interface AssetRegistryListDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly providerId?: string;
  readonly sourceKind?: string;
  readonly metadata?: AssetMetadata;
}

export interface AssetRegistryListResult<TCard> {
  readonly items: readonly TCard[];
  readonly nextCursor?: string;
  readonly diagnostics?: readonly AssetRegistryListDiagnostic[];
}

export interface AssetDefinitionCard {
  readonly definitionRef: AssetReference;
  readonly definitionId: string;
  readonly version: string;
  readonly assetType: AssetType;
  readonly assetFamily: AssetFamily;
  readonly displayName: string;
  readonly summary?: string;
  readonly lifecycleStatus: AssetLifecycleStatus;
  readonly builtIn?: boolean;
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
  readonly overridesDefinitionRef?: AssetReference;
  readonly overriddenByDefinitionRefs?: readonly AssetReference[];
  readonly effectiveResolutionStatus?: string;
  readonly resolutionSummary?: string;
  readonly metadata?: AssetMetadata;
  readonly effectiveSourceSummary?: UserLibraryEffectiveSourceSummary;
  readonly assetAuthoringEffectiveSourceSummary?: AssetAuthoringEffectiveSourceSummary;
}

export interface AssetDefinitionDetail {
  readonly definition: AssetDefinition;
  readonly builtIn?: boolean;
  readonly validationSummary?: AssetValidationResult;
  readonly effectiveSourceSummary?: UserLibraryEffectiveSourceSummary;
  readonly assetAuthoringEffectiveSourceSummary?: AssetAuthoringEffectiveSourceSummary;
}

export interface AssetInstanceCard {
  readonly instanceRef: AssetReference;
  readonly instanceId: string;
  readonly definitionRef: AssetReference;
  readonly displayName?: string;
  readonly lifecycleStatus: AssetLifecycleStatus;
  readonly configurationSummary?: AssetConfigurationSummary;
  readonly stateSummary?: AssetInstanceStateSummary;
  readonly metadata?: AssetMetadata;
}

export interface AssetConfigurationSummary {
  readonly configuredFieldCount: number;
  readonly configuredFieldIds: readonly string[];
}

export interface AssetInstanceDetail {
  readonly instance: AssetInstance;
  readonly configurationSummary?: AssetConfigurationSummary;
  readonly validationSummary?: AssetValidationResult;
}

export interface AssetCompositionCard {
  readonly compositionRef: AssetReference;
  readonly compositionId: string;
  readonly compositionType: AssetCompositionType;
  readonly version: string;
  readonly displayName: string;
  readonly summary?: string;
  readonly lifecycleStatus: AssetLifecycleStatus;
  readonly rootInstanceCount: number;
  readonly instanceCount: number;
  readonly bindingCount: number;
  readonly metadata?: AssetMetadata;
}

export interface AssetBindingSummary {
  readonly bindingRef: AssetReference;
  readonly bindingId: string;
  readonly bindingKind: AssetBinding["bindingKind"];
  readonly sourceRef: AssetReference;
  readonly targetRef: AssetReference;
  readonly lifecycleStatus?: AssetLifecycleStatus;
}

export interface AssetCompositionDetail {
  readonly composition: AssetComposition;
  readonly rootInstanceRefs: readonly AssetReference[];
  readonly childInstanceRefs: readonly AssetReference[];
  readonly bindingRefs: readonly AssetReference[];
  readonly bindingSummaries: readonly AssetBindingSummary[];
  readonly validationSummary?: AssetValidationResult;
}

export interface AssetRegistryResourceBackedViewCard {
  readonly viewId: string;
  readonly viewKind: AssetResourceBackedViewKind;
  readonly displayName?: string;
  readonly summary?: string;
  readonly assetType?: AssetType;
  readonly assetFamily?: AssetFamily;
  readonly assetDefinitionRef?: AssetReference;
  readonly lifecycleStatus?: AssetLifecycleStatus;
  readonly metadata?: AssetMetadata;
}

export interface AssetRegistryResourceBackedViewDetail {
  readonly view: AssetResourceBackedView;
  readonly validationSummary?: AssetResourceBackedView["validationSummary"];
}

export type AssetRegistryConfigurationValues = AssetConfigurationValues;
