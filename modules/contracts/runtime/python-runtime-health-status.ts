export type PythonRuntimeStatus = "starting" | "ready" | "degraded" | "stopped" | "failed";

export interface PythonRuntimeHealthStatus {
  runtimeId: string;
  status: PythonRuntimeStatus;
  version?: string;
  pythonVersion?: string;
  workerStartedAt?: string;
  lastHeartbeatAt?: string;
}
