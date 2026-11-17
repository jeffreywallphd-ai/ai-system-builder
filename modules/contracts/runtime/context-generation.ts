import type {
  ContextArtifactKind,
  ContextArtifactManifest,
  ContextChunkingSettings,
  ContextEmbeddingSettings,
  ContextGenerationPreview,
  ContextManualEntry,
  ContextPackSettings,
  ContextSourceCheckSettings,
  ContextSourceInformation,
  ContextSourceInspection,
} from "../context-management";

export interface ContextRuntimeSourceInput {
  readonly artifactId: string;
  readonly localPath: string;
  readonly mediaType: string;
  readonly originalName?: string;
  readonly sourceDigest: string;
  readonly sizeBytes: number;
  readonly sourceInformation?: ContextSourceInformation;
}

export interface ContextRuntimeManualInput extends ContextManualEntry {
  readonly digest: string;
}

export interface ContextGenerationTaskRequest {
  readonly workspaceId: string;
  readonly kind: ContextArtifactKind;
  readonly name: string;
  readonly sources: readonly ContextRuntimeSourceInput[];
  readonly manualEntries: readonly ContextRuntimeManualInput[];
  readonly chunking: ContextChunkingSettings;
  readonly sourceChecks?: ContextSourceCheckSettings;
  readonly embedding?: ContextEmbeddingSettings;
  readonly contextPack?: ContextPackSettings;
  readonly runtime: {
    readonly runtimeWorkingDirectory: string;
  };
}

export interface ContextGenerationRuntimeOutput {
  readonly name: string;
  readonly outputHandle: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly digest: string;
}

export interface ContextGenerationTaskResult {
  readonly output: ContextGenerationRuntimeOutput;
  readonly sourceInspections: readonly ContextSourceInspection[];
  readonly preview: ContextGenerationPreview;
  readonly manifest: ContextArtifactManifest;
}
