import type { RuntimeTaskRegistryPort } from "../../../application/ports/runtime";
import type { PythonRuntimePort } from "../../../application/ports/runtime";
import { randomUUID } from "node:crypto";
import type {
  CancelRuntimeTaskResult,
  RuntimeTaskRecord,
  RuntimeTaskStatus,
  StartRuntimeTaskRequest,
  StartRuntimeTaskResult,
  RuntimeTaskListRequest,
  RuntimeTaskListResult,
} from "../../../contracts/runtime";
import { TaskType } from "../../../contracts/runtime";

const genericToPythonTaskTypeMap: Partial<Record<TaskType, string>> = {
  [TaskType.DATASET_PREPARATION]: "prepare-training-dataset",
  [TaskType.MODEL_TRAINING]: "train-model",
  [TaskType.MODEL_VALIDATION]: "validate-model",
  [TaskType.MODEL_PUBLISHING]: "publish-model",
};

function toPythonTaskType(taskType: TaskType): string {
  const mapped = genericToPythonTaskTypeMap[taskType];
  if (!mapped) {
    throw new Error(`Unsupported runtime task type '${taskType}'.`);
  }
  return mapped;
}

function toGenericTaskType(taskType: string | undefined): RuntimeTaskRecord["taskType"] {
  if (taskType === "prepare-training-dataset") {
    return TaskType.DATASET_PREPARATION;
  }
  if (taskType === "train-model") {
    return TaskType.MODEL_TRAINING;
  }
  if (taskType === "validate-model") {
    return TaskType.MODEL_VALIDATION;
  }
  if (taskType === "publish-model") {
    return TaskType.MODEL_PUBLISHING;
  }
  throw new Error(`Unknown python runtime task type '${taskType ?? "undefined"}'.`);
}

function toRuntimeTaskStatus(status: string | undefined): RuntimeTaskStatus {
  if (status === "queued" || status === "running" || status === "succeeded" || status === "failed" || status === "cancelled" || status === "unknown") {
    return status;
  }
  return "unknown";
}

function mapProgress(progress: Record<string, unknown> | undefined): RuntimeTaskRecord["progress"] {
  if (!progress) {
    return undefined;
  }
  const processedChunkCount = typeof progress.processedChunkCount === "number" ? progress.processedChunkCount : undefined;
  const totalChunkCount = typeof progress.totalChunkCount === "number" ? progress.totalChunkCount : undefined;
  return {
    message: typeof progress.message === "string" ? progress.message : undefined,
    current: processedChunkCount,
    total: totalChunkCount,
    unit: typeof processedChunkCount === "number" || typeof totalChunkCount === "number" ? "chunk" : undefined,
    details: progress,
  };
}

export interface CreatePythonRuntimeTaskRegistryAdapterOptions {
  ensureRuntimeReady?: () => Promise<void>;
}

export function createPythonRuntimeTaskRegistryAdapter(
  runtimePort: PythonRuntimePort,
  options: CreatePythonRuntimeTaskRegistryAdapterOptions = {},
): RuntimeTaskRegistryPort {
  return {
    async startTask(request: StartRuntimeTaskRequest): Promise<StartRuntimeTaskResult> {
      if (request.taskType === TaskType.MODEL_PUBLISHING) {
        throw new Error("model publishing runtime task is not implemented");
      }
      try {
        await options.ensureRuntimeReady?.();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Python runtime failed to start or become ready before starting task: ${reason}`);
      }
      return runtimePort.startTask({
        requestId: request.requestId ?? randomUUID(),
        taskType: toPythonTaskType(request.taskType),
        payload: request.payload,
        metadata: request.metadata,
      });
    },
    async getTaskStatus(requestId: string): Promise<RuntimeTaskRecord> {
      const status = await runtimePort.readTaskStatus(requestId);
      return {
        requestId: status.requestId,
        taskType: toGenericTaskType(status.taskType),
        status: status.status,
        concurrencyClass: "unknown",
        progress: mapProgress(status.progress),
        data: status.data,
        error: status.error,
        metadata: status.metadata,
        startedAt: status.startedAt,
        updatedAt: status.updatedAt,
      };
    },
    async cancelTask(requestId: string): Promise<CancelRuntimeTaskResult> {
      const result = await runtimePort.cancelTask(requestId);
      return {
        requestId: result.requestId,
        cancelled: result.cancelled,
        status: toRuntimeTaskStatus(result.status),
        message: result.message,
      };
    },
    async listTasks(_request: RuntimeTaskListRequest): Promise<RuntimeTaskListResult> {
      throw new Error("Python runtime task listing is not supported by the current runtime port.");
    },
  };
}
