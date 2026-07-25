import type {
  AssetConfigurationSchema,
  AssetConfigurationValues,
  AssetFamily,
  AssetLifecycleStatus,
  AssetPort,
  AssetReference,
  AssetSlotDefinition,
  AssetSlotId,
  AssetType,
} from "../asset";
import type { WorkspaceId } from "../workspace";

export const SYSTEM_BUILDER_COMPOSER_DEFAULT_LIMIT = 200;
export const SYSTEM_BUILDER_COMPOSER_MAX_LIMIT = 200;

export type SystemBuilderComposerCompatibilityStatus =
  "compatible" | "incompatible" | "not-evaluated";

export type SystemBuilderComposerImplementationAvailability =
  "trusted-system-foundation" | "definition-only";

export type SystemBuilderComposerPreviewAvailability =
  "trusted-declarative" | "unavailable";

export type SystemBuilderComposerLayoutPattern =
  "single" | "start-content" | "content-end" | "equal-split" | "three-panel";

export interface SystemBuilderComposerLayoutGeometry {
  readonly columnPattern: SystemBuilderComposerLayoutPattern;
  readonly areas: readonly (readonly string[])[];
  readonly sourceOrder: readonly string[];
  readonly dimensionsLocked: true;
}

export interface SystemBuilderComposerCompatibility {
  readonly status: SystemBuilderComposerCompatibilityStatus;
  readonly reason?: string;
  readonly parentDefinitionRef?: AssetReference;
  readonly slotId?: AssetSlotId;
}

export interface SystemBuilderComposerAsset {
  readonly definitionRef: AssetReference;
  readonly definitionId: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly assetType: AssetType;
  readonly assetFamily: AssetFamily;
  readonly categoryId?: string;
  readonly lifecycleStatus: AssetLifecycleStatus;
  readonly builtIn: boolean;
  readonly layoutRole?: "application-shell" | "page-layout";
  readonly layoutGeometry?: SystemBuilderComposerLayoutGeometry;
  /**
   * Property detail is intentionally omitted by Composer catalog list
   * operations. It is present only on exact detail projections and on
   * trusted in-process fixtures retained for preview compatibility.
   */
  readonly configurationSchema?: AssetConfigurationSchema;
  readonly defaultConfiguration?: AssetConfigurationValues;
  readonly ports: readonly AssetPort[];
  readonly slots: readonly AssetSlotDefinition[];
  readonly compatibility: SystemBuilderComposerCompatibility;
  readonly implementationAvailability: SystemBuilderComposerImplementationAvailability;
  readonly previewAvailability: SystemBuilderComposerPreviewAvailability;
}

export interface SystemBuilderComposerAssetDetail extends SystemBuilderComposerAsset {}

export interface ListSystemBuilderComposerAssetsQuery {
  readonly workspaceId: WorkspaceId | string;
  readonly searchText?: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly parentDefinitionRef?: AssetReference;
  readonly slotId?: AssetSlotId | string;
  readonly compatibleOnly?: boolean;
}

export interface ReadSystemBuilderComposerAssetQuery {
  readonly workspaceId: WorkspaceId | string;
  readonly definitionRef: AssetReference;
}

export interface SystemBuilderComposerCatalog {
  readonly items: readonly SystemBuilderComposerAsset[];
  readonly nextCursor?: string;
  readonly diagnostics?: readonly {
    readonly severity: "info" | "warning" | "error";
    readonly code: string;
    readonly message: string;
  }[];
}
