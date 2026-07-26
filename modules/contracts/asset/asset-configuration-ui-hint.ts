import type { AssetConfigurationMetadata } from "./asset-configuration-value";

export const ASSET_CONFIGURATION_UI_HINT_KINDS = [
  "text",
  "textarea",
  "color",
  "number",
  "checkbox",
  "select",
  "multi-select",
  "slider",
  "asset-picker",
  "resource-picker",
  "artifact-picker",
  "runtime-capability-picker",
  "json-editor",
  "hidden",
  "advanced",
] as const;

export type AssetConfigurationUiHintKind =
  (typeof ASSET_CONFIGURATION_UI_HINT_KINDS)[number];

export interface AssetConfigurationUiHint {
  readonly hintKind: AssetConfigurationUiHintKind;
  readonly placeholder?: string;
  readonly helpText?: string;
  readonly section?: string;
  readonly order?: number;
  readonly advanced?: boolean;
  readonly metadata?: AssetConfigurationMetadata;
}

export function isAssetConfigurationUiHintKind(
  value: string,
): value is AssetConfigurationUiHintKind {
  return ASSET_CONFIGURATION_UI_HINT_KINDS.includes(
    value as AssetConfigurationUiHintKind,
  );
}

export function normalizeAssetConfigurationUiHintKind(
  value: string,
): AssetConfigurationUiHintKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetConfigurationUiHintKind(normalized)) {
    throw new Error(
      `Asset configuration UI hint kind must be one of ${ASSET_CONFIGURATION_UI_HINT_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
