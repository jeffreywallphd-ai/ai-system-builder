import type { AssetInstance, AssetReference } from "../../../contracts/asset";
import type { AssetInstanceRepositoryPort } from "../../ports/asset";
import type { AssetUseCaseResult } from "./asset-use-case-result";
import { invalidReferenceResult, isInstanceReference, notFoundResult, success } from "./asset-use-case-helpers";

export class ReadAssetInstanceUseCase {
  public constructor(private readonly dependencies: { instanceRepository: AssetInstanceRepositoryPort }) {}

  public async execute(reference: AssetReference): Promise<AssetUseCaseResult<AssetInstance>> {
    if (!isInstanceReference(reference)) return invalidReferenceResult("Asset instance reads require an asset-instance reference.", { referenceKind: reference.kind });
    const instance = await this.dependencies.instanceRepository.getInstance(reference);
    return instance ? success(instance) : notFoundResult("Asset instance was not found.", { referenceKind: reference.kind, referenceId: reference.id });
  }
}
