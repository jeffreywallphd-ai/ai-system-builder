import type { AssetDefinition } from "../../../contracts/asset";
import type { AssetDefinitionRepositoryPort } from "../../ports/asset";
import { validateAssetDefinition } from "../../services/asset";
import type { AssetUseCaseResult } from "./asset-use-case-result";
import { canSaveValidationResult, success, validationFailure } from "./asset-use-case-helpers";

export class RegisterAssetDefinitionUseCase {
  public constructor(private readonly dependencies: { definitionRepository: AssetDefinitionRepositoryPort }) {}

  public async execute(definition: AssetDefinition): Promise<AssetUseCaseResult<AssetDefinition>> {
    const validation = validateAssetDefinition(definition);
    if (!canSaveValidationResult(validation)) return validationFailure(validation);
    return success(await this.dependencies.definitionRepository.saveDefinition(definition), validation);
  }

  public async executeMany(definitions: readonly AssetDefinition[], expected: readonly (AssetDefinition | undefined)[]): Promise<AssetUseCaseResult<readonly AssetDefinition[]>> {
    if (!Array.isArray(definitions) || definitions.length < 1 || definitions.length > 250 || !Array.isArray(expected) || expected.length !== definitions.length) {
      return { ok: false, error: { code: "validation-failed", message: "Invalid bounded definition batch." } };
    }
    for (const definition of definitions) {
      const validation = validateAssetDefinition(definition);
      if (!canSaveValidationResult(validation)) return validationFailure(validation);
    }
    if (!this.dependencies.definitionRepository.saveDefinitions) {
      return { ok: false, error: { code: "internal", message: "Atomic definition registration is unavailable." } };
    }
    return success(await this.dependencies.definitionRepository.saveDefinitions(definitions, expected));
  }
}
