import type { WorkspaceId } from "../workspace";
export type PythonRuntimeOutputRole =
  "dataset" | "train" | "test" | "metrics" | "report" | "artifact";

export interface PythonRuntimeOutputDescriptor {
  workspaceId?: WorkspaceId;
  name: string;
  role?: PythonRuntimeOutputRole;
  outputHandle: string;
  mediaType: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}
