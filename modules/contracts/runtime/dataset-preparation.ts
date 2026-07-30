import type { DatasetPreparationVisualOutputShape } from "./dataset-preparation-output-shape";

export interface DatasetPreparationSourceInput {
  artifactId: string;
  localPath: string;
  mediaType?: string;
  originalName?: string;
  metadata?: Record<string, unknown>;
}

export const DATASET_PREPARATION_MODEL_FAMILIES = [
  "llm",
  "diffusion",
  "vision",
] as const;
export type DatasetPreparationModelFamily =
  (typeof DATASET_PREPARATION_MODEL_FAMILIES)[number];

export const DATASET_PREPARATION_TASK_TYPES = [
  "llm-instruction",
  "llm-classification",
  "llm-extraction",
  "llm-embedding",
  "llm-reranker",
  "diffusion-lora",
  "vision-classification",
  "vision-detection",
  "vision-segmentation",
] as const;
export type DatasetPreparationTaskType =
  (typeof DATASET_PREPARATION_TASK_TYPES)[number];

export const DEFAULT_DATASET_PREPARATION_TASK_TYPE: DatasetPreparationTaskType =
  "llm-instruction";

export const DATASET_PREPARATION_TEXT_GENERATION_TASK_TYPES = [
  "llm-instruction",
  "llm-classification",
  "llm-extraction",
  "llm-embedding",
  "llm-reranker",
  "diffusion-lora",
  "vision-classification",
  "vision-detection",
  "vision-segmentation",
] as const satisfies readonly DatasetPreparationTaskType[];
export type DatasetPreparationTextGenerationTaskType =
  (typeof DATASET_PREPARATION_TEXT_GENERATION_TASK_TYPES)[number];

export type DatasetPreparationTextInputMode = "provided" | "generate";

export type DatasetPreparationTextGenerationModelPresetId =
  "quality-7b" | "compact-3b";

export interface DatasetPreparationTextGenerationModelPreset {
  id: DatasetPreparationTextGenerationModelPresetId;
  label: string;
  description: string;
  model: LocalModelConfig;
}

export interface DatasetPreparationTextGenerationParameterDefaults {
  maxExamplesPerChunk: number;
  batchSize: number;
  failurePolicy: "fail" | "skip";
  temperature: number;
  topP: number;
  maxNewTokens: number;
}

export const DATASET_PREPARATION_TEXT_GENERATION_MODEL_PRESETS: readonly DatasetPreparationTextGenerationModelPreset[] =
  [
    {
      id: "quality-7b",
      label: "Quality (7B)",
      description:
        "Best built-in quality option within the 7B parameter limit.",
      model: {
        provider: "transformers",
        modelId: "Qwen/Qwen2.5-7B-Instruct",
        inferenceMode: "chat",
        device: "auto",
        torchDtype: "auto",
      },
    },
    {
      id: "compact-3b",
      label: "Compact (3B)",
      description: "Smaller built-in option for lower memory use.",
      model: {
        provider: "transformers",
        modelId: "Qwen/Qwen2.5-3B-Instruct",
        inferenceMode: "chat",
        device: "auto",
        torchDtype: "auto",
      },
    },
  ];

const DATASET_PREPARATION_QUALITY_TEXT_GENERATION_MODEL =
  DATASET_PREPARATION_TEXT_GENERATION_MODEL_PRESETS[0].model;

export const DEFAULT_DATASET_PREPARATION_PROMPT_TEMPLATES: Record<
  DatasetPreparationTextGenerationTaskType,
  string
> = {
  "llm-instruction": [
    "Prepare one high-quality instruction-tuning candidate from the supplied source.",
    "Write a natural, specific user instruction; preserve an exact supporting source span as the input when context is needed; and provide a complete answer supported by that span.",
    "Prefer a focused task over a broad summary. If the source cannot support a faithful example, skip it.",
    "Follow the runtime-provided structured output schema exactly.",
  ].join("\n"),
  "llm-classification": [
    "Prepare one text-classification candidate from the supplied source.",
    "Use only configured labels and match their spelling exactly. For a single-label task choose exactly one; for a multi-label task include every supported label and no others. Without a label set, use short, reusable category names rather than sentences.",
    "Do not turn the task into question answering or add an explanation. Skip ambiguous sources instead of guessing.",
    "Follow the runtime-provided structured output schema exactly.",
  ].join("\n"),
  "llm-extraction": [
    "Prepare one information-extraction candidate from the supplied source.",
    "Return a compact expected-output object containing only facts explicitly present in the source. Preserve names, dates, identifiers, numbers, units, and nullability exactly; do not fill missing values or normalize away meaning.",
    "Use stable, descriptive field names and skip the source when no meaningful structured facts are present.",
    "Follow the runtime-provided structured output schema exactly.",
  ].join("\n"),
  "llm-embedding": [
    "Prepare one positive pair for embedding training from the supplied source.",
    "Write a natural search query that expresses a real information need, then copy the shortest exact source passage that fully satisfies it.",
    "Make the pair semantically meaningful without relying on shared boilerplate, filenames, or outside knowledge. Skip sources that do not support a clear positive pair.",
    "Follow the runtime-provided structured output schema exactly.",
  ].join("\n"),
  "llm-reranker": [
    "Prepare one relevant query-passage candidate for reranker training from the supplied source.",
    "Write a natural search query and copy an exact source passage that directly satisfies it. Relevance must come from the passage content, not filenames, position, or shared wording alone.",
    "Skip sources that do not support an unambiguous relevant passage. Negative passages are selected separately by the runtime.",
    "Follow the runtime-provided structured output schema exactly.",
  ].join("\n"),
  "diffusion-lora": [
    "Prepare one concise caption for image LoRA training using only the supplied filename, metadata, trigger token, and concept settings.",
    "The image pixels are not available. Include the trigger token exactly when provided, describe only supported attributes, and omit filenames, camera claims, identities, or visual details that the metadata does not establish.",
    "Follow the runtime-provided structured output schema exactly.",
  ].join("\n"),
  "vision-classification": [
    "Prepare one image-classification label using only the supplied filename and metadata; the image pixels are not available.",
    "Choose exactly one allowed label when provided and match its spelling exactly. Otherwise use one short, reusable category name.",
    "Skip ambiguous records instead of inferring unseen visual content. Follow the runtime-provided structured output schema exactly.",
  ].join("\n"),
  "vision-detection": [
    "Prepare object label text only for the supplied, reviewed bounding-box annotations.",
    "The image pixels are not available. Never create, move, resize, or infer boxes. Choose an allowed label exactly when provided, and skip annotations whose existing evidence does not support a label.",
    "Follow the runtime-provided structured output schema exactly.",
  ].join("\n"),
  "vision-segmentation": [
    "Prepare region label text only for the supplied, reviewed mask annotation.",
    "The image pixels are not available. Never create, alter, or infer masks. Choose an allowed label exactly when provided, and skip annotations whose existing evidence does not support a label.",
    "Follow the runtime-provided structured output schema exactly.",
  ].join("\n"),
};

export const DEFAULT_DATASET_PREPARATION_TEXT_GENERATION_MODELS: Record<
  DatasetPreparationTextGenerationTaskType,
  LocalModelConfig
> = {
  "llm-instruction": {
    ...DATASET_PREPARATION_QUALITY_TEXT_GENERATION_MODEL,
  },
  "llm-classification": {
    ...DATASET_PREPARATION_QUALITY_TEXT_GENERATION_MODEL,
  },
  "llm-extraction": {
    ...DATASET_PREPARATION_QUALITY_TEXT_GENERATION_MODEL,
  },
  "llm-embedding": {
    ...DATASET_PREPARATION_QUALITY_TEXT_GENERATION_MODEL,
  },
  "llm-reranker": {
    ...DATASET_PREPARATION_QUALITY_TEXT_GENERATION_MODEL,
  },
  "diffusion-lora": {
    ...DATASET_PREPARATION_QUALITY_TEXT_GENERATION_MODEL,
  },
  "vision-classification": {
    ...DATASET_PREPARATION_QUALITY_TEXT_GENERATION_MODEL,
  },
  "vision-detection": {
    ...DATASET_PREPARATION_QUALITY_TEXT_GENERATION_MODEL,
  },
  "vision-segmentation": {
    ...DATASET_PREPARATION_QUALITY_TEXT_GENERATION_MODEL,
  },
};

export const DEFAULT_DATASET_PREPARATION_TEXT_GENERATION_PARAMETER_DEFAULTS: Record<
  DatasetPreparationTextGenerationTaskType,
  DatasetPreparationTextGenerationParameterDefaults
> = {
  "llm-instruction": {
    maxExamplesPerChunk: 4,
    batchSize: 4,
    failurePolicy: "skip",
    temperature: 0.7,
    topP: 0.8,
    maxNewTokens: 512,
  },
  "llm-classification": {
    maxExamplesPerChunk: 3,
    batchSize: 4,
    failurePolicy: "skip",
    temperature: 0.2,
    topP: 0.8,
    maxNewTokens: 160,
  },
  "llm-extraction": {
    maxExamplesPerChunk: 2,
    batchSize: 4,
    failurePolicy: "skip",
    temperature: 0.2,
    topP: 0.8,
    maxNewTokens: 256,
  },
  "llm-embedding": {
    maxExamplesPerChunk: 3,
    batchSize: 4,
    failurePolicy: "skip",
    temperature: 0.3,
    topP: 0.8,
    maxNewTokens: 256,
  },
  "llm-reranker": {
    maxExamplesPerChunk: 3,
    batchSize: 4,
    failurePolicy: "skip",
    temperature: 0.3,
    topP: 0.8,
    maxNewTokens: 256,
  },
  "diffusion-lora": {
    maxExamplesPerChunk: 1,
    batchSize: 4,
    failurePolicy: "skip",
    temperature: 0.5,
    topP: 0.8,
    maxNewTokens: 96,
  },
  "vision-classification": {
    maxExamplesPerChunk: 1,
    batchSize: 4,
    failurePolicy: "skip",
    temperature: 0.2,
    topP: 0.8,
    maxNewTokens: 64,
  },
  "vision-detection": {
    maxExamplesPerChunk: 1,
    batchSize: 4,
    failurePolicy: "skip",
    temperature: 0.2,
    topP: 0.8,
    maxNewTokens: 96,
  },
  "vision-segmentation": {
    maxExamplesPerChunk: 1,
    batchSize: 4,
    failurePolicy: "skip",
    temperature: 0.2,
    topP: 0.8,
    maxNewTokens: 96,
  },
};

const DATASET_PREPARATION_TEXT_GENERATION_TASK_TYPE_SET = new Set<string>(
  DATASET_PREPARATION_TEXT_GENERATION_TASK_TYPES,
);

export function canDatasetPreparationTaskGenerateText(
  taskType: DatasetPreparationTaskType,
): taskType is DatasetPreparationTextGenerationTaskType {
  return DATASET_PREPARATION_TEXT_GENERATION_TASK_TYPE_SET.has(taskType);
}

export function resolveDefaultDatasetPreparationPromptTemplate(
  taskType: DatasetPreparationTaskType,
): string | undefined {
  return canDatasetPreparationTaskGenerateText(taskType)
    ? DEFAULT_DATASET_PREPARATION_PROMPT_TEMPLATES[taskType]
    : undefined;
}

export function resolveDefaultDatasetPreparationTextGenerationModel(
  taskType: DatasetPreparationTaskType,
): LocalModelConfig | undefined {
  return canDatasetPreparationTaskGenerateText(taskType)
    ? { ...DEFAULT_DATASET_PREPARATION_TEXT_GENERATION_MODELS[taskType] }
    : undefined;
}

export function resolveDefaultDatasetPreparationTextGenerationParameterDefaults(
  taskType: DatasetPreparationTaskType,
): DatasetPreparationTextGenerationParameterDefaults | undefined {
  return canDatasetPreparationTaskGenerateText(taskType)
    ? {
        ...DEFAULT_DATASET_PREPARATION_TEXT_GENERATION_PARAMETER_DEFAULTS[
          taskType
        ],
      }
    : undefined;
}

export type DatasetPreparationOutputSchema =
  | "instruction-response"
  | "classification"
  | "extraction"
  | "embedding-pairs"
  | "ranking-pairs"
  | "image-caption-manifest"
  | "image-classification-manifest"
  | "object-detection-manifest"
  | "segmentation-manifest";

export interface DatasetPreparationTaskProfileDefinition {
  taskType: DatasetPreparationTaskType;
  modelFamily: DatasetPreparationModelFamily;
  outputSchema: DatasetPreparationOutputSchema;
  supportedOutputFormats: readonly DatasetOutputConfig["format"][];
  preferredOutputFormat: DatasetOutputConfig["format"];
  requiredFields: readonly string[];
  optionalFields: readonly string[];
  runtimeSupport: "supported" | "contract-only";
  compatibleTrainingMethods: readonly ("lora" | "qlora" | "full-finetune")[];
}

export interface LlmInstructionDatasetPreparationTask {
  taskType: "llm-instruction";
  textInputMode?: DatasetPreparationTextInputMode;
  promptStyle?: "instruction-response" | "chat-messages";
  inputField?: string;
  outputField?: string;
  systemPromptField?: string;
  sourceContextPolicy?: "include" | "omit";
}

export interface LlmClassificationDatasetPreparationTask {
  taskType: "llm-classification";
  textInputMode?: DatasetPreparationTextInputMode;
  textField?: string;
  labelField?: string;
  labelSet?: string[];
  multiLabel?: boolean;
}

export interface LlmExtractionDatasetPreparationTask {
  taskType: "llm-extraction";
  textInputMode?: DatasetPreparationTextInputMode;
  textField?: string;
  schemaField?: string;
  outputField?: string;
  strictSchema?: boolean;
}

export interface LlmEmbeddingDatasetPreparationTask {
  taskType: "llm-embedding";
  textInputMode?: DatasetPreparationTextInputMode;
  anchorTextField?: string;
  positiveTextField?: string;
  negativeTextField?: string;
}

export interface LlmRerankerDatasetPreparationTask {
  taskType: "llm-reranker";
  textInputMode?: DatasetPreparationTextInputMode;
  queryField?: string;
  passageField?: string;
  relevanceField?: string;
  negativePassageField?: string;
}

export interface DiffusionLoraDatasetPreparationTask {
  taskType: "diffusion-lora";
  textInputMode?: DatasetPreparationTextInputMode;
  conceptKind?: "subject" | "style" | "concept";
  imageField?: string;
  captionField?: string;
  triggerToken?: string;
  regularizationClass?: string;
}

export interface VisionClassificationDatasetPreparationTask {
  taskType: "vision-classification";
  textInputMode?: DatasetPreparationTextInputMode;
  imageField?: string;
  labelField?: string;
  labelSet?: string[];
}

export interface VisionDetectionDatasetPreparationTask {
  taskType: "vision-detection";
  textInputMode?: DatasetPreparationTextInputMode;
  imageField?: string;
  boundingBoxField?: string;
  labelField?: string;
  labelSet?: string[];
  boxFormat?: "xyxy" | "xywh" | "coco";
}

export interface VisionSegmentationDatasetPreparationTask {
  taskType: "vision-segmentation";
  textInputMode?: DatasetPreparationTextInputMode;
  imageField?: string;
  maskField?: string;
  labelField?: string;
  labelSet?: string[];
  maskFormat?: "png" | "coco-rle" | "polygon";
}

export type DatasetPreparationTaskRecipe =
  | LlmInstructionDatasetPreparationTask
  | LlmClassificationDatasetPreparationTask
  | LlmExtractionDatasetPreparationTask
  | LlmEmbeddingDatasetPreparationTask
  | LlmRerankerDatasetPreparationTask
  | DiffusionLoraDatasetPreparationTask
  | VisionClassificationDatasetPreparationTask
  | VisionDetectionDatasetPreparationTask
  | VisionSegmentationDatasetPreparationTask;

export const DATASET_PREPARATION_TASK_PROFILE_DEFINITIONS: readonly DatasetPreparationTaskProfileDefinition[] =
  [
    {
      taskType: "llm-instruction",
      modelFamily: "llm",
      outputSchema: "instruction-response",
      supportedOutputFormats: ["jsonl", "json", "csv", "parquet"],
      preferredOutputFormat: "parquet",
      requiredFields: ["instruction", "input", "output"],
      optionalFields: ["system", "prompt", "completion", "sourceArtifactId"],
      runtimeSupport: "supported",
      compatibleTrainingMethods: ["lora", "qlora", "full-finetune"],
    },
    {
      taskType: "llm-classification",
      modelFamily: "llm",
      outputSchema: "classification",
      supportedOutputFormats: ["jsonl", "json", "csv", "parquet"],
      preferredOutputFormat: "parquet",
      requiredFields: ["text", "label"],
      optionalFields: ["labelSet", "sourceArtifactId"],
      runtimeSupport: "supported",
      compatibleTrainingMethods: ["lora", "qlora", "full-finetune"],
    },
    {
      taskType: "llm-extraction",
      modelFamily: "llm",
      outputSchema: "extraction",
      supportedOutputFormats: ["jsonl", "json", "csv", "parquet"],
      preferredOutputFormat: "jsonl",
      requiredFields: ["text", "expectedOutput"],
      optionalFields: ["schema", "sourceArtifactId"],
      runtimeSupport: "supported",
      compatibleTrainingMethods: ["lora", "qlora", "full-finetune"],
    },
    {
      taskType: "llm-embedding",
      modelFamily: "llm",
      outputSchema: "embedding-pairs",
      supportedOutputFormats: ["jsonl", "json", "csv", "parquet"],
      preferredOutputFormat: "parquet",
      requiredFields: ["anchorText", "positiveText"],
      optionalFields: ["negativeText", "sourceArtifactId"],
      runtimeSupport: "supported",
      compatibleTrainingMethods: ["lora", "qlora", "full-finetune"],
    },
    {
      taskType: "llm-reranker",
      modelFamily: "llm",
      outputSchema: "ranking-pairs",
      supportedOutputFormats: ["jsonl", "json", "csv", "parquet"],
      preferredOutputFormat: "parquet",
      requiredFields: ["query", "passage", "relevance"],
      optionalFields: ["negativePassage", "sourceArtifactId"],
      runtimeSupport: "supported",
      compatibleTrainingMethods: ["lora", "qlora", "full-finetune"],
    },
    {
      taskType: "diffusion-lora",
      modelFamily: "diffusion",
      outputSchema: "image-caption-manifest",
      supportedOutputFormats: ["jsonl", "json", "csv", "parquet"],
      preferredOutputFormat: "jsonl",
      requiredFields: ["image", "caption"],
      optionalFields: ["triggerToken", "conceptKind", "regularizationClass"],
      runtimeSupport: "supported",
      compatibleTrainingMethods: ["lora"],
    },
    {
      taskType: "vision-classification",
      modelFamily: "vision",
      outputSchema: "image-classification-manifest",
      supportedOutputFormats: ["jsonl", "json", "csv", "parquet"],
      preferredOutputFormat: "parquet",
      requiredFields: ["image", "label"],
      optionalFields: ["labelSet"],
      runtimeSupport: "supported",
      compatibleTrainingMethods: ["lora", "full-finetune"],
    },
    {
      taskType: "vision-detection",
      modelFamily: "vision",
      outputSchema: "object-detection-manifest",
      supportedOutputFormats: ["jsonl", "json", "csv", "parquet"],
      preferredOutputFormat: "jsonl",
      requiredFields: ["image", "boundingBoxes", "labels"],
      optionalFields: ["boxFormat"],
      runtimeSupport: "supported",
      compatibleTrainingMethods: ["lora", "full-finetune"],
    },
    {
      taskType: "vision-segmentation",
      modelFamily: "vision",
      outputSchema: "segmentation-manifest",
      supportedOutputFormats: ["jsonl", "json", "csv", "parquet"],
      preferredOutputFormat: "jsonl",
      requiredFields: ["image", "mask"],
      optionalFields: ["maskFormat", "label"],
      runtimeSupport: "supported",
      compatibleTrainingMethods: ["lora", "full-finetune"],
    },
  ];

const DATASET_PREPARATION_TASK_TYPE_SET = new Set<string>(
  DATASET_PREPARATION_TASK_TYPES,
);

export function isDatasetPreparationTaskType(
  value: string,
): value is DatasetPreparationTaskType {
  return DATASET_PREPARATION_TASK_TYPE_SET.has(value);
}

export function normalizeDatasetPreparationTaskType(
  value: string | undefined,
): DatasetPreparationTaskType {
  if (typeof value !== "string" || value.trim().length === 0) {
    return DEFAULT_DATASET_PREPARATION_TASK_TYPE;
  }

  const normalized = value.trim().toLowerCase();
  if (!isDatasetPreparationTaskType(normalized)) {
    throw new Error(`Unknown dataset preparation task type: ${value}`);
  }

  return normalized;
}

export function resolveDatasetPreparationTaskProfileDefinition(
  taskType: string | undefined,
): DatasetPreparationTaskProfileDefinition {
  const normalized = normalizeDatasetPreparationTaskType(taskType);
  const profile = DATASET_PREPARATION_TASK_PROFILE_DEFINITIONS.find(
    (candidate) => candidate.taskType === normalized,
  );
  if (!profile) {
    throw new Error(
      `Dataset preparation task profile is not registered: ${normalized}`,
    );
  }
  return profile;
}

export function createDefaultDatasetPreparationTaskRecipe(
  taskType: DatasetPreparationTaskType = DEFAULT_DATASET_PREPARATION_TASK_TYPE,
): DatasetPreparationTaskRecipe {
  switch (taskType) {
    case "llm-instruction":
      return {
        taskType,
        textInputMode: "generate",
        promptStyle: "instruction-response",
        inputField: "input",
        outputField: "output",
        sourceContextPolicy: "include",
      };
    case "llm-classification":
      return {
        taskType,
        textInputMode: "generate",
        textField: "text",
        labelField: "label",
        multiLabel: false,
      };
    case "llm-extraction":
      return {
        taskType,
        textInputMode: "generate",
        textField: "text",
        outputField: "expectedOutput",
        strictSchema: true,
      };
    case "llm-embedding":
      return {
        taskType,
        textInputMode: "generate",
        anchorTextField: "anchorText",
        positiveTextField: "positiveText",
        negativeTextField: "negativeText",
      };
    case "llm-reranker":
      return {
        taskType,
        textInputMode: "generate",
        queryField: "query",
        passageField: "passage",
        relevanceField: "relevance",
      };
    case "diffusion-lora":
      return {
        taskType,
        textInputMode: "provided",
        conceptKind: "subject",
        imageField: "image",
        captionField: "caption",
      };
    case "vision-classification":
      return {
        taskType,
        textInputMode: "provided",
        imageField: "image",
        labelField: "label",
      };
    case "vision-detection":
      return {
        taskType,
        textInputMode: "provided",
        imageField: "image",
        boundingBoxField: "boundingBoxes",
        labelField: "labels",
        boxFormat: "coco",
      };
    case "vision-segmentation":
      return {
        taskType,
        textInputMode: "provided",
        imageField: "image",
        maskField: "mask",
        labelField: "label",
        maskFormat: "png",
      };
  }

  const unreachable: never = taskType;
  throw new Error(`Unsupported dataset preparation task type: ${unreachable}`);
}

export interface DocumentNormalizationConfig {
  targetFormat: "markdown";
  unsupportedDocumentPolicy?: "fail" | "skip";
  normalizationMode?: "best-effort" | "strict";
}

export interface MarkdownChunkingConfig {
  strategy: "character";
  chunkSize: number;
  chunkOverlap: number;
  preserveDocumentBoundaries?: boolean;
  maxChunkCount?: number;
}

export interface GenerationParams {
  temperature?: number;
  topP?: number;
  maxNewTokens?: number;
}

export interface LocalModelConfig {
  provider: "transformers";
  modelId: string;
  inferenceMode?:
    | "auto"
    | "text2text"
    | "causal"
    | "chat"
    | "text-to-image"
    | "text-to-image";
  device?: "cpu" | "cuda" | "auto";
  torchDtype?: "auto" | "float16" | "bfloat16" | "float32";
}

export interface ExampleGenerationConfig {
  mode: "qa";
  model: LocalModelConfig;
  promptTemplate?: string;
  maxExamplesPerChunk?: number;
  batchSize?: number;
  generationParams?: GenerationParams;
  failurePolicy?: "fail" | "skip";
  structuredOutput?: {
    /** Omitted values are initialized from the host's stable capacity recommendation. */
    constrainedDecoding?: boolean;
    /** Omitted values resolve to the selected task's backward-compatible default. */
    visualShape?: DatasetPreparationVisualOutputShape;
  };
}

export interface DatasetPreparationRecipe {
  task?: DatasetPreparationTaskRecipe;
  normalization?: DocumentNormalizationConfig;
  chunking?: MarkdownChunkingConfig;
  generation?: ExampleGenerationConfig;
}

export interface DatasetSplitConfig {
  trainRatio: number;
  validationRatio?: number;
  testRatio: number;
  seed?: number;
  shuffle?: boolean;
}

export interface DatasetOutputConfig {
  format: "jsonl" | "json" | "csv" | "parquet";
  naming?: {
    baseName?: string;
  };
  destinations?: {
    local?: {
      enabled?: boolean;
    };
    huggingFace?: {
      enabled?: boolean;
      provider?: "huggingface";
      repository: string;
      revision?: string;
      pathPrefix?: string;
    };
  };
}

export interface DatasetPreparationSummary {
  sourceDocumentCount: number;
  normalizedDocumentCount: number;
  skippedDocumentCount: number;
  chunkCount: number;
  generatedExampleCount: number;
  datasetRowCount: number;
  trainRowCount: number;
  validationRowCount?: number;
  testRowCount: number;
  acceptedRowCount?: number;
  quarantinedRowCount?: number;
}

export interface DatasetPreparationWarning {
  code: string;
  message: string;
  sourceArtifactId?: string;
}
