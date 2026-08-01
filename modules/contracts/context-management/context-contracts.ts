import type { WorkspaceId } from "../workspace";
import type { ContextArtifactMediaType } from "./context-media-types";

export const CONTEXT_ARTIFACT_KINDS = [
  "rag-database",
  "markdown-context-pack",
] as const;

export type ContextArtifactKind = (typeof CONTEXT_ARTIFACT_KINDS)[number];

export type ContextGenerationMethod = "none" | "local-model";

export interface ContextArtifactSourceReference {
  readonly artifactId: string;
}

export interface ContextSourceInformation {
  readonly author?: string;
  readonly license?: string;
  readonly consent?: string;
  readonly sourceUrl?: string;
  readonly language?: string;
}

export interface ContextSourceCheckSettings {
  readonly preset: "recommended" | "strict";
  readonly allowedLanguages: readonly string[];
  readonly requireLicenseMetadata: boolean;
  readonly requireConsentMetadata: boolean;
  readonly includeSourceAttribution: boolean;
}

export interface ContextSourceCheckIssueCounts {
  readonly exactDuplicate: number;
  readonly fuzzyDuplicate: number;
  readonly textTooShort: number;
  readonly textTooLong: number;
  readonly languageNotAllowed: number;
  readonly languageUncertain: number;
  readonly sensitivePersonalData: number;
  readonly secretLikeContent: number;
  readonly licenseMetadataMissing: number;
  readonly consentMetadataMissing: number;
}

export interface ContextSourceCheckResult {
  readonly status: "ready" | "blocked";
  readonly checkedChunkCount: number;
  readonly issueCounts: ContextSourceCheckIssueCounts;
  readonly checkedSurfaces: readonly string[];
  readonly limitations: readonly string[];
}

export interface ContextManualEntry {
  readonly id: string;
  readonly title: string;
  readonly content: string;
}

export interface ContextChunkCitation {
  readonly sourceArtifactId: string;
  readonly sourceDigest: string;
  readonly chunkIndex: number;
  readonly rowIndex?: number;
  readonly field?: string;
  readonly normalizedStart?: number;
  readonly normalizedEnd?: number;
  readonly pageNumber?: number;
  readonly regionKind?: string;
}

export interface ContextPersistedChunkRecord {
  readonly id: string;
  readonly text: string;
  readonly citation: ContextChunkCitation;
}

export interface ContextChunkingSettings {
  readonly strategy:
    "fixed-length" | "topic-aware" | "sentence" | "section" | "structure-aware";
  readonly chunkCharacters: number;
  readonly overlapCharacters: number;
  readonly maximumTokensPerChunk?: number;
  readonly topicBoundarySensitivity?: number;
  readonly textFields?: readonly string[];
  readonly maximumChunks?: number;
}

export interface ContextEmbeddingSettings {
  readonly provider: "transformers";
  readonly modelId: string;
  readonly dimensions?: number;
  readonly batchSize?: number;
}

export interface ContextLocalModelSettings {
  readonly provider: "transformers";
  readonly modelId: string;
  readonly inferenceMode?: "auto" | "causal" | "chat";
  readonly device?: "auto" | "cpu" | "cuda";
  readonly torchDtype?: "auto" | "float16" | "bfloat16" | "float32";
  readonly maximumOutputTokens?: number;
}

export interface ContextPackSettings {
  readonly inputMode: "manual" | "source-materials";
  readonly method: ContextGenerationMethod;
  readonly cleaningPreset?: "standard" | "strict";
  readonly maximumSummaryLines?: number;
  readonly model?: ContextLocalModelSettings;
}

export interface StartContextGenerationCommand {
  readonly kind: ContextArtifactKind;
  readonly name: string;
  readonly sources: readonly ContextArtifactSourceReference[];
  readonly manualEntries?: readonly ContextManualEntry[];
  readonly chunking: ContextChunkingSettings;
  readonly sourceChecks?: ContextSourceCheckSettings;
  readonly embedding?: ContextEmbeddingSettings;
  readonly contextPack?: ContextPackSettings;
}

export interface ContextSourceInspection {
  readonly artifactId: string;
  readonly digest: string;
  readonly mediaType: string;
  readonly originalName?: string;
  readonly sizeBytes: number;
  readonly ready: boolean;
  readonly sourceKind?: "structured" | "document";
  readonly format?: string;
  readonly textFields?: readonly string[];
  readonly alreadyChunked: boolean;
  readonly chunkCount?: number;
  readonly sourceInformation?: ContextSourceInformation;
  readonly checks?: ContextSourceCheckResult;
  readonly reasonCode?: string;
  readonly message?: string;
  readonly action?: string;
}

export interface ContextManifestSource {
  readonly artifactId: string;
  readonly digest: string;
  readonly mediaType: string;
  readonly originalName?: string;
  readonly sizeBytes: number;
  readonly chunkCount: number;
  readonly chunkingMode: "persisted" | "extracted";
  readonly sourceInformation?: ContextSourceInformation;
}

export interface ContextManifestManualEntry {
  readonly id: string;
  readonly title: string;
  readonly digest: string;
}

export interface ContextArtifactManifest {
  readonly schemaVersion: "1";
  readonly kind: ContextArtifactKind;
  readonly name: string;
  readonly mediaType: ContextArtifactMediaType;
  readonly createdAt: string;
  readonly sources: readonly ContextManifestSource[];
  readonly manualEntries: readonly ContextManifestManualEntry[];
  readonly chunking: ContextChunkingSettings;
  readonly sourceChecks?: ContextSourceCheckSettings;
  readonly embedding?: Omit<ContextEmbeddingSettings, "batchSize">;
  readonly contextPack?: {
    readonly inputMode?: "manual" | "source-materials";
    readonly method: ContextGenerationMethod | "deterministic";
    readonly cleaningPreset?: "standard" | "strict";
    readonly maximumSummaryLines?: number;
    /** Legacy schema-v1 fields retained for existing saved packs. */
    readonly topicCount?: number;
    readonly maximumSummaryCharacters?: number;
    readonly modelId?: string;
  };
}

export interface ContextPreviewCitation {
  readonly sourceArtifactId?: string;
  readonly manualEntryId?: string;
  readonly chunkIndex?: number;
  readonly rowIndex?: number;
  readonly field?: string;
  readonly pageNumber?: number;
}

export interface ContextPreviewItem {
  readonly id: string;
  readonly kind: "chunk" | "topic" | "summary" | "manual";
  readonly title?: string;
  readonly text: string;
  readonly citations: readonly ContextPreviewCitation[];
}

export interface ContextGenerationPreview {
  readonly kind: ContextArtifactKind;
  readonly name: string;
  readonly sourceCount: number;
  readonly manualEntryCount: number;
  readonly chunkCount: number;
  readonly items: readonly ContextPreviewItem[];
}

export interface ContextSavedArtifactReference {
  readonly artifactId: string;
  readonly storageKey: string;
  readonly kind: ContextArtifactKind;
  readonly name: string;
  readonly mediaType: ContextArtifactMediaType;
  readonly sizeBytes: number;
  readonly digest: string;
}

export interface ContextLaunchIntent {
  readonly workspaceId: WorkspaceId;
  readonly artifactId: string;
  readonly targetTab: "rag-databases";
}

export type ContextGenerationState =
  | "queued"
  | "running"
  | "review-required"
  | "saved"
  | "discarded"
  | "cancelled"
  | "failed";

export interface ContextGenerationStatus {
  readonly requestId: string;
  readonly state: ContextGenerationState;
  readonly progress?: {
    readonly message?: string;
    readonly current?: number;
    readonly total?: number;
    readonly unit?: "chunk";
    readonly percent?: number;
  };
  readonly sourceInspections?: readonly ContextSourceInspection[];
  readonly preview?: ContextGenerationPreview;
  readonly manifest?: ContextArtifactManifest;
  readonly savedArtifact?: ContextSavedArtifactReference;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}
