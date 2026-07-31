import type { AssetConfigurationMetadata } from "./asset-configuration-value";
import type { AssetCompositionCardinality } from "./asset-composition-cardinality";
import type { AssetCompositionDependency } from "./asset-composition-dependency";
import type { AssetReference } from "./asset-reference";
import type { AssetType } from "./asset-type";

export const ASSET_COMPOSITION_RULE_KINDS = [
  "allowed-parent",
  "allowed-child",
  "required-child",
  "optional-child",
  "incompatible-child",
  "required-dependency",
  "cardinality",
  "ordering",
  "binding-required",
  "runtime-requirement",
  "custom",
] as const;

export type AssetCompositionRuleKind =
  (typeof ASSET_COMPOSITION_RULE_KINDS)[number];

export interface AssetCompositionOrdering {
  readonly beforeRefs?: readonly AssetReference[];
  readonly afterRefs?: readonly AssetReference[];
  readonly message?: string;
  readonly metadata?: AssetConfigurationMetadata;
}

export interface AssetCompositionRule {
  readonly ruleId?: string;
  readonly ruleKind: AssetCompositionRuleKind;
  readonly description?: string;
  readonly allowedParentTypes?: readonly AssetType[];
  readonly allowedChildTypes?: readonly AssetType[];
  readonly requiredAssetTypes?: readonly AssetType[];
  readonly optionalAssetTypes?: readonly AssetType[];
  readonly incompatibleAssetTypes?: readonly AssetType[];
  readonly requiredDependencies?: readonly AssetCompositionDependency[];
  readonly cardinality?: AssetCompositionCardinality;
  readonly ordering?: AssetCompositionOrdering;
  readonly message?: string;
  readonly metadata?: AssetConfigurationMetadata;
}

export function isAssetCompositionRuleKind(
  value: string,
): value is AssetCompositionRuleKind {
  return ASSET_COMPOSITION_RULE_KINDS.includes(value as AssetCompositionRuleKind);
}

export function normalizeAssetCompositionRuleKind(
  value: string,
): AssetCompositionRuleKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetCompositionRuleKind(normalized)) {
    throw new Error(
      `Asset composition rule kind must be one of ${ASSET_COMPOSITION_RULE_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
