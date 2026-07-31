import type { AssetInstance } from "../../../contracts/asset";
import type { AssetDefinitionRepositoryPort } from "../../ports/asset";
import { validateAssetInstance, type AssetValidationResult } from "../../services/asset";
import { buildInstanceValidationContext, mergeValidationIssues } from "./asset-use-case-helpers";

export class ValidateAssetInstanceUseCase {
  public constructor(private readonly dependencies: { definitionRepository: AssetDefinitionRepositoryPort }) {}

  public async execute(instance: AssetInstance): Promise<AssetValidationResult> {
    const { context, issues } = await buildInstanceValidationContext(instance, this.dependencies.definitionRepository);
    return mergeValidationIssues(validateAssetInstance(instance, context), issues);
  }
}
