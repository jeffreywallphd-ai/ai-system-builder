import type {
  AssetJsonObject,
  AssetJsonPrimitive,
  AssetJsonValue,
  AssetMetadata,
} from "./asset-metadata";

export type AssetConfigurationPrimitiveValue = AssetJsonPrimitive;

export type AssetConfigurationValue = AssetJsonValue;

export type AssetConfigurationValues = AssetJsonObject;

export type AssetConfigurationMetadata = AssetMetadata;

export const ASSET_CONFIGURATION_VALUE_KINDS = [
  "string",
  "number",
  "integer",
  "boolean",
  "enum",
  "array",
  "object",
  "asset-reference",
  "resource-reference",
  "artifact-reference",
  "runtime-capability-reference",
  "json",
] as const;

export type AssetConfigurationValueKind =
  (typeof ASSET_CONFIGURATION_VALUE_KINDS)[number];

export function isAssetConfigurationValueKind(
  value: string,
): value is AssetConfigurationValueKind {
  return ASSET_CONFIGURATION_VALUE_KINDS.includes(
    value as AssetConfigurationValueKind,
  );
}

export function normalizeAssetConfigurationValueKind(
  value: string,
): AssetConfigurationValueKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetConfigurationValueKind(normalized)) {
    throw new Error(
      `Asset configuration value kind must be one of ${ASSET_CONFIGURATION_VALUE_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
