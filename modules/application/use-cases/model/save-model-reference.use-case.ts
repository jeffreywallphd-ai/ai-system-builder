import {
  normalizeSaveModelReferenceRequest,
  normalizeModelInventoryRecord,
  type SaveModelReferenceRequest,
  type SaveModelReferenceResult,
} from "../../../contracts/model";
import type { ModelRegistryPort } from "../../ports/model";

export class SaveModelReferenceUseCase {
  public constructor(private readonly dependencies: { modelRegistry: ModelRegistryPort }) {}

  public async execute(request: SaveModelReferenceRequest): Promise<SaveModelReferenceResult> {
    const normalizedRequest = normalizeSaveModelReferenceRequest(request);
    const result = await this.dependencies.modelRegistry.saveModelReference(normalizedRequest);
    return { model: normalizeModelInventoryRecord(result.model) };
  }
}
