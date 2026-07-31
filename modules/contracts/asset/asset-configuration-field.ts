import type { AssetConfigurationConstraint } from "./asset-configuration-constraint";
import type { AssetConfigurationUiHint } from "./asset-configuration-ui-hint";
import type {
  AssetConfigurationMetadata,
  AssetConfigurationValue,
  AssetConfigurationValueKind,
} from "./asset-configuration-value";

export interface AssetConfigurationOption {
  readonly value: AssetConfigurationValue;
  readonly label?: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly metadata?: AssetConfigurationMetadata;
}

export interface AssetConfigurationField {
  readonly fieldId: string;
  readonly valueKind: AssetConfigurationValueKind;
  readonly label?: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly defaultValue?: AssetConfigurationValue;
  readonly constraints?: readonly AssetConfigurationConstraint[];
  readonly options?: readonly AssetConfigurationOption[];
  readonly uiHint?: AssetConfigurationUiHint;
  readonly exampleValues?: readonly AssetConfigurationValue[];
  readonly metadata?: AssetConfigurationMetadata;
}
