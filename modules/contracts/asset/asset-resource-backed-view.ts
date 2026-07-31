import type { AssetCompositionValidationSummary } from "./asset-composition-validation-summary";
import type { AssetFamily } from "./asset-family";
import type { AssetGeneratedOutputReference } from "./asset-generated-output-reference";
import type { AssetLifecycleStatus } from "./asset-lifecycle-status";
import type { AssetMetadata } from "./asset-metadata";
import type { AssetReference } from "./asset-reference";
import type { AssetResourceBackedAsset } from "./asset-resource-backed-asset";
import type { AssetResourceBacking } from "./asset-resource-backing";
import type { AssetResourcePreviewReference } from "./asset-resource-preview";
import type { AssetType } from "./asset-type";

export const ASSET_RESOURCE_BACKED_VIEW_KINDS = [
  "artifact",
  "image-asset",
  "generated-output",
  "dataset",
  "model",
  "document",
  "external-repository-object",
  "preview",
] as const;

export type AssetResourceBackedViewKind =
  (typeof ASSET_RESOURCE_BACKED_VIEW_KINDS)[number];

export type AssetResourceBackedViewDiagnosticSeverity =
  | "info"
  | "warning"
  | "error";

export interface AssetResourceBackedViewDiagnostic {
  readonly severity: AssetResourceBackedViewDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly sourceKind?: string;
  readonly metadata?: AssetMetadata;
}

export interface AssetResourceBackedView {
  readonly viewId: string;
  readonly viewKind: AssetResourceBackedViewKind;
  readonly assetType?: AssetType;
  readonly assetFamily?: AssetFamily;
  readonly assetDefinitionRef?: AssetReference;
  readonly assetInstanceRef?: AssetReference;
  readonly resourceBacking?: AssetResourceBacking;
  readonly resourceBackedAsset?: AssetResourceBackedAsset;
  readonly generatedOutput?: AssetGeneratedOutputReference;
  readonly preview?: AssetResourcePreviewReference;
  readonly sourceRef?: AssetReference;
  readonly displayName?: string;
  readonly summary?: string;
  readonly lifecycleStatus?: AssetLifecycleStatus;
  readonly validationSummary?: AssetCompositionValidationSummary;
  readonly metadata?: AssetMetadata;
  readonly diagnostics?: readonly AssetResourceBackedViewDiagnostic[];
}
