import type { PythonRuntimeTaskStatus } from "./python-runtime-task-status";

export interface CancelPythonRuntimeTaskResult {
  requestId: string;
  taskType?: string;
  status: PythonRuntimeTaskStatus;
  cancelled: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
}
