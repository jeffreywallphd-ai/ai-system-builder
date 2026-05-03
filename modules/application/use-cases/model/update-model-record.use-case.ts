import {
  normalizeModelInventoryRecord,
  normalizeUpdateModelRecordRequest,
  type UpdateModelRecordRequest,
  type UpdateModelRecordResult,
} from "../../../contracts/model";
import type { ModelRegistryPort } from "../../ports/model";

export class UpdateModelRecordUseCase {
  public constructor(private readonly dependencies: { modelRegistry: ModelRegistryPort }) {}

  public async execute(request: UpdateModelRecordRequest): Promise<UpdateModelRecordResult> {
    const normalizedRequest = normalizeUpdateModelRecordRequest(request);
    const result = await this.dependencies.modelRegistry.updateModelRecord(normalizedRequest);
    return { model: normalizeModelInventoryRecord(result.model) };
  }
}
