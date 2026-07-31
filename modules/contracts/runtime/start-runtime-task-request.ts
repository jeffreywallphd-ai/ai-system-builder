import type { WorkspaceId } from "../workspace";
import type { RuntimeTaskConcurrencyClass } from "./runtime-task-concurrency-class";
import type { TaskType } from "./task-type";

export interface StartRuntimeTaskRequest {
  /**
   * Optional caller-provided request id used for correlation and idempotency.
   * Implementations may generate a request id when omitted.
   */
  requestId?: string;
  workspaceId?: WorkspaceId;
  taskType: TaskType;
  concurrencyClass?: RuntimeTaskConcurrencyClass;
  payload: unknown;
  metadata?: Record<string, unknown>;
}
