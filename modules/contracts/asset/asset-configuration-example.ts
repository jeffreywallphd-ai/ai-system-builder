import type {
  AssetConfigurationMetadata,
  AssetConfigurationValues,
} from "./asset-configuration-value";

export interface AssetConfigurationExample {
  readonly exampleId?: string;
  readonly label?: string;
  readonly description?: string;
  readonly values: AssetConfigurationValues;
  readonly metadata?: AssetConfigurationMetadata;
}
