import {
  normalizeListModelsRequest,
  normalizeListModelsResult,
  type ListModelsRequest,
  type ListModelsResult,
} from "../../../contracts/model";
import type { ModelRegistryPort } from "../../ports/model";

export class ListModelsUseCase {
  public constructor(private readonly dependencies: { modelRegistry: ModelRegistryPort }) {}

  public async execute(request: ListModelsRequest): Promise<ListModelsResult> {
    const normalizedRequest = normalizeListModelsRequest(request);
    const result = await this.dependencies.modelRegistry.listModels(normalizedRequest);
    return normalizeListModelsResult(result);
  }
}
