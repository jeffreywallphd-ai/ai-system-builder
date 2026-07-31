import type { AssetDefinitionListQuery, AssetDefinitionListResult, AssetDefinitionRepositoryPort } from "../../ports/asset";

export class ListAssetDefinitionsUseCase {
  public constructor(private readonly dependencies: { definitionRepository: AssetDefinitionRepositoryPort }) {}

  public async execute(query?: AssetDefinitionListQuery): Promise<AssetDefinitionListResult> {
    return this.dependencies.definitionRepository.listDefinitions(query);
  }
}
