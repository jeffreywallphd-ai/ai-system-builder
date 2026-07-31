import type { DatasetPreparationSourceFormat } from "./dataset-preparation-capabilities";
import type { DatasetPreparationMethodId } from "./dataset-preparation-adaptive";

export const DATASET_PREPARATION_ADVANCED_PRESETS = [
  "standard",
  "better-document-understanding",
  "generate-examples",
  "topic-aware",
  "structure-aware",
] as const;

export type DatasetPreparationAdvancedPreset =
  (typeof DATASET_PREPARATION_ADVANCED_PRESETS)[number];

export const DATASET_PREPARATION_CONTENT_STRATEGIES = [
  "token",
  "sentence",
  "section",
  "table",
  "semantic",
  "layout",
] as const;

export type DatasetPreparationContentStrategy =
  (typeof DATASET_PREPARATION_CONTENT_STRATEGIES)[number];

export const DATASET_PREPARATION_ADVANCED_CAPABILITY_IDS = [
  "source-span-lineage",
  "table-structure",
  "layout-regions",
  "ocr-text",
  "semantic-embeddings",
  "deterministic-critic",
  "local-generation-model",
  "hard-negative-mining",
] as const;

export type DatasetPreparationAdvancedCapabilityId =
  (typeof DATASET_PREPARATION_ADVANCED_CAPABILITY_IDS)[number];

export interface DatasetPreparationAdvancedCapabilityReadiness {
  capabilityId: DatasetPreparationAdvancedCapabilityId;
  status: "ready" | "unavailable" | "model-required";
  provider: string;
  version: string;
  message: string;
  action?: string;
}

export interface DatasetPreparationAdvancedContentConfig {
  strategy: DatasetPreparationContentStrategy;
  maxTokensPerChunk?: number;
  maxSourceSpans?: number;
  semanticBoundaryThreshold?: number;
  layoutEnabled?: boolean;
  ocrEnabled?: boolean;
}

export interface DatasetPreparationSemanticCurationConfig {
  enabled: boolean;
  embeddingAlgorithm?: "hashed-token-v1";
  similarityThreshold?: number;
  maxComparisonsPerRow?: number;
  maxRowsPerSource?: number;
  balanceField?: string;
  hardNegativeMining?: boolean;
}

export interface DatasetPreparationSyntheticVerificationConfig {
  enabled: boolean;
  candidatesPerChunk?: number;
  minimumGroundingScore?: number;
  minimumCriticScore?: number;
  minimumDiversityScore?: number;
  requireReview?: boolean;
}

export interface DatasetPreparationAdvancedConfig {
  preset: DatasetPreparationAdvancedPreset;
  content?: DatasetPreparationAdvancedContentConfig;
  semantic?: DatasetPreparationSemanticCurationConfig;
  synthetic?: DatasetPreparationSyntheticVerificationConfig;
}

export interface DatasetPreparationSourceSpanLineage {
  sourceArtifactId: string;
  normalizedStart: number;
  normalizedEnd: number;
  regionKind: "text" | "heading" | "paragraph" | "table" | "page";
  pageNumber?: number;
}

export interface DatasetPreparationAdvancedReport {
  schemaVersion: "1";
  preset: DatasetPreparationAdvancedPreset;
  capabilities: DatasetPreparationAdvancedCapabilityReadiness[];
  content?: {
    strategy: DatasetPreparationContentStrategy;
    algorithmVersion: string;
    sourceSpanCount: number;
    lowConfidenceSourceCount: number;
    meanExtractionQuality: number;
  };
  semantic?: {
    embeddingAlgorithm: "hashed-token-v1";
    algorithmVersion: string;
    similarityThreshold: number;
    comparedPairCount: number;
    duplicateRowCount: number;
    coverageScore: number;
    sourceCapRejectedRowCount: number;
    balancingRecommendationCount: number;
    hardNegativeRecommendationCount: number;
    reviewExamples: {
      sourceArtifactId: string;
      sourceRowIndex: number;
      reason: "semantic-duplicate" | "hard-negative";
      matchedSourceArtifactId: string;
      matchedSourceRowIndex: number;
      similarity: number;
    }[];
  };
  synthetic?: {
    criticProvider: "deterministic-grounding-v1";
    generatedCandidateCount: number;
    admittedCandidateCount: number;
    quarantinedCandidateCount: number;
    meanGroundingScore: number;
    diversityScore: number;
    reasonCounts: Record<string, number>;
  };
}

const LOCAL_CAPABILITIES: readonly DatasetPreparationAdvancedCapabilityReadiness[] =
  [
    {
      capabilityId: "source-span-lineage",
      status: "ready",
      provider: "managed-python-worker",
      version: "normalized-span-v1",
      message: "Source spans and document regions will be recorded.",
    },
    {
      capabilityId: "table-structure",
      status: "ready",
      provider: "managed-python-worker",
      version: "markdown-table-v1",
      message: "Tables can be kept together during preparation.",
    },
    {
      capabilityId: "layout-regions",
      status: "ready",
      provider: "managed-python-worker",
      version: "extracted-layout-v1",
      message:
        "Extracted pages, headings, paragraphs, and tables can be kept as regions.",
    },
    {
      capabilityId: "ocr-text",
      status: "unavailable",
      provider: "none",
      version: "unavailable",
      message: "Text recognition for scanned images is not installed.",
      action: "Use a text-based PDF or add reviewed text before preparation.",
    },
    {
      capabilityId: "semantic-embeddings",
      status: "ready",
      provider: "managed-python-worker",
      version: "hashed-token-v1",
      message: "Reproducible local similarity checks are available.",
    },
    {
      capabilityId: "deterministic-critic",
      status: "ready",
      provider: "managed-python-worker",
      version: "deterministic-grounding-v1",
      message: "Generated examples can be checked independently before review.",
    },
    {
      capabilityId: "hard-negative-mining",
      status: "ready",
      provider: "managed-python-worker",
      version: "hashed-token-v1",
      message: "Reviewable hard-negative recommendations are available.",
    },
  ];

export function evaluateDatasetPreparationAdvancedReadiness(input: {
  preset: DatasetPreparationAdvancedPreset;
  sourceFormats?: readonly DatasetPreparationSourceFormat[];
  generationModelReady?: boolean;
}): DatasetPreparationAdvancedCapabilityReadiness[] {
  const readiness = LOCAL_CAPABILITIES.map((entry) => ({ ...entry }));
  if (input.preset === "generate-examples") {
    readiness.push({
      capabilityId: "local-generation-model",
      status: input.generationModelReady ? "ready" : "model-required",
      provider: "transformers",
      version: "configured-local-model",
      message: input.generationModelReady
        ? "The selected local model is ready."
        : "A local generation model must be downloaded before examples can be created.",
      action: input.generationModelReady
        ? undefined
        : "Download the selected model, then try again.",
    });
  }
  return readiness;
}

export function createDatasetPreparationAdvancedConfig(
  preset: DatasetPreparationAdvancedPreset,
): DatasetPreparationAdvancedConfig | undefined {
  if (preset === "standard") return undefined;
  const shared: DatasetPreparationAdvancedConfig = {
    preset,
    content: {
      strategy: preset === "generate-examples" ? "semantic" : "section",
      maxTokensPerChunk: 320,
      maxSourceSpans: 10_000,
      semanticBoundaryThreshold: 0.22,
      layoutEnabled: true,
      ocrEnabled: false,
    },
    semantic: {
      enabled: true,
      embeddingAlgorithm: "hashed-token-v1",
      similarityThreshold: 0.9,
      maxComparisonsPerRow: 128,
      hardNegativeMining: true,
    },
  };
  if (preset === "generate-examples") {
    shared.synthetic = {
      enabled: true,
      candidatesPerChunk: 2,
      minimumGroundingScore: 0.45,
      minimumCriticScore: 0.6,
      minimumDiversityScore: 0.2,
      requireReview: true,
    };
  }
  return shared;
}

export function createDatasetPreparationAdvancedConfigForMethod(
  method: DatasetPreparationMethodId,
): DatasetPreparationAdvancedConfig | undefined {
  if (
    method === "validate-and-split" ||
    method === "combine-and-split" ||
    method === "fixed-length" ||
    method === "use-source-metadata" ||
    method === "model-assisted-metadata" ||
    method === "use-existing-annotations"
  ) {
    return undefined;
  }

  const structureAware = method === "structure-aware";
  return {
    preset: structureAware ? "structure-aware" : "topic-aware",
    content: {
      strategy: structureAware ? "layout" : "semantic",
      maxTokensPerChunk: 320,
      maxSourceSpans: 10_000,
      ...(structureAware ? { layoutEnabled: true } : { semanticBoundaryThreshold: 0.22 }),
      ocrEnabled: false,
    },
    semantic: {
      enabled: true,
      embeddingAlgorithm: "hashed-token-v1",
      similarityThreshold: 0.9,
      maxComparisonsPerRow: 128,
      hardNegativeMining: true,
    },
    synthetic: {
      enabled: true,
      candidatesPerChunk: 2,
      minimumGroundingScore: 0.45,
      minimumCriticScore: 0.6,
      minimumDiversityScore: 0.2,
      requireReview: true,
    },
  };
}
