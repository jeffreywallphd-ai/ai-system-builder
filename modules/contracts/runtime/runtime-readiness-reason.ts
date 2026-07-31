export type RuntimeReadinessReasonCategory =
  | "unavailable"
  | "installation"
  | "configuration"
  | "startup"
  | "health"
  | "dependency"
  | "unknown";

export interface RuntimeReadinessReason {
  code: string;
  message: string;
  category?: RuntimeReadinessReasonCategory;
  retryable?: boolean;
  details?: Record<string, unknown>;
}
