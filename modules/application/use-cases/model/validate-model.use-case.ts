import { isWorkspaceId } from "../../../contracts/workspace";
import { TaskType, type RuntimeTaskRecord } from "../../../contracts/runtime";
import {
  type ValidateModelRequest,
  type ValidateModelResult,
} from "../../../contracts/model";
import type { ModelRegistryPort } from "../../ports/model";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import type { RuntimeCapabilityGuardService } from "../../services/runtime";

export class ValidateModelUseCase {
  private readonly requestContext = new Map<
    string,
    { request: ValidateModelRequest; modelRecordId: string }
  >();
  private readonly finalizedResults = new Map<string, ValidateModelResult>();

  public constructor(
    private readonly dependencies: {
      runtimeTaskRegistry: RuntimeTaskRegistryPort;
      modelRegistry: ModelRegistryPort;
      runtimeCapabilityGuard?: Pick<
        RuntimeCapabilityGuardService,
        "requireCapabilityReady"
      >;
    },
  ) {}

  public async execute(
    request: ValidateModelRequest,
  ): Promise<ValidateModelResult> {
    if (!isWorkspaceId(request.workspaceId))
      throw new Error("Workspace id is required for model validation.");
    const model = await this.dependencies.modelRegistry.getModelRecord(
      request.workspaceId,
      request.modelRecordId,
    );
    if (!model) {
      throw new Error(`Model record '${request.modelRecordId}' was not found.`);
    }
    if (request.modelPath !== undefined) {
      throw new TypeError("Model validation paths are resolved by the host.");
    }
    if (request.reportOutputDirectory !== undefined) {
      throw new TypeError(
        "Model validation report destinations are resolved by the host.",
      );
    }
    if (!model.localPath) {
      throw new Error(
        "Registered model content is required for model validation.",
      );
    }
    await this.dependencies.runtimeCapabilityGuard?.requireCapabilityReady(
      "model-validation",
    );

    const started = await this.dependencies.runtimeTaskRegistry.startTask({
      taskType: TaskType.MODEL_VALIDATION,
      workspaceId: request.workspaceId,
      payload: {
        modelRecordId: request.modelRecordId,
        modelPath: model.localPath,
        expectedLoRA: request.expectedLoRA,
        expectedRecurrentAdditions: request.expectedRecurrentAdditions,
        validationStrictness: request.validationStrictness ?? "normal",
      },
    });
    this.requestContext.set(started.requestId, {
      request,
      modelRecordId: request.modelRecordId,
    });
    return {
      modelRecordId: request.modelRecordId,
      status: "unknown",
      requestId: started.requestId,
    } as ValidateModelResult;
  }

  public async read(requestId: string): Promise<ValidateModelResult> {
    const cached = this.finalizedResults.get(requestId);
    if (cached) {
      return cached;
    }
    const context = this.requestContext.get(requestId);
    const status =
      await this.dependencies.runtimeTaskRegistry.getTaskStatus(requestId);
    if (status.status === "running" || status.status === "queued") {
      return {
        modelRecordId: context?.modelRecordId ?? status.requestId,
        status: "unknown",
        requestId,
      } as ValidateModelResult;
    }
    if (
      status.status === "failed" ||
      status.status === "cancelled" ||
      status.status === "unknown"
    ) {
      return {
        modelRecordId: context?.modelRecordId ?? status.requestId,
        status: "invalid",
        errors: [status.error?.message ?? "Validation task failed."],
        requestId,
      } as ValidateModelResult;
    }
    return this.resolveSucceeded(status, requestId);
  }

  private async resolveSucceeded(
    statusRecord: RuntimeTaskRecord,
    requestId: string,
  ): Promise<ValidateModelResult> {
    if (!statusRecord.data || typeof statusRecord.data !== "object") {
      throw new Error(
        `Model validation runtime result missing for request '${statusRecord.requestId}'.`,
      );
    }
    const context = this.requestContext.get(requestId);
    const rawResult = statusRecord.data as Record<string, unknown>;
    const expectedModelRecordId = context?.modelRecordId;
    if (
      !expectedModelRecordId ||
      rawResult.modelRecordId !== expectedModelRecordId
    ) {
      throw new Error(
        "Model validation runtime result did not match the submitted model.",
      );
    }
    const status = rawResult.status;
    if (
      status !== "unknown" &&
      status !== "valid" &&
      status !== "invalid" &&
      status !== "warning"
    ) {
      throw new Error("Model validation runtime result is malformed.");
    }
    const readReference = (
      value: unknown,
      role: "validation-report" | "validation-diff",
    ): string | undefined => {
      if (value === undefined || value === null) return undefined;
      if (
        typeof value !== "string" ||
        !new RegExp("^" + role + ":[a-f0-9]{64}$").test(value)
      ) {
        throw new Error(
          "Model validation runtime returned an unsafe report reference.",
        );
      }
      return value;
    };
    const readStrings = (value: unknown): string[] | undefined => {
      if (!Array.isArray(value)) return undefined;
      return value
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, 100)
        .map((entry) => entry.slice(0, 1_000));
    };
    const result: ValidateModelResult = {
      modelRecordId: expectedModelRecordId,
      status,
      reportPath: readReference(
        rawResult.validationReportPath,
        "validation-report",
      ),
      diffPath: readReference(rawResult.validationDiffPath, "validation-diff"),
      serializationFormat:
        typeof rawResult.serializationFormat === "string"
          ? (rawResult.serializationFormat as ValidateModelResult["serializationFormat"])
          : undefined,
      shardCount:
        typeof rawResult.shardCount === "number"
          ? rawResult.shardCount
          : undefined,
      detectedLoRA:
        typeof rawResult.detectedLoRA === "boolean"
          ? rawResult.detectedLoRA
          : undefined,
      detectedRecurrentAdditions:
        typeof rawResult.detectedRecurrentAdditions === "boolean"
          ? rawResult.detectedRecurrentAdditions
          : undefined,
      validatedAt:
        typeof rawResult.validatedAt === "string"
          ? rawResult.validatedAt
          : undefined,
      validationStrictness:
        rawResult.validationStrictness === "publish"
          ? "publish"
          : rawResult.validationStrictness === "normal"
            ? "normal"
            : undefined,
      tensorChecksCompleted:
        typeof rawResult.tensorChecksCompleted === "boolean"
          ? rawResult.tensorChecksCompleted
          : undefined,
      warnings: readStrings(rawResult.warnings),
      errors: readStrings(rawResult.errors),
    };
    const workspaceId =
      context?.request.workspaceId ?? statusRecord.workspaceId;
    if (!isWorkspaceId(workspaceId))
      throw new Error(
        "Workspace id is required for model validation result finalization.",
      );
    const model = await this.dependencies.modelRegistry.getModelRecord(
      workspaceId,
      result.modelRecordId,
    );
    if (!model) {
      throw new Error(`Model record '${result.modelRecordId}' was not found.`);
    }
    const nextLifecycleStatus =
      result.status === "valid"
        ? "validated"
        : result.status === "invalid"
          ? "invalid"
          : model.lifecycleStatus;
    await this.dependencies.modelRegistry.updateModelRecord({
      workspaceId,
      modelRecordId: result.modelRecordId,
      patch: {
        validationStatus: result.status,
        validationReportPath: result.reportPath,
        serializationFormat: result.serializationFormat,
        lifecycleStatus: nextLifecycleStatus,
        metadata: {
          ...(model.metadata ?? {}),
          validationDiffRef: result.diffPath,
          validationWarnings: result.warnings,
          validationErrors: result.errors,
          shardCount: result.shardCount,
          validatedAt: result.validatedAt,
          validationStrictness: result.validationStrictness,
          tensorChecksCompleted: result.tensorChecksCompleted,
        },
      },
    });
    const finalized = { ...result, requestId } as ValidateModelResult;
    this.finalizedResults.set(requestId, finalized);
    return finalized;
  }
}
