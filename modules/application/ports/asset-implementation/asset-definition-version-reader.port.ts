import type { AssetDefinition, AssetReference } from "../../../contracts/asset";

export interface AssetDefinitionVersionReaderPort {
  readExactDefinition(
    reference: AssetReference,
  ): Promise<AssetDefinition | undefined>;
}
