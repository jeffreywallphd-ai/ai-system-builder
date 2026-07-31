import type { AssetDefinition } from "./asset-definition";
import type { AssetMetadata } from "./asset-metadata";
import type { AssetReference } from "./asset-reference";
import type { AssetSourceLayer } from "./asset-source-layer";

export interface AssetPackAssetEntry {
  readonly entryId: string;
  readonly definition: AssetDefinition;
  readonly definitionRef: AssetReference;
  readonly category: string;
  readonly subcategory?: string;
  readonly sourceLayer: AssetSourceLayer;
  readonly fingerprint: string;
  readonly deprecated?: boolean;
  readonly replacedByRef?: AssetReference;
  readonly tags?: readonly string[];
  readonly metadata?: AssetMetadata;
}
