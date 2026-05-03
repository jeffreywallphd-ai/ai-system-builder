import {
  normalizeModelInventoryRecord,
  normalizeRegisterDownloadedModelRequest,
  type RegisterDownloadedModelRequest,
  type RegisterDownloadedModelResult,
} from "../../../contracts/model";
import type { ModelRegistryPort } from "../../ports/model";

function ensureDownloadedBacking(request: RegisterDownloadedModelRequest): void {
  if (!request.localPath && (!request.backingArtifactIds || request.backingArtifactIds.length === 0)) {
    throw new Error("Downloaded model registration requires localPath or backingArtifactIds.");
  }
}

export class RegisterDownloadedModelUseCase {
  public constructor(private readonly dependencies: { modelRegistry: ModelRegistryPort }) {}

  public async execute(request: RegisterDownloadedModelRequest): Promise<RegisterDownloadedModelResult> {
    const normalizedRequest = normalizeRegisterDownloadedModelRequest(request);
    ensureDownloadedBacking(normalizedRequest);

    const result = await this.dependencies.modelRegistry.registerDownloadedModel(normalizedRequest);
    return { model: normalizeModelInventoryRecord(result.model) };
  }
}
