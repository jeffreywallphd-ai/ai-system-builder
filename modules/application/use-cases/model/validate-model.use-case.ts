import { TaskType, type RuntimeTaskRecord } from "../../../contracts/runtime";
import { type ValidateModelRequest, type ValidateModelResult } from "../../../contracts/model";
import type { ModelRegistryPort } from "../../ports/model";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";

export class ValidateModelUseCase {
  private readonly requestContext = new Map<string, { request: ValidateModelRequest; modelRecordId: string }>();
  private readonly finalizedResults = new Map<string, ValidateModelResult>();

  public constructor(
    private readonly dependencies: {
      runtimeTaskRegistry: RuntimeTaskRegistryPort;
      modelRegistry: ModelRegistryPort;
    },
  ) {}

  public async execute(request: ValidateModelRequest): Promise<ValidateModelResult> {
    const model = await this.dependencies.modelRegistry.getModelRecord(request.modelRecordId);
    if (!model) {
      throw new Error(`Model record '${request.modelRecordId}' was not found.`);
    }

    const started = await this.dependencies.runtimeTaskRegistry.startTask({
      taskType: TaskType.MODEL_VALIDATION,
      payload: {
        ...request,
        modelPath: request.modelPath ?? model.localPath,
        validationStrictness: request.validationStrictness ?? "normal",
      },
    });
    this.requestContext.set(started.requestId, { request, modelRecordId: request.modelRecordId });
    return { modelRecordId: request.modelRecordId, status: "unknown", requestId: started.requestId } as ValidateModelResult;
  }

  public async read(requestId: string): Promise<ValidateModelResult> {
    const cached = this.finalizedResults.get(requestId);
    if (cached) {
      return cached;
    }
    const context = this.requestContext.get(requestId);
    const status = await this.dependencies.runtimeTaskRegistry.getTaskStatus(requestId);
    if (status.status === "running" || status.status === "queued") {
      return { modelRecordId: context?.modelRecordId ?? status.requestId, status: "unknown", requestId } as ValidateModelResult;
    }
    if (status.status === "failed" || status.status === "cancelled" || status.status === "unknown") {
      return {
        modelRecordId: context?.modelRecordId ?? status.requestId,
        status: "invalid",
        errors: [status.error?.message ?? "Validation task failed."],
        requestId,
      } as ValidateModelResult;
    }
    return this.resolveSucceeded(status, requestId);
  }

  private async resolveSucceeded(statusRecord: RuntimeTaskRecord, requestId: string): Promise<ValidateModelResult> {
    if (!statusRecord.data || typeof statusRecord.data !== "object") {
      throw new Error(`Model validation runtime result missing for request '${statusRecord.requestId}'.`);
    }
    const result = statusRecord.data as ValidateModelResult;
    const model = await this.dependencies.modelRegistry.getModelRecord(result.modelRecordId);
    if (!model) {
      throw new Error(`Model record '${result.modelRecordId}' was not found.`);
    }
    const nextLifecycleStatus = result.status === "valid" ? "validated" : (result.status === "invalid" ? "invalid" : model.lifecycleStatus);
    await this.dependencies.modelRegistry.updateModelRecord({ modelRecordId: result.modelRecordId, patch: { validationStatus: result.status, validationReportPath: result.reportPath, serializationFormat: result.serializationFormat, lifecycleStatus: nextLifecycleStatus, metadata: { ...(model.metadata ?? {}), validationDiffPath: result.diffPath, validationWarnings: result.warnings, validationErrors: result.errors, shardCount: result.shardCount, validatedModelPath: result.validatedModelPath, validatedAt: result.validatedAt, validationStrictness: result.validationStrictness, tensorChecksCompleted: result.tensorChecksCompleted } } });
    const finalized = { ...result, requestId } as ValidateModelResult;
    this.finalizedResults.set(requestId, finalized);
    return finalized;
  }
}
