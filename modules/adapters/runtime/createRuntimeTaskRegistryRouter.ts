import type { RuntimeTaskRegistryPort } from "../../application/ports/runtime";
import { TaskType, type CancelRuntimeTaskResult, type RuntimeTaskListRequest, type RuntimeTaskListResult, type RuntimeTaskRecord, type StartRuntimeTaskRequest, type StartRuntimeTaskResult } from "../../contracts/runtime";

export function createRuntimeTaskRegistryRouter(delegates: { image: RuntimeTaskRegistryPort; python: RuntimeTaskRegistryPort }): RuntimeTaskRegistryPort {
  if (!delegates?.image || !delegates?.python) throw new Error("createRuntimeTaskRegistryRouter requires both image and python delegates.");

  const taskTypeDelegates: Record<TaskType, RuntimeTaskRegistryPort> = {
    [TaskType.IMAGE_GENERATION]: delegates.image,
    [TaskType.DATASET_PREPARATION]: delegates.python,
    [TaskType.MODEL_TRAINING]: delegates.python,
    [TaskType.MODEL_VALIDATION]: delegates.python,
    [TaskType.MODEL_PUBLISHING]: delegates.python,
  };

  const requestToTaskType = new Map<string, TaskType>();
  const unknown = (requestId: string): RuntimeTaskRecord => ({ requestId, taskType: "unknown" as unknown as TaskType, status: "unknown", concurrencyClass: "unknown" });

  const imageTaskTypes = new Set<TaskType>([TaskType.IMAGE_GENERATION]);
  const pythonTaskTypes = new Set<TaskType>([
    TaskType.DATASET_PREPARATION,
    TaskType.MODEL_TRAINING,
    TaskType.MODEL_VALIDATION,
    TaskType.MODEL_PUBLISHING,
  ]);

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

  return {
    async startTask(request: StartRuntimeTaskRequest): Promise<StartRuntimeTaskResult> {
      const delegate = taskTypeDelegates[request.taskType];
      const result = await delegate.startTask(request);
      requestToTaskType.set(result.requestId, request.taskType);
      return result;
    },
    async getTaskStatus(requestId: string): Promise<RuntimeTaskRecord> {
      const taskType = requestToTaskType.get(requestId);
      if (!taskType) return unknown(requestId);
      return taskTypeDelegates[taskType].getTaskStatus(requestId);
    },
    async cancelTask(requestId: string): Promise<CancelRuntimeTaskResult> {
      const taskType = requestToTaskType.get(requestId);
      return taskType ? taskTypeDelegates[taskType].cancelTask(requestId) : { requestId, cancelled: false, status: "unknown" };
    },
    async listTasks(request: RuntimeTaskListRequest): Promise<RuntimeTaskListResult> {
      const imageRequest = filterListRequest(request, imageTaskTypes);
      const pythonRequest = filterListRequest(request, pythonTaskTypes);

      const [image, python] = await Promise.all([
        imageRequest ? delegates.image.listTasks(imageRequest) : Promise.resolve({ tasks: [] }),
        pythonRequest ? delegates.python.listTasks(pythonRequest) : Promise.resolve({ tasks: [] }),
      ]);

      return { tasks: [...image.tasks, ...python.tasks] };
    },
  };
}
