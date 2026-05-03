import type { PythonRuntimeError } from "./python-runtime-error";
import type { PythonRuntimeTaskStatus } from "./python-runtime-task-status";

export interface PythonRuntimeTaskStatusResult {
  requestId: string;
  taskType?: string;
  status: PythonRuntimeTaskStatus;
  progress?: Record<string, unknown>;
  data?: unknown;
  error?: PythonRuntimeError;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}
