import type { AssetConfigurationMetadata } from "./asset-configuration-value";

export const ASSET_CONFIGURATION_VALIDATION_RULE_KINDS = [
  "field-required",
  "field-kind",
  "field-constraint",
  "cross-field",
  "composition-context",
  "resource-reference",
  "runtime-requirement",
  "custom",
] as const;

export type AssetConfigurationValidationRuleKind =
  (typeof ASSET_CONFIGURATION_VALIDATION_RULE_KINDS)[number];

export interface AssetConfigurationValidationRule {
  readonly ruleId: string;
  readonly ruleKind: AssetConfigurationValidationRuleKind;
  readonly targetFieldIds?: readonly string[];
  readonly message?: string;
  readonly metadata?: AssetConfigurationMetadata;
}

export function isAssetConfigurationValidationRuleKind(
  value: string,
): value is AssetConfigurationValidationRuleKind {
  return ASSET_CONFIGURATION_VALIDATION_RULE_KINDS.includes(
    value as AssetConfigurationValidationRuleKind,
  );
}

export function normalizeAssetConfigurationValidationRuleKind(
  value: string,
): AssetConfigurationValidationRuleKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetConfigurationValidationRuleKind(normalized)) {
    throw new Error(
      `Asset configuration validation rule kind must be one of ${ASSET_CONFIGURATION_VALIDATION_RULE_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
