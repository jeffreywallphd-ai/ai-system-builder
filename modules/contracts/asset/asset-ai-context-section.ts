import type { AssetConfigurationMetadata } from "./asset-configuration-value";
import type { AssetType } from "./asset-type";

export interface AssetCapabilityDescription {
  readonly capabilityId?: string;
  readonly summary: string;
  readonly details?: string;
  readonly appliesWhen?: string;
  readonly metadata?: AssetConfigurationMetadata;
}

export interface AssetLimitationDescription {
  readonly limitationId?: string;
  readonly summary: string;
  readonly details?: string;
  readonly avoidWhen?: string;
  readonly metadata?: AssetConfigurationMetadata;
}

export interface AssetInputOutputSummary {
  readonly summary: string;
  readonly dataKinds?: readonly string[];
  readonly expectedAssetTypes?: readonly AssetType[];
  readonly required?: boolean;
  readonly notes?: readonly string[];
  readonly metadata?: AssetConfigurationMetadata;
}
