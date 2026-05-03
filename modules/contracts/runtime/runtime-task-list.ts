import type { RuntimeTaskRecord } from "./runtime-task-record";
import type { RuntimeTaskStatus } from "./runtime-task-status";
import type { TaskType } from "./task-type";

export interface RuntimeTaskListRequest {
  statuses?: RuntimeTaskStatus[];
  taskTypes?: TaskType[];
  includeCompleted?: boolean;
  limit?: number;
}

export interface RuntimeTaskListResult {
  tasks: RuntimeTaskRecord[];
}
