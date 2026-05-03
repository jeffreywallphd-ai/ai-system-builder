import type { RuntimeTaskStatus } from "./runtime-task-status";

export interface StartRuntimeTaskResult {
  requestId: string;
  status?: Extract<RuntimeTaskStatus, "queued" | "running">;
  metadata?: Record<string, unknown>;
}
