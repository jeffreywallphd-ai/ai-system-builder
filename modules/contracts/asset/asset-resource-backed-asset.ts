import type { AssetMetadata } from "./asset-metadata";
import type { AssetReference } from "./asset-reference";
import type { AssetId } from "./asset-id";
import type { AssetGeneratedOutputReference } from "./asset-generated-output-reference";
import type { AssetResourceBacking } from "./asset-resource-backing";

export interface AssetResourceBackingReference extends AssetReference {
  readonly kind: "asset-resource-backing";
  readonly id: AssetId;
}

export interface AssetResourceBackedAsset {
  readonly assetRef: AssetReference;
  readonly backings: readonly AssetResourceBacking[];
  /** References an internal AssetResourceBacking.backingId, not a provider-native path or resource id. */
  readonly primaryBackingRef?: AssetResourceBackingReference;
  readonly previewRefs?: readonly AssetReference[];
  readonly generatedFrom?: AssetGeneratedOutputReference;
  readonly metadata?: AssetMetadata;
}
