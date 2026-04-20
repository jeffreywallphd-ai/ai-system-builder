import type { PythonRuntimeError } from "./python-runtime-error";
import type { PythonRuntimeHealthStatus } from "./python-runtime-health-status";

export interface PythonRuntimeHealthCheckResult {
  healthy: boolean;
  status: PythonRuntimeHealthStatus;
  error?: PythonRuntimeError;
  message?: string;
}
