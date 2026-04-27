import type { PythonRuntimeError } from "./python-runtime-error";

export interface PythonRuntimeTaskResult {
  requestId: string;
  taskType: string;
  success: boolean;
  data?: unknown;
  error?: PythonRuntimeError;
  metadata?: Record<string, unknown>;
}
