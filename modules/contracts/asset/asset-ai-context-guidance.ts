import type { AssetConfigurationExample } from "./asset-configuration-example";
import type {
  AssetConfigurationMetadata,
  AssetConfigurationValues,
} from "./asset-configuration-value";
import type { AssetReference } from "./asset-reference";

export interface AssetConfigurationGuidance {
  readonly summary: string;
  readonly requiredConfiguration?: readonly string[];
  readonly recommendedDefaults?: AssetConfigurationValues;
  readonly commonMistakes?: readonly string[];
  readonly configurationExamples?: readonly AssetConfigurationExample[];
  readonly metadata?: AssetConfigurationMetadata;
}

export interface AssetCompositionGuidance {
  readonly summary: string;
  readonly commonlyComposedWith?: readonly AssetReference[];
  readonly requiredCompanions?: readonly AssetReference[];
  readonly incompatibleWith?: readonly AssetReference[];
  readonly orderingGuidance?: string;
  readonly bindingGuidance?: string;
  readonly metadata?: AssetConfigurationMetadata;
}
