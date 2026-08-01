import {
  resolveDatasetPreparationTaskProfileDefinition,
  validateDatasetPreparationSaveName,
  type DatasetPreparationExecutionPlan,
  type DatasetPreparationTaskType,
} from "../../../../../../../modules/contracts/runtime";

const TRAIN_TEST_SUM_TOLERANCE = 0.000_001;

export function parseOptionalNumber(value: string): number | undefined {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function parseOptionalInteger(value: string): number | undefined {
  const parsed = parseOptionalNumber(value);
  if (typeof parsed !== "number") {
    return undefined;
  }

  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

export interface DatasetPreparationValidationInput {
  selectedArtifactIds: string[];
  taskType: DatasetPreparationTaskType;
  preparation?: DatasetPreparationExecutionPlan;
  chunkSize: string;
  chunkOverlap: string;
  maxChunkCount: string;
  maxTokensPerChunk?: string;
  topicBoundarySensitivity?: string;
  maxSourceSpans?: string;
  similarityThreshold?: string;
  modelId: string;
  maxExamplesPerChunk: string;
  batchSize: string;
  generationTemperature: string;
  generationTopP: string;
  generationMaxNewTokens: string;
  trainRatio: string;
  validationRatio?: string;
  testRatio: string;
  seed: string;
  outputBaseName?: string;
  localDestinationEnabled: boolean;
  huggingFaceDestinationEnabled: boolean;
  huggingFaceRepository: string;
  defaultHuggingFaceNamespace?: string;
}

export interface ParsedDatasetPreparationInputs {
  chunkSize?: number;
  chunkOverlap?: number;
  maxChunkCount: number | undefined;
  maxTokensPerChunk?: number;
  topicBoundarySensitivity?: number;
  maxSourceSpans?: number;
  similarityThreshold?: number;
  maxExamplesPerChunk: number | undefined;
  batchSize: number | undefined;
  generationTemperature: number | undefined;
  generationTopP: number | undefined;
  generationMaxNewTokens: number | undefined;
  trainRatio: number;
  validationRatio?: number;
  testRatio: number;
  seed: number | undefined;
}

export type DatasetPreparationValidationResult =
  | { ok: false; error: string }
  | { ok: true; parsed: ParsedDatasetPreparationInputs };

export function validateAndParseDatasetPreparationInputs(
  input: DatasetPreparationValidationInput,
): DatasetPreparationValidationResult {
  const profile = resolveDatasetPreparationTaskProfileDefinition(
    input.taskType,
  );
  if (profile.runtimeSupport !== "supported") {
    return {
      ok: false,
      error:
        "This training task is defined for the system but is not available in the current local runtime yet.",
    };
  }

  if (input.selectedArtifactIds.length === 0) {
    return { ok: false, error: "Select at least one source artifact." };
  }

  const usesFixedSections =
    input.preparation === undefined ||
    input.preparation.method === "fixed-length";
  const usesTopicSections = input.preparation?.method === "topic-aware";
  const usesAdaptiveSections =
    usesTopicSections || input.preparation?.method === "structure-aware";
  const chunkSize = usesFixedSections
    ? parseOptionalInteger(input.chunkSize)
    : undefined;
  if (
    usesFixedSections &&
    (typeof chunkSize !== "number" || Number.isNaN(chunkSize) || chunkSize <= 0)
  ) {
    return {
      ok: false,
      error: input.preparation
        ? "Section length must be a positive whole number."
        : "Chunk size must be a positive integer.",
    };
  }

  const chunkOverlap = usesFixedSections
    ? parseOptionalInteger(input.chunkOverlap)
    : undefined;
  if (
    usesFixedSections &&
    (typeof chunkOverlap !== "number" ||
      Number.isNaN(chunkOverlap) ||
      chunkOverlap < 0)
  ) {
    return {
      ok: false,
      error: input.preparation
        ? "Section overlap must be a whole number greater than or equal to 0."
        : "Chunk overlap must be an integer greater than or equal to 0.",
    };
  }

  const maxChunkCount = usesFixedSections
    ? parseOptionalInteger(input.maxChunkCount)
    : undefined;
  if (
    typeof maxChunkCount === "number" &&
    (Number.isNaN(maxChunkCount) || maxChunkCount <= 0)
  ) {
    return {
      ok: false,
      error:
        "Maximum section count must be a positive whole number when provided.",
    };
  }

  const maxTokensPerChunk = usesAdaptiveSections
    ? parseOptionalInteger(input.maxTokensPerChunk ?? "")
    : undefined;
  if (
    usesAdaptiveSections &&
    (typeof maxTokensPerChunk !== "number" ||
      Number.isNaN(maxTokensPerChunk) ||
      maxTokensPerChunk <= 0)
  ) {
    return {
      ok: false,
      error: "Maximum section length must be a positive whole number.",
    };
  }
  const maxSourceSpans = usesAdaptiveSections
    ? parseOptionalInteger(input.maxSourceSpans ?? "")
    : undefined;
  if (
    usesAdaptiveSections &&
    (typeof maxSourceSpans !== "number" ||
      Number.isNaN(maxSourceSpans) ||
      maxSourceSpans <= 0)
  ) {
    return {
      ok: false,
      error: "Maximum source sections must be a positive whole number.",
    };
  }
  const topicBoundarySensitivity = usesTopicSections
    ? parseOptionalNumber(input.topicBoundarySensitivity ?? "")
    : undefined;
  if (
    usesTopicSections &&
    (typeof topicBoundarySensitivity !== "number" ||
      Number.isNaN(topicBoundarySensitivity) ||
      topicBoundarySensitivity < 0 ||
      topicBoundarySensitivity > 1)
  ) {
    return {
      ok: false,
      error: "Topic change sensitivity must be between 0 and 1.",
    };
  }
  const similarityThreshold = usesAdaptiveSections
    ? parseOptionalNumber(input.similarityThreshold ?? "")
    : undefined;
  if (
    usesAdaptiveSections &&
    (typeof similarityThreshold !== "number" ||
      Number.isNaN(similarityThreshold) ||
      similarityThreshold < 0 ||
      similarityThreshold > 1)
  ) {
    return {
      ok: false,
      error: "Similar-example threshold must be between 0 and 1.",
    };
  }

  const maxExamplesPerChunk = parseOptionalInteger(input.maxExamplesPerChunk);
  if (
    typeof maxExamplesPerChunk === "number" &&
    (Number.isNaN(maxExamplesPerChunk) || maxExamplesPerChunk <= 0)
  ) {
    return {
      ok: false,
      error: "Max examples per chunk must be a positive integer when provided.",
    };
  }

  const batchSize = parseOptionalInteger(input.batchSize);
  if (
    typeof batchSize === "number" &&
    (Number.isNaN(batchSize) || batchSize <= 0)
  ) {
    return {
      ok: false,
      error: "Batch size must be a positive integer when provided.",
    };
  }

  const generationMaxNewTokens = parseOptionalInteger(
    input.generationMaxNewTokens,
  );
  if (
    typeof generationMaxNewTokens === "number" &&
    (Number.isNaN(generationMaxNewTokens) || generationMaxNewTokens <= 0)
  ) {
    return {
      ok: false,
      error:
        "Generation max new tokens must be a positive integer when provided.",
    };
  }

  const generationTemperature = parseOptionalNumber(
    input.generationTemperature,
  );
  if (
    typeof generationTemperature === "number" &&
    Number.isNaN(generationTemperature)
  ) {
    return {
      ok: false,
      error: "Generation temperature must be numeric when provided.",
    };
  }

  const generationTopP = parseOptionalNumber(input.generationTopP);
  if (typeof generationTopP === "number" && Number.isNaN(generationTopP)) {
    return {
      ok: false,
      error: "Generation top-p must be numeric when provided.",
    };
  }

  const trainRatio = Number(input.trainRatio);
  if (!Number.isFinite(trainRatio)) {
    return { ok: false, error: "Train ratio must be a valid number." };
  }

  const testRatio = Number(input.testRatio);
  if (!Number.isFinite(testRatio)) {
    return { ok: false, error: "Test ratio must be a valid number." };
  }

  const validationRatio = Number(input.validationRatio ?? "0");
  if (!Number.isFinite(validationRatio)) {
    return { ok: false, error: "Validation ratio must be a valid number." };
  }

  if (trainRatio <= 0 || validationRatio < 0 || testRatio < 0) {
    return {
      ok: false,
      error:
        "Training must be greater than 0; validation and test cannot be negative.",
    };
  }

  if (validationRatio === 0 && testRatio === 0) {
    return { ok: false, error: "Keep some data for validation or testing." };
  }

  if (
    Math.abs(trainRatio + validationRatio + testRatio - 1) >
    TRAIN_TEST_SUM_TOLERANCE
  ) {
    return {
      ok: false,
      error: "Training, validation, and test portions must add up to 1.0.",
    };
  }

  const parsedSeed = parseOptionalNumber(input.seed);
  if (typeof parsedSeed === "number" && Number.isNaN(parsedSeed)) {
    return { ok: false, error: "Seed must be numeric when provided." };
  }

  const saveNameError = validateDatasetPreparationSaveName(
    input.outputBaseName,
  );
  if (saveNameError) return { ok: false, error: saveNameError };

  if (!input.localDestinationEnabled && !input.huggingFaceDestinationEnabled) {
    return { ok: false, error: "Enable at least one output destination." };
  }

  if (
    input.huggingFaceDestinationEnabled &&
    input.huggingFaceRepository.trim().length === 0
  ) {
    return {
      ok: false,
      error: input.defaultHuggingFaceNamespace
        ? "Dataset repository name is required when Hugging Face publishing is enabled."
        : "Hugging Face repository is required when that destination is enabled. Use owner/repository.",
    };
  }

  if (
    input.huggingFaceDestinationEnabled &&
    input.huggingFaceRepository.includes("\\")
  ) {
    return {
      ok: false,
      error: input.defaultHuggingFaceNamespace
        ? "Dataset repository name cannot include backslashes. Use only the repository name (for example: my-dataset)."
        : "Hugging Face repository must use forward slashes (owner/repository).",
    };
  }

  return {
    ok: true,
    parsed: {
      chunkSize,
      chunkOverlap,
      maxChunkCount,
      maxTokensPerChunk,
      topicBoundarySensitivity,
      maxSourceSpans,
      similarityThreshold,
      maxExamplesPerChunk,
      batchSize,
      generationTemperature,
      generationTopP,
      generationMaxNewTokens,
      trainRatio,
      validationRatio,
      testRatio,
      seed: parsedSeed,
    },
  };
}
