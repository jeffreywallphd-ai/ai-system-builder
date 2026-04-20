export interface PythonRuntimeError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}
