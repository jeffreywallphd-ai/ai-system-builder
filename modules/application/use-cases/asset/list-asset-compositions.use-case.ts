import type { AssetCompositionListQuery, AssetCompositionListResult, AssetCompositionRepositoryPort } from "../../ports/asset";

export class ListAssetCompositionsUseCase {
  public constructor(private readonly dependencies: { compositionRepository: AssetCompositionRepositoryPort }) {}

  public async execute(query?: AssetCompositionListQuery): Promise<AssetCompositionListResult> {
    return this.dependencies.compositionRepository.listCompositions(query);
  }
}
