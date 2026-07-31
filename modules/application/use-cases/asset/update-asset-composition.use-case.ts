import type { AssetComposition } from "../../../contracts/asset";
import type { AssetBindingRepositoryPort, AssetCompositionRepositoryPort, AssetDefinitionRepositoryPort, AssetInstanceRepositoryPort } from "../../ports/asset";
import { validateAssetComposition } from "../../services/asset";
import type { AssetUseCaseResult } from "./asset-use-case-result";
import { buildCompositionValidationContext, canSaveValidationResult, mergeValidationIssues, success, validationFailure } from "./asset-use-case-helpers";

export class UpdateAssetCompositionUseCase {
  public constructor(private readonly dependencies: { compositionRepository: AssetCompositionRepositoryPort; definitionRepository: AssetDefinitionRepositoryPort; instanceRepository: AssetInstanceRepositoryPort; bindingRepository?: AssetBindingRepositoryPort }) {}

  public async execute(composition: AssetComposition): Promise<AssetUseCaseResult<AssetComposition>> {
    const { context, issues } = await buildCompositionValidationContext(composition, this.dependencies);
    const validation = mergeValidationIssues(validateAssetComposition(composition, context), issues);
    if (!canSaveValidationResult(validation)) return validationFailure(validation);
    return success(await this.dependencies.compositionRepository.saveComposition(composition), validation);
  }
}
