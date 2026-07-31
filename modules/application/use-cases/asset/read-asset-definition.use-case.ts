import type { AssetDefinition, AssetReference } from "../../../contracts/asset";
import type { AssetDefinitionRepositoryPort } from "../../ports/asset";
import type { AssetUseCaseResult } from "./asset-use-case-result";
import { invalidReferenceResult, isDefinitionReference, notFoundResult, success } from "./asset-use-case-helpers";

export class ReadAssetDefinitionUseCase {
  public constructor(private readonly dependencies: { definitionRepository: AssetDefinitionRepositoryPort }) {}

  public async execute(reference: AssetReference): Promise<AssetUseCaseResult<AssetDefinition>> {
    if (!isDefinitionReference(reference)) return invalidReferenceResult("Asset definition reads require an asset-definition or asset-definition-version reference.", { referenceKind: reference.kind });
    const definition = await this.dependencies.definitionRepository.getDefinition(reference);
    return definition ? success(definition) : notFoundResult("Asset definition was not found.", { referenceKind: reference.kind, referenceId: reference.id });
  }
}
