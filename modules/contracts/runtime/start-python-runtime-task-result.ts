export interface StartPythonRuntimeTaskResult {
  requestId: string;
  taskType: string;
  accepted: true;
  status: "queued" | "running";
  startedAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}
