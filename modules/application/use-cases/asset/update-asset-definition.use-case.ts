import type { AssetDefinition } from "../../../contracts/asset";
import type { AssetDefinitionRepositoryPort } from "../../ports/asset";
import { validateAssetDefinition } from "../../services/asset";
import type { AssetUseCaseResult } from "./asset-use-case-result";
import { canSaveValidationResult, success, validationFailure } from "./asset-use-case-helpers";

export class UpdateAssetDefinitionUseCase {
  public constructor(private readonly dependencies: { definitionRepository: AssetDefinitionRepositoryPort }) {}

  public async execute(definition: AssetDefinition): Promise<AssetUseCaseResult<AssetDefinition>> {
    const validation = validateAssetDefinition(definition);
    if (!canSaveValidationResult(validation)) return validationFailure(validation);
    return success(await this.dependencies.definitionRepository.saveDefinition(definition), validation);
  }
}
