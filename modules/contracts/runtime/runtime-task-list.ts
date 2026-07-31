import type { WorkspaceId } from "../workspace";
import type { RuntimeTaskRecord } from "./runtime-task-record";
import type { RuntimeTaskStatus } from "./runtime-task-status";
import type { TaskType } from "./task-type";

export interface RuntimeTaskListRequest {
  workspaceId?: WorkspaceId;
  statuses?: RuntimeTaskStatus[];
  taskTypes?: TaskType[];
  includeCompleted?: boolean;
  limit?: number;
}

export interface RuntimeTaskListWarning {
  code: string;
  message: string;
  taskTypes?: TaskType[];
  details?: Record<string, unknown>;
}

export interface RuntimeTaskListResult {
  tasks: RuntimeTaskRecord[];
  /**
   * Optional non-fatal listing limitations reported by delegated registries.
   * Callers can still use the returned task records when warnings are present.
   */
  warnings?: RuntimeTaskListWarning[];
  /**
   * Task families whose registry could not provide a task list for this read.
   */
  unsupportedTaskTypes?: TaskType[];
}
