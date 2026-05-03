/**
 * Generic runtime task error payload for shared Runtime Task Registry records.
 */
export interface RuntimeTaskError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
  stage?: string;
}
