import type { AssetConfigurationField } from "./asset-configuration-field";
import type { AssetConfigurationValidationRule } from "./asset-configuration-validation-rule";
import type { AssetConfigurationMetadata } from "./asset-configuration-value";

export interface AssetConfigurationSchema {
  readonly schemaId?: string;
  readonly schemaVersion?: string;
  readonly fields: readonly AssetConfigurationField[];
  readonly requiredFieldIds?: readonly string[];
  readonly strict?: boolean;
  readonly description?: string;
  readonly validationRules?: readonly AssetConfigurationValidationRule[];
  readonly metadata?: AssetConfigurationMetadata;
}
