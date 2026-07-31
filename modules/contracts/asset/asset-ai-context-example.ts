import type {
  AssetConfigurationMetadata,
  AssetConfigurationValues,
} from "./asset-configuration-value";
import type { AssetReference } from "./asset-reference";

export interface AssetAiContextExample {
  readonly exampleId?: string;
  readonly title?: string;
  readonly description: string;
  readonly scenario?: string;
  readonly configurationValues?: AssetConfigurationValues;
  readonly compositionRefs?: readonly AssetReference[];
  readonly expectedOutcome?: string;
  readonly metadata?: AssetConfigurationMetadata;
}

export interface AssetAiContextAntiPattern {
  readonly antiPatternId?: string;
  readonly title?: string;
  readonly description: string;
  readonly whyAvoid: string;
  readonly saferAlternative?: string;
  readonly metadata?: AssetConfigurationMetadata;
}
