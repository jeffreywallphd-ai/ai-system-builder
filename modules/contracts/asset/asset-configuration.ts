import type { AssetConfigurationExample } from "./asset-configuration-example";
import type { AssetConfigurationSchema } from "./asset-configuration-schema";
import type { AssetConfigurationValues } from "./asset-configuration-value";

export interface AssetConfiguration {
  readonly schema?: AssetConfigurationSchema;
  readonly defaultValues?: AssetConfigurationValues;
  readonly selectedValues?: AssetConfigurationValues;
  readonly examples?: readonly AssetConfigurationExample[];
}
