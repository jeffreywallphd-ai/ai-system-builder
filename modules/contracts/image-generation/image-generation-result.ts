import type { RuntimeTaskStatus } from "../runtime/runtime-task-status";

export interface ImageGenerationArtifactOutput {
  artifactId: string;
}

export interface ImageGenerationResult {
  requestId: string;
  status: RuntimeTaskStatus;
  outputs?: ImageGenerationArtifactOutput[];
  warnings?: string[];
  errors?: string[];
}
