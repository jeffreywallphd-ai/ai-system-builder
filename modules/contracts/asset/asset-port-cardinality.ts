import type { AssetConfigurationMetadata } from "./asset-configuration-value";

export const ASSET_PORT_CARDINALITY_PRESETS = [
  "optional",
  "required",
  "zero-or-more",
  "one-or-more",
  "exactly-one",
] as const;

export type AssetPortCardinalityPreset =
  (typeof ASSET_PORT_CARDINALITY_PRESETS)[number];

export interface AssetPortCardinality {
  readonly preset?: AssetPortCardinalityPreset;
  readonly minConnections?: number;
  readonly maxConnections?: number;
  readonly allowMultiple?: boolean;
  readonly required?: boolean;
  readonly metadata?: AssetConfigurationMetadata;
}

export function isAssetPortCardinalityPreset(
  value: string,
): value is AssetPortCardinalityPreset {
  return ASSET_PORT_CARDINALITY_PRESETS.includes(
    value as AssetPortCardinalityPreset,
  );
}

export function normalizeAssetPortCardinalityPreset(
  value: string,
): AssetPortCardinalityPreset {
  const normalized = value.trim().toLowerCase();

  if (!isAssetPortCardinalityPreset(normalized)) {
    throw new Error(
      `Asset port cardinality preset must be one of ${ASSET_PORT_CARDINALITY_PRESETS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
