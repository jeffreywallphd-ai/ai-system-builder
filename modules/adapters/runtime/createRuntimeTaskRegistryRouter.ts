import type { RuntimeTaskRegistryPort } from "../../application/ports/runtime";
import { isWorkspaceId } from "../../contracts/workspace";
import { TaskType, type CancelRuntimeTaskResult, type RuntimeTaskListRequest, type RuntimeTaskListResult, type RuntimeTaskRecord, type RuntimeTaskStatusRecord, type StartRuntimeTaskRequest, type StartRuntimeTaskResult } from "../../contracts/runtime";

export function createRuntimeTaskRegistryRouter(delegates: { image: RuntimeTaskRegistryPort; python: RuntimeTaskRegistryPort }): RuntimeTaskRegistryPort {
  if (!delegates?.image || !delegates?.python) throw new Error("createRuntimeTaskRegistryRouter requires both image and python delegates.");

  const taskTypeDelegates: Record<TaskType, RuntimeTaskRegistryPort> = {
    [TaskType.IMAGE_GENERATION]: delegates.image,
    [TaskType.DATASET_PREPARATION]: delegates.python,
    [TaskType.MODEL_DOWNLOAD]: delegates.python,
    [TaskType.MODEL_TRAINING]: delegates.python,
    [TaskType.MODEL_VALIDATION]: delegates.python,
    [TaskType.MODEL_PUBLISHING]: delegates.python,
  };

  const requestToTaskType = new Map<string, TaskType>();
  const unknown = (requestId: string, reason: string): RuntimeTaskStatusRecord => ({
    recordType: "not-found",
    requestId,
    status: "unknown",
    concurrencyClass: "unknown",
    error: {
      code: "runtime_task_not_found",
      message: "Runtime task was not found in any task registry delegate.",
      details: { reason },
      retryable: false,
    },
    metadata: { reason },
  });

  const unknownCancel = (requestId: string): CancelRuntimeTaskResult => ({
    requestId,
    cancelled: false,
    status: "unknown",
    message: "Runtime task was not found in any task registry delegate.",
  });

  const imageTaskTypes = new Set<TaskType>([TaskType.IMAGE_GENERATION]);
  const pythonTaskTypes = new Set<TaskType>([
    TaskType.DATASET_PREPARATION,
    TaskType.MODEL_DOWNLOAD,
    TaskType.MODEL_TRAINING,
    TaskType.MODEL_VALIDATION,
    TaskType.MODEL_PUBLISHING,
  ]);

  const delegateEntries = [
    { name: "image", registry: delegates.image, taskTypes: imageTaskTypes },
    { name: "python", registry: delegates.python, taskTypes: pythonTaskTypes },
  ];

  const filterListRequest = (request: RuntimeTaskListRequest, supportedTaskTypes: Set<TaskType>): RuntimeTaskListRequest | undefined => {
    if (!request.taskTypes || request.taskTypes.length === 0) {
      return request;
    }

    const taskTypes = request.taskTypes.filter((taskType) => supportedTaskTypes.has(taskType));
    if (taskTypes.length === 0) {
      return undefined;
    }

    return { ...request, taskTypes };
  };

  const isExplicitNotFoundRecord = (record: RuntimeTaskStatusRecord): boolean => record.status === "unknown"
    && (record.error?.code === "runtime_task_not_found"
      || record.error?.code === "comfyui_task_not_found"
      || record.error?.code === "python_runtime_task_not_found");

  const isRuntimeTaskRecord = (record: RuntimeTaskStatusRecord): record is RuntimeTaskRecord => "taskType" in record;

  return {
    async startTask(request: StartRuntimeTaskRequest): Promise<StartRuntimeTaskResult> {
      if (!isWorkspaceId(request.workspaceId)) throw new Error("Workspace id is required for runtime task start.");
      const delegate = taskTypeDelegates[request.taskType];
      const result = await delegate.startTask(request);
      requestToTaskType.set(result.requestId, request.taskType);
      return result;
    },
    async getTaskStatus(requestId: string): Promise<RuntimeTaskStatusRecord> {
      const taskType = requestToTaskType.get(requestId);
      if (taskType) {
        return taskTypeDelegates[taskType].getTaskStatus(requestId);
      }

      const notFoundRecords: RuntimeTaskStatusRecord[] = [];
      for (const delegate of delegateEntries) {
        try {
          const record = await delegate.registry.getTaskStatus(requestId);
          if (!isExplicitNotFoundRecord(record) && isRuntimeTaskRecord(record)) {
            requestToTaskType.set(requestId, record.taskType);
            return record;
          }
          notFoundRecords.push(record);
        } catch {
          // Unknown-id recovery is best-effort; delegate-specific failures must not make a missing router correlation look like a created task.
        }
      }

      return notFoundRecords[0] ?? unknown(requestId, "missing-correlation-and-not-found");
    },
    async cancelTask(requestId: string): Promise<CancelRuntimeTaskResult> {
      const taskType = requestToTaskType.get(requestId);
      if (taskType) {
        return taskTypeDelegates[taskType].cancelTask(requestId);
      }

      for (const delegate of delegateEntries) {
        try {
          const result = await delegate.registry.cancelTask(requestId);
          if (result.status !== "unknown" || result.cancelled || result.message !== "Runtime task was not found in this task registry delegate.") {
            return result;
          }
        } catch {
          // Unknown-id recovery is best-effort and must remain a read/cancel operation only.
        }
      }

      return unknownCancel(requestId);
    },
    async listTasks(request: RuntimeTaskListRequest): Promise<RuntimeTaskListResult> {
      if (!isWorkspaceId(request.workspaceId)) return { tasks: [], warnings: [{ code: "runtime_task_workspace_required", message: "Workspace id is required to list workspace-owned runtime task outputs." }] };
      const delegateResults = await Promise.all(delegateEntries.map(async (delegate) => {
        const delegateRequest = filterListRequest(request, delegate.taskTypes);
        if (!delegateRequest) return { tasks: [] } satisfies RuntimeTaskListResult;
        try {
          return await delegate.registry.listTasks(delegateRequest);
        } catch {
          const taskTypes = delegateRequest.taskTypes ?? [...delegate.taskTypes];
          return {
            tasks: [],
            unsupportedTaskTypes: taskTypes,
            warnings: [{
              code: "runtime_task_list_delegate_failed",
              message: `Runtime task registry delegate '${delegate.name}' could not list tasks.`,
              taskTypes,
              details: { failureKind: "delegate-list-failed", delegate: delegate.name, requestedTaskTypes: taskTypes },
            }],
          } satisfies RuntimeTaskListResult;
        }
      }));

      const tasks = delegateResults.flatMap((result) => result.tasks).filter((task) => task.workspaceId === request.workspaceId);
      const warnings = delegateResults.flatMap((result) => result.warnings ?? []);
      const unsupportedTaskTypes = new Set(delegateResults.flatMap((result) => result.unsupportedTaskTypes ?? []));

      return {
        tasks,
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(unsupportedTaskTypes.size > 0 ? { unsupportedTaskTypes: [...unsupportedTaskTypes] } : {}),
      };
    },
  };
}
