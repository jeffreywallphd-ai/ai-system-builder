import type { RuntimeTaskStatus } from "./runtime-task-status";

export interface CancelRuntimeTaskResult {
  requestId: string;
  status: RuntimeTaskStatus;
  cancelled: boolean;
  message?: string;
}
