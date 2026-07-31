import type {
  AssetConfigurationMetadata,
  AssetConfigurationValue,
} from "./asset-configuration-value";

export const ASSET_CONFIGURATION_CONSTRAINT_KINDS = [
  "required",
  "min",
  "max",
  "min-length",
  "max-length",
  "pattern",
  "one-of",
  "asset-type",
  "asset-family",
  "runtime-capability",
  "resource-kind",
  "custom",
] as const;

export type AssetConfigurationConstraintKind =
  (typeof ASSET_CONFIGURATION_CONSTRAINT_KINDS)[number];

export interface AssetConfigurationConstraint {
  readonly constraintKind: AssetConfigurationConstraintKind;
  readonly value?: AssetConfigurationValue;
  readonly message?: string;
  readonly metadata?: AssetConfigurationMetadata;
}

export function isAssetConfigurationConstraintKind(
  value: string,
): value is AssetConfigurationConstraintKind {
  return ASSET_CONFIGURATION_CONSTRAINT_KINDS.includes(
    value as AssetConfigurationConstraintKind,
  );
}

export function normalizeAssetConfigurationConstraintKind(
  value: string,
): AssetConfigurationConstraintKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetConfigurationConstraintKind(normalized)) {
    throw new Error(
      `Asset configuration constraint kind must be one of ${ASSET_CONFIGURATION_CONSTRAINT_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
