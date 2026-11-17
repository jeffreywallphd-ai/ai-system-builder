import type {
  ContextArtifactInspection,
  ContextChunkingSettings,
  ContextRetrievalMatch,
  ContextSourceInspection,
} from "../context-management";
import type { WorkspaceId } from "../workspace";

export interface ContextArtifactOperationRuntime {
  readonly runtimeWorkingDirectory: string;
}

export interface ContextArtifactOperationSource {
  readonly artifactId: string;
  readonly localPath: string;
  readonly mediaType: string;
  readonly originalName?: string;
  readonly sourceDigest: string;
  readonly sizeBytes: number;
}

interface ContextArtifactOperationTaskRequestBase {
  readonly workspaceId: WorkspaceId;
  readonly artifactId: string;
  readonly localPath: string;
  readonly mediaType: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly runtime: ContextArtifactOperationRuntime;
}

export type ContextArtifactOperationTaskRequest =
  | (ContextArtifactOperationTaskRequestBase & {
      readonly operation: "inspect-source";
      readonly originalName?: string;
      readonly chunking: ContextChunkingSettings;
    })
  | (ContextArtifactOperationTaskRequestBase & {
      readonly operation: "inspect-artifact";
    })
  | (ContextArtifactOperationTaskRequestBase & {
      readonly operation: "query";
      readonly query: string;
      readonly maximumResults: number;
    });

export type ContextArtifactOperationTaskResult =
  | {
      readonly operation: "inspect-source";
      readonly inspection: ContextSourceInspection;
    }
  | {
      readonly operation: "inspect-artifact";
      readonly inspection: ContextArtifactInspection;
    }
  | {
      readonly operation: "query";
      readonly matches: readonly ContextRetrievalMatch[];
    };
