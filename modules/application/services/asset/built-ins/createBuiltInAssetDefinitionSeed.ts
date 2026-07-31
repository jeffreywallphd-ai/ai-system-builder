import type { AssetDefinition } from "../../../../contracts/asset";
import type { BuiltInAssetDefinitionSeed } from "../built-in-asset-definition-seeding.service";
import { BUILT_IN_ASSET_DEFINITION_VERSION, type BuiltInAssetDefinitionId } from "./built-in-asset-definition-ids";
import { createBuiltInAssetDefinitionFingerprint } from "./built-in-asset-definition-fingerprint";

export function createBuiltInAssetDefinitionSeed(definition: AssetDefinition): BuiltInAssetDefinitionSeed {
  const seedId = String(definition.definitionId) as BuiltInAssetDefinitionId;
  return {
    seedId,
    seedVersion: BUILT_IN_ASSET_DEFINITION_VERSION,
    definition,
    fingerprint: createBuiltInAssetDefinitionFingerprint(definition),
    source: "built-in",
  };
}
