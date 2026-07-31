import type { AssetConfigurationMetadata } from "./asset-configuration-value";

export interface AssetCompositionCardinality {
  readonly min?: number;
  readonly max?: number;
  readonly exactly?: number;
  readonly message?: string;
  readonly metadata?: AssetConfigurationMetadata;
}
