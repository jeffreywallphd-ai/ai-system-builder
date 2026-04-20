export interface PythonRuntimeTaskRequest {
  requestId: string;
  taskType: string;
  payload: unknown;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}
