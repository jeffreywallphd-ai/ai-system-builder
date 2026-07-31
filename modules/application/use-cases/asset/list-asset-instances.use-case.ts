import type { AssetInstanceListQuery, AssetInstanceListResult, AssetInstanceRepositoryPort } from "../../ports/asset";

export class ListAssetInstancesUseCase {
  public constructor(private readonly dependencies: { instanceRepository: AssetInstanceRepositoryPort }) {}

  public async execute(query?: AssetInstanceListQuery): Promise<AssetInstanceListResult> {
    return this.dependencies.instanceRepository.listInstances(query);
  }
}
