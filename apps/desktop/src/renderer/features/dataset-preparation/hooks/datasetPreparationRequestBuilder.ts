import type {
  ModelDefaultInferenceMode,
  ResolvedModelDefault,
} from "../../../../../../../modules/contracts/settings";
import {
  createDefaultDatasetPreparationTaskRecipe,
  createDefaultDatasetPreparationVisualOutputShape,
  createDatasetPreparationAdvancedConfig,
  createDatasetPreparationAdvancedConfigForMethod,
  resolveDefaultDatasetPreparationPromptTemplate,
  resolveDefaultDatasetPreparationTextGenerationModel,
  type DatasetPreparationTaskRecipe,
  type DatasetPreparationAdvancedPreset,
  type DatasetPreparationExecutionPlan,
  type DatasetPreparationTaskType,
  type DatasetPreparationTextInputMode,
  type DatasetPreparationVisualOutputShape,
} from "../../../../../../../modules/contracts/runtime";
import type { ParsedDatasetPreparationInputs } from "./datasetPreparationRequestValidation";

const DEFAULT_DATASET_PREPARATION_RECIPE_BASE = {
  normalization: { targetFormat: "markdown" as const },
  chunking: { strategy: "character" as const },
  generation: {
    mode: "qa" as const,
    model: { provider: "transformers" as const },
  },
};

const VALID_MODEL_INFERENCE_MODES: readonly ModelDefaultInferenceMode[] = [
  "auto",
  "text2text",
  "causal",
  "chat",
];

export interface BuildDatasetPreparationRequestInput {
  selectedArtifactIds: string[];
  preparation?: DatasetPreparationExecutionPlan;
  advancedPreset?: DatasetPreparationAdvancedPreset;
  taskType: DatasetPreparationTaskType;
  labelSet?: string;
  multiLabel?: boolean;
  extractionStrictSchema?: boolean;
  diffusionConceptKind?: "subject" | "style" | "concept";
  diffusionTriggerToken?: string;
  diffusionRegularizationClass?: string;
  detectionBoxFormat?: "coco" | "xyxy" | "xywh";
  segmentationMaskFormat?: "png" | "coco-rle" | "polygon";
  textInputMode?: DatasetPreparationTextInputMode;
  textGenerationPrompt?: string;
  visualOutputShape?: DatasetPreparationVisualOutputShape;
  constrainedDecoding?: boolean;
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

function splitLabelSet(value: string): string[] | undefined {
  const labels = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return labels.length > 0 ? labels : undefined;
}

function resolveInputTextInputMode(
  input: BuildDatasetPreparationRequestInput,
): DatasetPreparationTextInputMode {
  if (input.preparation) {
    return input.preparation.generationMode === "none"
      ? "provided"
      : "generate";
  }
  return (
    input.textInputMode ??
    createDefaultDatasetPreparationTaskRecipe(input.taskType).textInputMode ??
    "provided"
  );
}

function buildTaskRecipe(
  input: BuildDatasetPreparationRequestInput,
): DatasetPreparationTaskRecipe {
  const textInputMode = resolveInputTextInputMode(input);
  switch (input.taskType) {
    case "llm-instruction":
      return {
        ...(createDefaultDatasetPreparationTaskRecipe(
          "llm-instruction",
        ) as Extract<
          DatasetPreparationTaskRecipe,
          { taskType: "llm-instruction" }
        >),
        textInputMode,
      };
    case "llm-classification":
      return {
        ...(createDefaultDatasetPreparationTaskRecipe(
          "llm-classification",
        ) as Extract<
          DatasetPreparationTaskRecipe,
          { taskType: "llm-classification" }
        >),
        textInputMode,
        labelSet: splitLabelSet(input.labelSet ?? ""),
        multiLabel: input.multiLabel ?? false,
      };
    case "llm-extraction":
      return {
        ...(createDefaultDatasetPreparationTaskRecipe(
          "llm-extraction",
        ) as Extract<
          DatasetPreparationTaskRecipe,
          { taskType: "llm-extraction" }
        >),
        textInputMode,
        strictSchema: input.extractionStrictSchema ?? true,
      };
    case "llm-embedding":
      return {
        ...(createDefaultDatasetPreparationTaskRecipe(
          "llm-embedding",
        ) as Extract<
          DatasetPreparationTaskRecipe,
          { taskType: "llm-embedding" }
        >),
        textInputMode,
      };
    case "llm-reranker":
      return {
        ...(createDefaultDatasetPreparationTaskRecipe(
          "llm-reranker",
        ) as Extract<
          DatasetPreparationTaskRecipe,
          { taskType: "llm-reranker" }
        >),
        textInputMode,
      };
    case "diffusion-lora":
      return {
        ...(createDefaultDatasetPreparationTaskRecipe(
          "diffusion-lora",
        ) as Extract<
          DatasetPreparationTaskRecipe,
          { taskType: "diffusion-lora" }
        >),
        textInputMode,
        conceptKind: input.diffusionConceptKind ?? "subject",
        triggerToken: input.diffusionTriggerToken?.trim() || undefined,
        regularizationClass:
          input.diffusionRegularizationClass?.trim() || undefined,
      };
    case "vision-classification":
      return {
        ...(createDefaultDatasetPreparationTaskRecipe(
          "vision-classification",
        ) as Extract<
          DatasetPreparationTaskRecipe,
          { taskType: "vision-classification" }
        >),
        textInputMode,
        labelSet: splitLabelSet(input.labelSet ?? ""),
      };
    case "vision-detection":
      return {
        ...(createDefaultDatasetPreparationTaskRecipe(
          "vision-detection",
        ) as Extract<
          DatasetPreparationTaskRecipe,
          { taskType: "vision-detection" }
        >),
        textInputMode,
        labelSet: splitLabelSet(input.labelSet ?? ""),
        boxFormat: input.detectionBoxFormat ?? "coco",
      };
    case "vision-segmentation":
      return {
        ...(createDefaultDatasetPreparationTaskRecipe(
          "vision-segmentation",
        ) as Extract<
          DatasetPreparationTaskRecipe,
          { taskType: "vision-segmentation" }
        >),
        textInputMode,
        labelSet: splitLabelSet(input.labelSet ?? ""),
        maskFormat: input.segmentationMaskFormat ?? "png",
      };
    default:
      return createDefaultDatasetPreparationTaskRecipe(input.taskType);
  }
}

function resolveHuggingFaceRepository(
  repository: string,
  defaultNamespace?: string,
): string {
  const normalized = repository
    .trim()
    .replace(/^datasets\//i, "")
    .replaceAll("\\", "/");
  if (normalized.length === 0) {
    return normalized;
  }

  if (normalized.includes("/")) {
    return normalized;
  }

  const namespace = defaultNamespace?.trim();
  return namespace ? `${namespace}/${normalized}` : normalized;
}

export function buildDatasetPreparationRequest(
  input: BuildDatasetPreparationRequestInput,
) {
  const defaultAdvanced = input.preparation
    ? createDatasetPreparationAdvancedConfigForMethod(input.preparation.method)
    : createDatasetPreparationAdvancedConfig(
        input.advancedPreset ?? "standard",
      );
  const advanced = defaultAdvanced
    ? {
        ...defaultAdvanced,
        ...(defaultAdvanced.content
          ? {
              content: {
                ...defaultAdvanced.content,
                ...(input.parsed.maxTokensPerChunk
                  ? { maxTokensPerChunk: input.parsed.maxTokensPerChunk }
                  : {}),
                ...(input.parsed.maxSourceSpans
                  ? { maxSourceSpans: input.parsed.maxSourceSpans }
                  : {}),
                ...(input.parsed.topicBoundarySensitivity !== undefined
                  ? {
                      semanticBoundaryThreshold:
                        input.parsed.topicBoundarySensitivity,
                    }
                  : {}),
              },
            }
          : {}),
        ...(defaultAdvanced.semantic
          ? {
              semantic: {
                ...defaultAdvanced.semantic,
                ...(input.parsed.similarityThreshold !== undefined
                  ? { similarityThreshold: input.parsed.similarityThreshold }
                  : {}),
              },
            }
          : {}),
        ...(defaultAdvanced.synthetic
          ? {
              synthetic: {
                ...defaultAdvanced.synthetic,
                ...(input.preparation && input.parsed.maxExamplesPerChunk
                  ? { candidatesPerChunk: input.parsed.maxExamplesPerChunk }
                  : {}),
              },
            }
          : {}),
      }
    : undefined;
  const taskModelDefault = resolveDefaultDatasetPreparationTextGenerationModel(
    input.taskType,
  );
  const explicitModelId = input.modelId.trim();
  const effectiveModelId =
    explicitModelId ||
    taskModelDefault?.modelId ||
    input.resolvedDefault.modelId;
  const effectiveInferenceMode = explicitModelId
    ? VALID_MODEL_INFERENCE_MODES.includes(input.modelInferenceMode)
      ? input.modelInferenceMode
      : input.resolvedDefault.inferenceMode
    : (taskModelDefault?.inferenceMode ?? input.resolvedDefault.inferenceMode);
  const effectiveDevice = explicitModelId
    ? input.modelDevice || input.resolvedDefault.device
    : (taskModelDefault?.device ??
      (input.modelDevice || input.resolvedDefault.device));
  const effectiveTorchDtype = explicitModelId
    ? input.modelTorchDtype || input.resolvedDefault.torchDtype
    : (taskModelDefault?.torchDtype ??
      (input.modelTorchDtype || input.resolvedDefault.torchDtype));
  const textInputMode = resolveInputTextInputMode(input);
  const effectivePromptTemplate =
    textInputMode === "generate"
      ? input.textGenerationPrompt?.trim() ||
        resolveDefaultDatasetPreparationPromptTemplate(input.taskType)
      : undefined;
  const usesDocuments =
    !input.preparation ||
    ["fixed-length", "topic-aware", "structure-aware"].includes(
      input.preparation.method,
    );
  const usesFixedSections =
    !input.preparation || input.preparation.method === "fixed-length";
  const usesGeneration =
    !input.preparation || input.preparation.generationMode !== "none";

  return {
    sourceArtifactIds: input.selectedArtifactIds,
    ...(input.preparation ? { preparation: input.preparation } : {}),
    ...(advanced ? { advanced } : {}),
    recipe: {
      task: buildTaskRecipe(input),
      ...(usesDocuments
        ? {
            normalization: {
              ...DEFAULT_DATASET_PREPARATION_RECIPE_BASE.normalization,
              unsupportedDocumentPolicy:
                input.unsupportedDocumentPolicy || undefined,
              normalizationMode: input.normalizationMode || undefined,
            },
          }
        : {}),
      ...(usesFixedSections
        ? {
            chunking: {
              ...DEFAULT_DATASET_PREPARATION_RECIPE_BASE.chunking,
              chunkSize: input.parsed.chunkSize!,
              chunkOverlap: input.parsed.chunkOverlap!,
              preserveDocumentBoundaries: input.preserveDocumentBoundaries,
              maxChunkCount: input.parsed.maxChunkCount,
            },
          }
        : {}),
      ...(usesGeneration
        ? {
            generation: {
              ...DEFAULT_DATASET_PREPARATION_RECIPE_BASE.generation,
              promptTemplate: effectivePromptTemplate,
              model: {
                ...DEFAULT_DATASET_PREPARATION_RECIPE_BASE.generation.model,
                modelId: effectiveModelId,
                inferenceMode: effectiveInferenceMode,
                device: effectiveDevice || undefined,
                torchDtype: effectiveTorchDtype || undefined,
              },
              ...(!input.preparation && input.parsed.maxExamplesPerChunk
                ? {
                    maxExamplesPerChunk: input.parsed.maxExamplesPerChunk,
                  }
                : {}),
              batchSize: input.parsed.batchSize,
              failurePolicy: input.failurePolicy || undefined,
              generationParams: {
                temperature: input.parsed.generationTemperature,
                topP: input.parsed.generationTopP,
                maxNewTokens: input.parsed.generationMaxNewTokens,
              },
              structuredOutput: {
                constrainedDecoding: input.constrainedDecoding ?? false,
                visualShape:
                  input.visualOutputShape ??
                  createDefaultDatasetPreparationVisualOutputShape(
                    input.taskType,
                    { multiLabel: input.multiLabel },
                  ),
              },
            },
          }
        : {}),
    },
    split: {
      trainRatio: input.parsed.trainRatio,
      validationRatio: input.parsed.validationRatio ?? 0,
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
