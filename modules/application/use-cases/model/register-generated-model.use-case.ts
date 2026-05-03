import {
  normalizeModelInventoryRecord,
  normalizeRegisterGeneratedModelRequest,
  type RegisterGeneratedModelRequest,
  type RegisterGeneratedModelResult,
} from "../../../contracts/model";
import type { ModelRegistryPort } from "../../ports/model";

function ensureGeneratedBacking(request: RegisterGeneratedModelRequest): void {
  if (!request.localPath && (!request.backingArtifactIds || request.backingArtifactIds.length === 0)) {
    throw new Error("Generated model registration requires localPath or backingArtifactIds.");
  }

  if (request.artifactForm === "adapter" && !request.adapterOfModelId && !request.baseModelId) {
    throw new Error("Adapter model registration should include adapterOfModelId or baseModelId.");
  }
}

export class RegisterGeneratedModelUseCase {
  public constructor(private readonly dependencies: { modelRegistry: ModelRegistryPort }) {}

  public async execute(request: RegisterGeneratedModelRequest): Promise<RegisterGeneratedModelResult> {
    const normalizedRequest = normalizeRegisterGeneratedModelRequest(request);
    ensureGeneratedBacking(normalizedRequest);

    const result = await this.dependencies.modelRegistry.registerGeneratedModel(normalizedRequest);
    return { model: normalizeModelInventoryRecord(result.model) };
  }
}
