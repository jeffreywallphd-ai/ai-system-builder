import type { AssetDefinition } from "../../../contracts/asset";
import { validateAssetDefinition, type AssetValidationResult } from "../../services/asset";

export class ValidateAssetDefinitionUseCase {
  public execute(definition: AssetDefinition): AssetValidationResult {
    return validateAssetDefinition(definition);
  }
}
