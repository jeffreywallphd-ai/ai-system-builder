import type { RuntimeTaskConcurrencyClass } from "./runtime-task-concurrency-class";
import type { RuntimeTaskError } from "./runtime-task-error";
import type { RuntimeTaskProgress } from "./runtime-task-progress";
import type { RuntimeTaskStatus } from "./runtime-task-status";
import type { TaskType } from "./task-type";

export interface RuntimeTaskRecord {
  requestId: string;
  taskType: TaskType;
  status: RuntimeTaskStatus;
  concurrencyClass: RuntimeTaskConcurrencyClass;
  progress?: RuntimeTaskProgress;
  data?: unknown;
  error?: RuntimeTaskError;
  metadata?: Record<string, unknown>;
  queuedAt?: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
}
