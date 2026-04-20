export type PythonRuntimeOutputRole = "train" | "test" | "metrics" | "report" | "artifact";

export interface PythonRuntimeOutputDescriptor {
  name: string;
  role?: PythonRuntimeOutputRole;
  tempPath: string;
  mediaType: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}
