export interface PythonRuntimeError {
  code: string;
  stage?: "normalization" | "chunking" | "generation" | "split";
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}
