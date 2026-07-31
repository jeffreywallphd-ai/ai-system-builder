import type { AssetInstance } from "../../../contracts/asset";
import type { AssetDefinitionRepositoryPort, AssetInstanceRepositoryPort } from "../../ports/asset";
import { validateAssetInstance } from "../../services/asset";
import type { AssetUseCaseResult } from "./asset-use-case-result";
import { buildInstanceValidationContext, canSaveValidationResult, mergeValidationIssues, success, validationFailure } from "./asset-use-case-helpers";

export class CreateAssetInstanceUseCase {
  public constructor(private readonly dependencies: { definitionRepository: AssetDefinitionRepositoryPort; instanceRepository: AssetInstanceRepositoryPort }) {}

  public async execute(instance: AssetInstance): Promise<AssetUseCaseResult<AssetInstance>> {
    const { context, issues } = await buildInstanceValidationContext(instance, this.dependencies.definitionRepository);
    const validation = mergeValidationIssues(validateAssetInstance(instance, context), issues);
    if (!canSaveValidationResult(validation)) return validationFailure(validation);
    return success(await this.dependencies.instanceRepository.saveInstance(instance), validation);
  }
}
