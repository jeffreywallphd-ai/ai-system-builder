import type { AssetComposition } from "../../../contracts/asset";
import type { AssetBindingRepositoryPort, AssetDefinitionRepositoryPort, AssetInstanceRepositoryPort } from "../../ports/asset";
import { validateAssetComposition, type AssetValidationResult } from "../../services/asset";
import { buildCompositionValidationContext, mergeValidationIssues } from "./asset-use-case-helpers";

export class ValidateAssetCompositionUseCase {
  public constructor(private readonly dependencies: { definitionRepository: AssetDefinitionRepositoryPort; instanceRepository: AssetInstanceRepositoryPort; bindingRepository?: AssetBindingRepositoryPort }) {}

  public async execute(composition: AssetComposition): Promise<AssetValidationResult> {
    const { context, issues } = await buildCompositionValidationContext(composition, this.dependencies);
    return mergeValidationIssues(validateAssetComposition(composition, context), issues);
  }
}
