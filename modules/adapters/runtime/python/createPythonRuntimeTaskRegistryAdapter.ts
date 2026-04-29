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

const genericToPythonTaskTypeMap: Record<TaskType, string> = {
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

export function createPythonRuntimeTaskRegistryAdapter(runtimePort: PythonRuntimePort): RuntimeTaskRegistryPort {
  return {
    async startTask(request: StartRuntimeTaskRequest): Promise<StartRuntimeTaskResult> {
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
        progress: status.progress,
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
