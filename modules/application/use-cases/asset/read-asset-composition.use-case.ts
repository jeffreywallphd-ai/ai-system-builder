import type { AssetComposition, AssetReference } from "../../../contracts/asset";
import type { AssetCompositionRepositoryPort } from "../../ports/asset";
import type { AssetUseCaseResult } from "./asset-use-case-result";
import { invalidReferenceResult, isCompositionReference, notFoundResult, success } from "./asset-use-case-helpers";

export class ReadAssetCompositionUseCase {
  public constructor(private readonly dependencies: { compositionRepository: AssetCompositionRepositoryPort }) {}

  public async execute(reference: AssetReference): Promise<AssetUseCaseResult<AssetComposition>> {
    if (!isCompositionReference(reference)) return invalidReferenceResult("Asset composition reads require an asset-composition reference.", { referenceKind: reference.kind });
    const composition = await this.dependencies.compositionRepository.getComposition(reference);
    return composition ? success(composition) : notFoundResult("Asset composition was not found.", { referenceKind: reference.kind, referenceId: reference.id });
  }
}
