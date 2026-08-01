import type { RuntimeTaskRegistryPort } from "../../../application/ports/runtime";
import type { PythonRuntimePort } from "../../../application/ports/runtime";
import type {
  CompletedModelDownload,
  ModelDownloadCompletionPort,
} from "../../../application/ports/model";
import { randomUUID } from "node:crypto";
import type {
  CancelRuntimeTaskResult,
  RuntimeTaskRecord,
  RuntimeTaskStatusRecord,
  RuntimeTaskStatus,
  StartRuntimeTaskRequest,
  StartRuntimeTaskResult,
  RuntimeTaskListRequest,
  RuntimeTaskListResult,
} from "../../../contracts/runtime";
import { isWorkspaceId } from "../../../contracts/workspace";
import { TaskType } from "../../../contracts/runtime";
import { resolvePythonRuntimeTaskTimeoutMs } from "./pythonRuntimeTaskTimeoutPolicy";

const genericToPythonTaskTypeMap: Partial<Record<TaskType, string>> = {
  [TaskType.DATASET_PREPARATION]: "prepare-training-dataset",
  [TaskType.DATASET_REVIEW]: "review-dataset",
  [TaskType.CONTEXT_GENERATION]: "generate-context-artifact",
  [TaskType.CONTEXT_RETRIEVAL]: "context-artifact-operation",
  [TaskType.MODEL_DOWNLOAD]: "ensure-model-download",
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

function toGenericTaskType(
  taskType: string | undefined,
): RuntimeTaskRecord["taskType"] {
  if (taskType === "prepare-training-dataset") {
    return TaskType.DATASET_PREPARATION;
  }
  if (taskType === "review-dataset") {
    return TaskType.DATASET_REVIEW;
  }
  if (taskType === "generate-context-artifact") {
    return TaskType.CONTEXT_GENERATION;
  }
  if (taskType === "context-artifact-operation") {
    return TaskType.CONTEXT_RETRIEVAL;
  }
  if (taskType === "ensure-model-download") {
    return TaskType.MODEL_DOWNLOAD;
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
  throw new Error(
    `Unknown python runtime task type '${taskType ?? "undefined"}'.`,
  );
}

function toRuntimeTaskStatus(status: string | undefined): RuntimeTaskStatus {
  if (
    status === "queued" ||
    status === "running" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "unknown"
  ) {
    return status;
  }
  return "unknown";
}

function sanitizePublicText(value: unknown, limit = 240): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = value
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(
      /\b(token|secret|password|api[-_ ]?key|authorization)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, "[local path]")
    .replace(/\/(?:Users|home|tmp|var|etc|opt)\/[^\s,;]*/g, "[local path]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized ? sanitized.slice(0, limit) : undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(value, Number.MAX_SAFE_INTEGER)
    : undefined;
}

function mapProgress(
  progress: Record<string, unknown> | undefined,
  taskType: TaskType,
): RuntimeTaskRecord["progress"] {
  if (!progress) {
    return undefined;
  }
  if (taskType === TaskType.MODEL_DOWNLOAD) {
    const unit =
      progress.progressUnit === "bytes"
        ? "bytes"
        : progress.progressUnit === "files"
          ? "files"
          : undefined;
    const current =
      unit === "bytes"
        ? finiteNonNegative(progress.downloadedBytes)
        : unit === "files"
          ? finiteNonNegative(progress.completedFileCount)
          : undefined;
    const total =
      unit === "bytes"
        ? finiteNonNegative(progress.totalBytes)
        : unit === "files"
          ? finiteNonNegative(progress.totalFileCount)
          : undefined;
    const percent = finiteNonNegative(progress.downloadPercent);
    return {
      message: sanitizePublicText(progress.message),
      current,
      total,
      unit,
      percent: percent === undefined ? undefined : Math.min(percent, 100),
    };
  }
  const processedChunkCount =
    typeof progress.processedChunkCount === "number"
      ? progress.processedChunkCount
      : undefined;
  const totalChunkCount =
    typeof progress.totalChunkCount === "number"
      ? progress.totalChunkCount
      : undefined;
  return {
    message: sanitizePublicText(progress.message),
    current: processedChunkCount,
    total: totalChunkCount,
    unit:
      typeof processedChunkCount === "number" ||
      typeof totalChunkCount === "number"
        ? "chunk"
        : undefined,
    details: progress,
  };
}

export interface CreatePythonRuntimeTaskRegistryAdapterOptions {
  ensureRuntimeReady?: (request: StartRuntimeTaskRequest) => Promise<void>;
}

export type PythonRuntimeTaskRegistryAdapter = RuntimeTaskRegistryPort &
  ModelDownloadCompletionPort;

export function createPythonRuntimeTaskRegistryAdapter(
  runtimePort: PythonRuntimePort,
  options: CreatePythonRuntimeTaskRegistryAdapterOptions = {},
): PythonRuntimeTaskRegistryAdapter {
  const trackedTasks = new Map<string, RuntimeTaskRecord>();
  const completedDownloads = new Map<string, CompletedModelDownload>();
  const maximumTrackedTasks = 256;
  const rememberTask = (record: RuntimeTaskRecord): RuntimeTaskRecord => {
    trackedTasks.delete(record.requestId);
    trackedTasks.set(record.requestId, record);
    while (trackedTasks.size > maximumTrackedTasks) {
      const oldest = trackedTasks.keys().next().value;
      if (typeof oldest !== "string") break;
      trackedTasks.delete(oldest);
      completedDownloads.delete(oldest);
    }
    return record;
  };

  const adapter: PythonRuntimeTaskRegistryAdapter = {
    async startTask(
      request: StartRuntimeTaskRequest,
    ): Promise<StartRuntimeTaskResult> {
      if (!isWorkspaceId(request.workspaceId)) {
        throw new Error("Workspace id is required for python runtime tasks.");
      }
      if (request.taskType === TaskType.MODEL_PUBLISHING) {
        throw new Error("model publishing runtime task is not implemented");
      }
      try {
        await options.ensureRuntimeReady?.(request);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Python runtime failed to start or become ready before starting task: ${reason}`,
        );
      }
      const requestId = request.requestId ?? randomUUID();
      const pythonTaskType = toPythonTaskType(request.taskType);
      const result = await runtimePort.startTask({
        requestId,
        taskType: pythonTaskType,
        payload: request.payload,
        metadata: {
          ...(request.metadata ?? {}),
          workspaceId: request.workspaceId,
        },
        timeoutMs: resolvePythonRuntimeTaskTimeoutMs(pythonTaskType),
      });
      rememberTask({
        requestId: result.requestId,
        workspaceId: request.workspaceId,
        taskType: request.taskType,
        status: result.status ?? "queued",
        concurrencyClass:
          request.concurrencyClass ??
          (request.taskType === TaskType.MODEL_DOWNLOAD ? "io" : "unknown"),
        metadata: result.metadata,
        queuedAt: new Date().toISOString(),
      });
      return result;
    },
    async getTaskStatus(requestId: string): Promise<RuntimeTaskStatusRecord> {
      const status = await runtimePort.readTaskStatus(requestId);
      if (status.status === "unknown" && !status.taskType) {
        return {
          recordType: "not-found",
          requestId: status.requestId,
          status: "unknown",
          concurrencyClass: "unknown",
          error: {
            code: "python_runtime_task_not_found",
            message: "Python runtime task was not found.",
            details: { reason: "runtime-returned-unknown-without-task-type" },
            retryable: false,
          },
          metadata: status.metadata,
          updatedAt: status.updatedAt,
        };
      }
      const taskType = toGenericTaskType(status.taskType);
      let data = status.data;
      if (
        taskType === TaskType.MODEL_DOWNLOAD &&
        status.status === "succeeded"
      ) {
        const completion = await runtimePort.resolveModelDownloadTaskResult(
          status.data,
        );
        completedDownloads.set(status.requestId, completion);
        data = {
          provider: completion.provider,
          modelId: completion.modelId,
          downloaded: completion.downloaded,
          fromCache: completion.fromCache,
        };
      }
      const previous = trackedTasks.get(status.requestId);
      return rememberTask({
        requestId: status.requestId,
        workspaceId: isWorkspaceId(status.metadata?.workspaceId)
          ? status.metadata.workspaceId
          : previous?.workspaceId,
        taskType,
        status: status.status,
        concurrencyClass:
          previous?.concurrencyClass ??
          (taskType === TaskType.MODEL_DOWNLOAD ? "io" : "unknown"),
        progress: mapProgress(status.progress, taskType),
        data,
        error:
          taskType === TaskType.MODEL_DOWNLOAD && status.error
            ? {
                code:
                  sanitizePublicText(status.error.code, 80) ??
                  "model_download_failed",
                message:
                  sanitizePublicText(status.error.message) ??
                  "Model download failed.",
                retryable: status.error.retryable === true,
              }
            : status.error,
        metadata: status.metadata,
        queuedAt: previous?.queuedAt,
        startedAt: status.startedAt,
        updatedAt: status.updatedAt,
        completedAt: status.completedAt,
      });
    },
    async cancelTask(requestId: string): Promise<CancelRuntimeTaskResult> {
      const result = await runtimePort.cancelTask(requestId);
      const previous = trackedTasks.get(requestId);
      if (previous) {
        rememberTask({
          ...previous,
          status: toRuntimeTaskStatus(result.status),
          updatedAt: new Date().toISOString(),
          ...(result.status === "cancelled"
            ? { completedAt: new Date().toISOString() }
            : {}),
        });
      }
      return {
        requestId: result.requestId,
        cancelled: result.cancelled,
        status: toRuntimeTaskStatus(result.status),
        message: result.message,
      };
    },
    async listTasks(
      request: RuntimeTaskListRequest,
    ): Promise<RuntimeTaskListResult> {
      if (!isWorkspaceId(request.workspaceId))
        return {
          tasks: [],
          warnings: [
            {
              code: "python_runtime_task_workspace_required",
              message:
                "Workspace id is required to list python runtime task outputs.",
            },
          ],
        };
      const supported = new Set([
        TaskType.DATASET_PREPARATION,
        TaskType.DATASET_REVIEW,
        TaskType.CONTEXT_GENERATION,
        TaskType.CONTEXT_RETRIEVAL,
        TaskType.MODEL_DOWNLOAD,
        TaskType.MODEL_TRAINING,
        TaskType.MODEL_VALIDATION,
      ]);
      const requestedTypes = request.taskTypes ?? [...supported];
      const unsupportedTaskTypes = requestedTypes.filter(
        (taskType) => !supported.has(taskType),
      );
      const refreshes = [...trackedTasks.values()]
        .filter(
          (task) =>
            task.workspaceId === request.workspaceId &&
            requestedTypes.includes(task.taskType) &&
            (task.status === "queued" ||
              task.status === "running" ||
              task.status === "unknown"),
        )
        .map((task) =>
          adapter.getTaskStatus(task.requestId).catch(() => undefined),
        );
      await Promise.all(refreshes);
      const tasks = [...trackedTasks.values()]
        .filter((task) => task.workspaceId === request.workspaceId)
        .filter((task) => requestedTypes.includes(task.taskType))
        .filter(
          (task) => !request.statuses || request.statuses.includes(task.status),
        )
        .filter(
          (task) =>
            request.includeCompleted === true ||
            task.status === "queued" ||
            task.status === "running" ||
            task.status === "unknown",
        )
        .reverse()
        .slice(0, Math.min(Math.max(request.limit ?? 50, 1), 100));
      return {
        tasks,
        ...(unsupportedTaskTypes.length > 0
          ? {
              unsupportedTaskTypes,
              warnings: [
                {
                  code: "python_runtime_task_listing_unsupported",
                  message:
                    "Some requested task families are not provided by the Python runtime task registry.",
                  taskTypes: unsupportedTaskTypes,
                },
              ],
            }
          : {}),
      };
    },
    async readCompletedModelDownload(
      requestId: string,
    ): Promise<CompletedModelDownload | undefined> {
      const existing = completedDownloads.get(requestId);
      if (existing) return existing;
      const record = await adapter.getTaskStatus(requestId);
      if (
        "recordType" in record ||
        record.taskType !== TaskType.MODEL_DOWNLOAD ||
        record.status !== "succeeded"
      )
        return undefined;
      return completedDownloads.get(requestId);
    },
  };
  return adapter;
}
