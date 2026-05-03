import type {
  CancelRuntimeTaskResult,
  RuntimeTaskListRequest,
  RuntimeTaskListResult,
  RuntimeTaskRecord,
  StartRuntimeTaskRequest,
  StartRuntimeTaskResult,
} from "../../../contracts/runtime";

export interface RuntimeTaskRegistryPort {
  startTask(request: StartRuntimeTaskRequest): Promise<StartRuntimeTaskResult>;
  getTaskStatus(requestId: string): Promise<RuntimeTaskRecord>;
  cancelTask(requestId: string): Promise<CancelRuntimeTaskResult>;
  listTasks(request: RuntimeTaskListRequest): Promise<RuntimeTaskListResult>;
}
