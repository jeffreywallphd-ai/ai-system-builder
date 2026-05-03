export interface StartPythonRuntimeTaskRequest {
  requestId: string;
  taskType: string;
  payload: unknown;
  metadata?: Record<string, unknown>;
  timeoutMs?: number;
}
