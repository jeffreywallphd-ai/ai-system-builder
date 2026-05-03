/**
 * Generic lifecycle status for runtime tasks tracked by the Runtime Task Registry.
 */
export type RuntimeTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";
