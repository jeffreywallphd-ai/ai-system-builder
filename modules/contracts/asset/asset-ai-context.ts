import type {
  AssetAiContextAntiPattern,
  AssetAiContextExample,
} from "./asset-ai-context-example";
import type {
  AssetCompositionGuidance,
  AssetConfigurationGuidance,
} from "./asset-ai-context-guidance";
import type { AssetAiContextQuality } from "./asset-ai-context-quality";
import type { AssetAiContextSafetyNote } from "./asset-ai-context-safety-note";
import type {
  AssetCapabilityDescription,
  AssetInputOutputSummary,
  AssetLimitationDescription,
} from "./asset-ai-context-section";
import type { AssetConfigurationMetadata } from "./asset-configuration-value";

export interface AssetAiContext {
  readonly purpose?: string;
  readonly userFacingSummary?: string;
  readonly developerFacingSummary?: string;
  readonly capabilities?: readonly AssetCapabilityDescription[];
  readonly limitations?: readonly AssetLimitationDescription[];
  readonly inputSummary?: AssetInputOutputSummary;
  readonly outputSummary?: AssetInputOutputSummary;
  readonly configurationGuidance?: AssetConfigurationGuidance;
  readonly compositionGuidance?: AssetCompositionGuidance;
  readonly examples?: readonly AssetAiContextExample[];
  readonly antiPatterns?: readonly AssetAiContextAntiPattern[];
  readonly safetyNotes?: readonly AssetAiContextSafetyNote[];
  readonly quality?: AssetAiContextQuality;
  readonly metadata?: AssetConfigurationMetadata;
}
