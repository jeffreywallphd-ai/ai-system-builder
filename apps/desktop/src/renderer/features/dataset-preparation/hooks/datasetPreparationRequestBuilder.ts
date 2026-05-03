import type {
  ModelDefaultInferenceMode,
  ResolvedModelDefault,
} from "../../../../../../../modules/contracts/settings";
import type { ParsedDatasetPreparationInputs } from "./datasetPreparationRequestValidation";

const DEFAULT_DATASET_PREPARATION_RECIPE_BASE = {
  normalization: { targetFormat: "markdown" as const },
  chunking: { strategy: "character" as const },
  generation: {
    mode: "qa" as const,
    model: { provider: "transformers" as const },
  },
};

const VALID_MODEL_INFERENCE_MODES: readonly ModelDefaultInferenceMode[] = ["auto", "text2text", "causal", "chat"];

export interface BuildDatasetPreparationRequestInput {
  selectedArtifactIds: string[];
  unsupportedDocumentPolicy: "" | "fail" | "skip";
  normalizationMode: "" | "best-effort" | "strict";
  preserveDocumentBoundaries: boolean;
  modelId: string;
  modelInferenceMode: ModelDefaultInferenceMode;
  modelDevice: "" | "auto" | "cpu" | "cuda";
  modelTorchDtype: "" | "auto" | "float16" | "bfloat16" | "float32";
  failurePolicy: "" | "fail" | "skip";
  shuffle: boolean;
  outputFormat: "jsonl" | "json" | "csv" | "parquet";
  outputBaseName: string;
  localDestinationEnabled: boolean;
  huggingFaceDestinationEnabled: boolean;
  huggingFaceRepository: string;
  huggingFaceRevision: string;
  huggingFacePathPrefix: string;
  defaultHuggingFaceNamespace?: string;
  parsed: ParsedDatasetPreparationInputs;
  resolvedDefault: ResolvedModelDefault;
}

function resolveHuggingFaceRepository(repository: string, defaultNamespace?: string): string {
  const normalized = repository.trim().replace(/^datasets\//i, "").replaceAll("\\", "/");
  if (normalized.length === 0) {
    return normalized;
  }

  if (normalized.includes("/")) {
    return normalized;
  }

  const namespace = defaultNamespace?.trim();
  return namespace ? `${namespace}/${normalized}` : normalized;
}

export function buildDatasetPreparationRequest(input: BuildDatasetPreparationRequestInput) {
  const effectiveModelId = input.modelId.trim() || input.resolvedDefault.modelId;
  const effectiveInferenceMode = VALID_MODEL_INFERENCE_MODES.includes(input.modelInferenceMode)
    ? input.modelInferenceMode
    : input.resolvedDefault.inferenceMode;
  const effectiveDevice = input.modelDevice || input.resolvedDefault.device;
  const effectiveTorchDtype = input.modelTorchDtype || input.resolvedDefault.torchDtype;

  return {
    sourceArtifactIds: input.selectedArtifactIds,
    recipe: {
      ...DEFAULT_DATASET_PREPARATION_RECIPE_BASE,
      normalization: {
        ...DEFAULT_DATASET_PREPARATION_RECIPE_BASE.normalization,
        unsupportedDocumentPolicy: input.unsupportedDocumentPolicy || undefined,
        normalizationMode: input.normalizationMode || undefined,
      },
      chunking: {
        ...DEFAULT_DATASET_PREPARATION_RECIPE_BASE.chunking,
        chunkSize: input.parsed.chunkSize,
        chunkOverlap: input.parsed.chunkOverlap,
        preserveDocumentBoundaries: input.preserveDocumentBoundaries,
        maxChunkCount: input.parsed.maxChunkCount,
      },
      generation: {
        ...DEFAULT_DATASET_PREPARATION_RECIPE_BASE.generation,
        model: {
          ...DEFAULT_DATASET_PREPARATION_RECIPE_BASE.generation.model,
          modelId: effectiveModelId,
          inferenceMode: effectiveInferenceMode,
          device: effectiveDevice || undefined,
          torchDtype: effectiveTorchDtype || undefined,
        },
        maxExamplesPerChunk: input.parsed.maxExamplesPerChunk,
        batchSize: input.parsed.batchSize,
        failurePolicy: input.failurePolicy || undefined,
        generationParams: {
          temperature: input.parsed.generationTemperature,
          topP: input.parsed.generationTopP,
          maxNewTokens: input.parsed.generationMaxNewTokens,
        },
      },
    },
    split: {
      trainRatio: input.parsed.trainRatio,
      testRatio: input.parsed.testRatio,
      seed: input.parsed.seed,
      shuffle: input.shuffle,
    },
    output: {
      format: input.outputFormat,
      naming: {
        baseName: input.outputBaseName.trim() || undefined,
      },
      destinations: {
        local: {
          enabled: input.localDestinationEnabled,
        },
        huggingFace: input.huggingFaceDestinationEnabled
          ? {
            enabled: true,
            provider: "huggingface" as const,
            repository: resolveHuggingFaceRepository(
              input.huggingFaceRepository,
              input.defaultHuggingFaceNamespace,
            ),
            revision: input.huggingFaceRevision.trim() || undefined,
            pathPrefix: input.huggingFacePathPrefix.trim() || undefined,
          }
          : undefined,
      },
    },
  };
}
