import type { AssetBinding, AssetComposition, AssetDefinition, AssetInstance } from "../../../contracts/asset";
import { validateAssetBinding } from "./validate-asset-binding.service";
import { validateAssetComposition } from "./validate-asset-composition.service";
import { validateAssetDefinition } from "./validate-asset-definition.service";
import { validateAssetInstance } from "./validate-asset-instance.service";
export type { AssetValidationContext, AssetValidationOptions, AssetValidationResult } from "./asset-validation-helpers";
export { deriveAssetValidationStatus } from "./asset-validation-helpers";
export { validateAssetBinding, validateAssetComposition, validateAssetDefinition, validateAssetInstance };
import type { AssetValidationContext, AssetValidationResult } from "./asset-validation-helpers";

export class AssetValidationService {
  public validateDefinition(definition: AssetDefinition, context: AssetValidationContext = {}): AssetValidationResult {
    return validateAssetDefinition(definition, context);
  }

  public validateInstance(instance: AssetInstance, context: AssetValidationContext = {}): AssetValidationResult {
    return validateAssetInstance(instance, context);
  }

  public validateBinding(binding: AssetBinding, context: AssetValidationContext = {}): AssetValidationResult {
    return validateAssetBinding(binding, context);
  }

  public validateComposition(composition: AssetComposition, context: AssetValidationContext = {}): AssetValidationResult {
    return validateAssetComposition(composition, context);
  }
}
