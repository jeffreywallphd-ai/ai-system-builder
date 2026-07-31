import type {
  AssetConfigurationMetadata,
  AssetConfigurationValue,
} from "./asset-configuration-value";

export const ASSET_BINDING_CONSTRAINT_KINDS = [
  "required",
  "same-contract-kind",
  "same-data-kind",
  "asset-type",
  "asset-family",
  "resource-kind",
  "runtime-capability",
  "single-source",
  "single-target",
  "ordering",
  "custom",
] as const;

export type AssetBindingConstraintKind =
  (typeof ASSET_BINDING_CONSTRAINT_KINDS)[number];

export interface AssetBindingConstraint {
  readonly constraintKind: AssetBindingConstraintKind;
  readonly value?: AssetConfigurationValue;
  readonly message?: string;
  readonly metadata?: AssetConfigurationMetadata;
}

export function isAssetBindingConstraintKind(
  value: string,
): value is AssetBindingConstraintKind {
  return ASSET_BINDING_CONSTRAINT_KINDS.includes(
    value as AssetBindingConstraintKind,
  );
}

export function normalizeAssetBindingConstraintKind(
  value: string,
): AssetBindingConstraintKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetBindingConstraintKind(normalized)) {
    throw new Error(
      `Asset binding constraint kind must be one of ${ASSET_BINDING_CONSTRAINT_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
