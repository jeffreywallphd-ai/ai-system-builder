import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
} from "node:path";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  createStagedArtifactDescriptorFromStorageObjectDescriptor,
  type StagedArtifactDescriptor,
} from "../../contracts/ingestion";
import {
  normalizeDatasetVersionDigest,
  type DatasetVersionSource,
} from "../../contracts/dataset";
import {
  createContractError,
  createFailureResult,
  createSuccessResult,
  type ContractResult,
} from "../../contracts/shared";
import {
  createHasArtifactInRepoRequest,
  createDeleteArtifactRequest,
  createRetrieveArtifactFromRepoRequest,
  createRetrieveArtifactRequest,
  createStoreArtifactInRepoRequest,
  createStoreArtifactRequest,
} from "../../contracts/storage";
import type {
  DatasetPreparationSummary,
  DatasetPreparationAdvancedReport,
  DatasetPreparationWarning,
  DatasetQualityApprovalRequest,
  DatasetQualityReasonCode,
  DatasetQualityReport,
  DatasetQualityReviewLineId,
  DatasetQualityReviewPage,
  DatasetQualityReviewRow,
  DatasetQualityRequestedConfig,
  DatasetQualityRuntimeConfig,
  PrepareTrainingDatasetRequest,
  PrepareTrainingDatasetResult,
} from "../../contracts/runtime";
import {
  DEFAULT_DATASET_PREPARATION_TASK_TYPE,
  DATASET_QUALITY_REASON_CODES,
  createDefaultDatasetPreparationTaskRecipe,
  compileDatasetPreparationVisualOutputShape,
  resolveDatasetPreparationVisualOutputShape,
  createDatasetPreparationAdvancedConfigForMethod,
  createDatasetPreparationExecutionPlan,
  evaluateDatasetPreparationSourceReadiness,
  isDatasetPreparationTaskType,
  normalizeLegacyDatasetPreparationMethod,
  resolveDatasetPreparationAdaptivePlan,
  resolveDatasetPreparationSourceCapability,
  resolveDatasetPreparationTaskProfileDefinition,
  resolveDefaultDatasetPreparationPromptTemplate,
  resolveDefaultDatasetPreparationTextGenerationModel,
  validateDatasetPreparationSaveName,
} from "../../contracts/runtime";

import type { ApplicationRequestContext } from "../ports";
import type { DatasetVersionHasherPort } from "../ports/dataset-version";
import type { RuntimeTaskRegistryPort } from "../ports/runtime";
import type { DatasetQualityPolicyProviderPort } from "../ports/runtime";
import type { ArtifactCatalogReadPort } from "../ports/artifact-catalog";
import type {
  ArtifactStorageBindingPort,
  ArtifactObjectStoragePort,
  ArtifactRepoStoragePort,
} from "../ports/storage";
import type { ArtifactStorageBinding } from "../../contracts/storage";
import { TaskType } from "../../contracts/runtime";
import { createWorkspaceId, isWorkspaceId } from "../../contracts/workspace";
import type {
  RuntimeCapabilityGuardService,
  TaskPowerLifecyclePort,
} from "../services/runtime";
import type {
  RuntimeTaskStatus,
  RuntimeTaskStatusRecord,
} from "../../contracts/runtime";
import type { DatasetVersionFinalizationService } from "../services/dataset-version";

export interface PrepareTrainingDatasetFromArtifactsCommand {
  sourceArtifactIds: string[];
  preparation?: PrepareTrainingDatasetRequest["preparation"];
  recipe: PrepareTrainingDatasetRequest["recipe"];
  split: PrepareTrainingDatasetRequest["split"];
  output: PrepareTrainingDatasetRequest["output"];
  quality?: DatasetQualityRequestedConfig;
  advanced?: PrepareTrainingDatasetRequest["advanced"];
}

export interface PrepareTrainingDatasetFromArtifactsValue {
  outputs: {
    local?: {
      dataset?: StagedArtifactDescriptor;
      train?: StagedArtifactDescriptor;
      validation?: StagedArtifactDescriptor;
      test?: StagedArtifactDescriptor;
      report?: StagedArtifactDescriptor;
      quarantine?: StagedArtifactDescriptor;
    };
    huggingFace?: {
      dataset?: {
        provider: "huggingface";
        repository: string;
        path: string;
        revision?: string;
        exists: boolean;
        verifiedAt: string;
      };
      train?: {
        provider: "huggingface";
        repository: string;
        path: string;
        revision?: string;
        exists: boolean;
        verifiedAt: string;
      };
      validation?: {
        provider: "huggingface";
        repository: string;
        path: string;
        revision?: string;
        exists: boolean;
        verifiedAt: string;
      };
      test?: {
        provider: "huggingface";
        repository: string;
        path: string;
        revision?: string;
        exists: boolean;
        verifiedAt: string;
      };
    };
  };
  provenance: {
    sourceArtifactIds: string[];
    recipe: PrepareTrainingDatasetRequest["recipe"];
    split: PrepareTrainingDatasetRequest["split"];
    output: PrepareTrainingDatasetRequest["output"];
    datasetPreparationTask: Record<string, unknown>;
    generationModelId?: string;
    summary: DatasetPreparationSummary;
  };
  summary: DatasetPreparationSummary;
  qualityReport?: DatasetQualityReport;
  advancedReport?: DatasetPreparationAdvancedReport;
  review?: {
    state: "review-required" | "approved";
    reportFingerprint: string;
    approvalAllowed: boolean;
  };
  warnings?: DatasetPreparationWarning[];
  datasetVersion?: {
    versionId: string;
    datasetId: string;
    versionDigest: string;
    createdAt: string;
  };
}

export interface ReadPreparedDatasetQualityReviewPageInput {
  readonly requestId: string;
  readonly reportFingerprint: string;
  readonly lineId: DatasetQualityReviewLineId;
  readonly page: number;
}

interface PendingDatasetQualityReview {
  command: PrepareTrainingDatasetFromArtifactsCommand;
  runtimeResult: PrepareTrainingDatasetResult;
  runtimeWorkingDirectory: string;
  quality: DatasetQualityRuntimeConfig;
  evidence: PrepareTrainingDatasetFromArtifactsValue;
  evidenceStorageKeys: string[];
  reviewStorage?: {
    key: string;
    sha256: string;
  };
  scope: { workspaceId: string; organizationId?: string; principalId?: string };
}

const MAX_DATASET_PREPARATION_SOURCE_COUNT = 256;

function validateDatasetPreparationCommand(
  command: PrepareTrainingDatasetFromArtifactsCommand,
): string | undefined {
  if (!isRecord(command)) {
    return "Dataset preparation settings are required.";
  }
  if (
    !Array.isArray(command.sourceArtifactIds) ||
    command.sourceArtifactIds.length === 0
  ) {
    return "Choose at least one source before preparing a dataset.";
  }
  if (command.sourceArtifactIds.length > MAX_DATASET_PREPARATION_SOURCE_COUNT) {
    return "Too many sources were selected for one dataset preparation task.";
  }
  if (
    command.sourceArtifactIds.some(
      (artifactId) =>
        typeof artifactId !== "string" ||
        artifactId.trim().length === 0 ||
        artifactId.length > 512,
    ) ||
    new Set(command.sourceArtifactIds).size !== command.sourceArtifactIds.length
  ) {
    return "Every selected source must have one valid, unique artifact id.";
  }
  if (!isRecord(command.recipe)) {
    return "Dataset preparation settings are incomplete.";
  }
  if (
    (command.recipe.normalization !== undefined &&
      !isRecord(command.recipe.normalization)) ||
    (command.recipe.chunking !== undefined &&
      !isRecord(command.recipe.chunking)) ||
    (command.recipe.generation !== undefined &&
      (!isRecord(command.recipe.generation) ||
        !isRecord(command.recipe.generation.model)))
  ) {
    return "Dataset preparation settings contain an invalid active section.";
  }
  const structuredOutput = command.recipe.generation?.structuredOutput;
  if (
    structuredOutput !== undefined &&
    (!isRecord(structuredOutput) ||
      (structuredOutput.constrainedDecoding !== undefined &&
        typeof structuredOutput.constrainedDecoding !== "boolean"))
  ) {
    return "The generated output settings are invalid.";
  }
  if (
    isRecord(command.recipe.task) &&
    typeof command.recipe.task.taskType === "string" &&
    !isDatasetPreparationTaskType(command.recipe.task.taskType)
  ) {
    return "The selected training goal is not supported.";
  }
  if (!isRecord(command.split)) {
    return "Dataset split settings are required.";
  }
  if (command.preparation !== undefined) {
    const plan = command.preparation;
    if (
      !isRecord(plan) ||
      plan.schemaVersion !== "1" ||
      ![
        "use-existing-dataset",
        "combine-existing-datasets",
        "create-from-source-material",
      ].includes(String(plan.inputIntent)) ||
      ![
        "validate-and-split",
        "combine-and-split",
        "fixed-length",
        "topic-aware",
        "structure-aware",
        "use-source-metadata",
        "model-assisted-metadata",
        "use-existing-annotations",
      ].includes(String(plan.method)) ||
      !Array.isArray(plan.sourceKinds) ||
      plan.sourceKinds.length !== 1 ||
      !["structured", "document", "image"].includes(
        String(plan.sourceKinds[0]),
      ) ||
      !["none", "task-examples", "metadata-text"].includes(
        String(plan.generationMode),
      )
    ) {
      return "The selected preparation method is invalid.";
    }
  }
  const trainRatio = command.split.trainRatio;
  const validationRatio = command.split.validationRatio ?? 0;
  const testRatio = command.split.testRatio;
  if (
    !Number.isFinite(trainRatio) ||
    !Number.isFinite(validationRatio) ||
    !Number.isFinite(testRatio) ||
    trainRatio <= 0 ||
    validationRatio < 0 ||
    testRatio < 0 ||
    (validationRatio === 0 && testRatio === 0) ||
    Math.abs(trainRatio + validationRatio + testRatio - 1) > 0.000001
  ) {
    return "Training, validation, and test shares must be valid and add up to 1.";
  }
  if (
    !isRecord(command.output) ||
    !["jsonl", "json", "csv", "parquet"].includes(String(command.output.format))
  ) {
    return "Choose a supported saved file format.";
  }
  const saveNameError = validateDatasetPreparationSaveName(
    command.output.naming?.baseName,
  );
  if (saveNameError) return saveNameError;
  if (command.quality !== undefined) {
    if (
      !isRecord(command.quality) ||
      !isRecord(command.quality.policy) ||
      !["recommended", "strict"].includes(
        String(command.quality.policy.preset),
      ) ||
      (command.quality.reviewRequired !== undefined &&
        typeof command.quality.reviewRequired !== "boolean") ||
      (command.quality.policy.allowedLanguages !== undefined &&
        (!Array.isArray(command.quality.policy.allowedLanguages) ||
          command.quality.policy.allowedLanguages.length === 0 ||
          command.quality.policy.allowedLanguages.length > 16 ||
          command.quality.policy.allowedLanguages.some(
            (value) => typeof value !== "string",
          ))) ||
      (command.quality.policy.excludedBenchmarkIds !== undefined &&
        (!Array.isArray(command.quality.policy.excludedBenchmarkIds) ||
          command.quality.policy.excludedBenchmarkIds.length > 64 ||
          command.quality.policy.excludedBenchmarkIds.some(
            (value) => typeof value !== "string",
          ))) ||
      (command.quality.policy.requireLicenseMetadata !== undefined &&
        typeof command.quality.policy.requireLicenseMetadata !== "boolean") ||
      (command.quality.policy.requireConsentMetadata !== undefined &&
        typeof command.quality.policy.requireConsentMetadata !== "boolean") ||
      (command.quality.policy.includeSourceAttribution !== undefined &&
        typeof command.quality.policy.includeSourceAttribution !== "boolean") ||
      (command.quality.policy.maxRowsPerSource !== undefined &&
        (!Number.isInteger(command.quality.policy.maxRowsPerSource) ||
          command.quality.policy.maxRowsPerSource < 1 ||
          command.quality.policy.maxRowsPerSource > 1_000_000))
    ) {
      return "Data quality settings are invalid.";
    }
    if (command.output.destinations?.huggingFace?.enabled) {
      return "Publish reviewed datasets after creating an approved dataset version.";
    }
  }
  if (command.advanced !== undefined) {
    const advanced = command.advanced;
    const content = advanced.content;
    const semantic = advanced.semantic;
    const synthetic = advanced.synthetic;
    if (
      !isRecord(advanced) ||
      ![
        "standard",
        "better-document-understanding",
        "generate-examples",
        "topic-aware",
        "structure-aware",
      ].includes(String(advanced.preset)) ||
      (content !== undefined &&
        (!isRecord(content) ||
          ![
            "token",
            "sentence",
            "section",
            "table",
            "semantic",
            "layout",
          ].includes(String(content.strategy)) ||
          (content.maxTokensPerChunk !== undefined &&
            (!Number.isInteger(content.maxTokensPerChunk) ||
              content.maxTokensPerChunk < 32 ||
              content.maxTokensPerChunk > 4096)) ||
          (content.maxSourceSpans !== undefined &&
            (!Number.isInteger(content.maxSourceSpans) ||
              content.maxSourceSpans < 1 ||
              content.maxSourceSpans > 100_000)) ||
          (content.semanticBoundaryThreshold !== undefined &&
            (!Number.isFinite(content.semanticBoundaryThreshold) ||
              content.semanticBoundaryThreshold < 0 ||
              content.semanticBoundaryThreshold > 1)))) ||
      (semantic !== undefined &&
        (!isRecord(semantic) ||
          typeof semantic.enabled !== "boolean" ||
          (semantic.embeddingAlgorithm !== undefined &&
            semantic.embeddingAlgorithm !== "hashed-token-v1") ||
          (semantic.maxComparisonsPerRow !== undefined &&
            (!Number.isInteger(semantic.maxComparisonsPerRow) ||
              semantic.maxComparisonsPerRow < 1 ||
              semantic.maxComparisonsPerRow > 1024)))) ||
      (synthetic !== undefined &&
        (!isRecord(synthetic) ||
          typeof synthetic.enabled !== "boolean" ||
          (synthetic.candidatesPerChunk !== undefined &&
            (!Number.isInteger(synthetic.candidatesPerChunk) ||
              synthetic.candidatesPerChunk < 1 ||
              synthetic.candidatesPerChunk > 4))))
    ) {
      return "Advanced preparation settings are invalid.";
    }
    if (content?.ocrEnabled) {
      return "Text recognition for scanned images is not available. Use a text-based source or add reviewed text.";
    }
    if (
      synthetic?.enabled &&
      (!command.quality ||
        command.quality.reviewRequired === false ||
        synthetic.requireReview === false)
    ) {
      return "Generated examples require data checks and review before they can be saved.";
    }
    if (semantic?.enabled && !command.quality) {
      return "Advanced similarity checks require data checks so set-aside rows can be reviewed.";
    }
  }
  return undefined;
}

export type PrepareTrainingDatasetFromArtifactsResult =
  ContractResult<PrepareTrainingDatasetFromArtifactsValue>;

export interface PrepareTrainingDatasetFromArtifactsUseCaseDependencies {
  runtimeTaskRegistry: RuntimeTaskRegistryPort;
  storageBindings: ArtifactStorageBindingPort;
  storage: ArtifactObjectStoragePort;
  artifactRepoStorage?: ArtifactRepoStoragePort;
  artifactCatalog?: ArtifactCatalogReadPort;
  taskPowerLifecycle: TaskPowerLifecyclePort;
  runtimeCapabilityGuard?: Pick<
    RuntimeCapabilityGuardService,
    "requireCapabilityReady"
  >;
  datasetQualityPolicyProvider?: DatasetQualityPolicyProviderPort;
  datasetVersioning?: {
    finalizer: DatasetVersionFinalizationService;
    hasher: DatasetVersionHasherPort;
  };
  now?: () => string;
}

function resolveArtifactBindingsReadFailureAsEmpty(
  result: Awaited<
    ReturnType<ArtifactStorageBindingPort["readArtifactStorageBindings"]>
  >,
): Awaited<
  ReturnType<ArtifactStorageBindingPort["readArtifactStorageBindings"]>
> {
  if (result.ok || result.error.code !== "not-found") {
    return result;
  }

  return createSuccessResult(
    { bindings: [] },
    {
      requestId: result.requestId,
      correlationId: result.correlationId,
    },
  );
}

function resolvePreferredObjectStorageBinding(
  bindings: ArtifactStorageBinding[],
): ArtifactStorageBinding | undefined {
  // Dataset preparation requires locally retrievable object bytes.
  // Prefer an artifact-object + local + primary binding when available, then
  // fallback to any artifact-object binding, then the first entry as a last resort.
  return (
    bindings.find(
      (binding) =>
        binding.backing.kind === "artifact-object" &&
        (binding.backing.provider === "local" ||
          binding.backing.provider === "local-filesystem") &&
        binding.role === "primary",
    ) ??
    bindings.find(
      (binding) =>
        binding.backing.kind === "artifact-object" &&
        (binding.backing.provider === "local" ||
          binding.backing.provider === "local-filesystem"),
    )
  );
}

function resolveImportedSourceBinding(
  bindings: ArtifactStorageBinding[],
): ArtifactStorageBinding | undefined {
  return bindings.find(
    (binding) =>
      binding.role === "imported-source" &&
      binding.backing.kind === "artifact-repo" &&
      binding.backing.target !== undefined,
  );
}

function resolveLocalStorageKeyForArtifact(
  artifactId: string,
  bindings: ArtifactStorageBinding[],
): string {
  const preferredBinding = resolvePreferredObjectStorageBinding(bindings);
  if (
    preferredBinding?.backing.kind === "artifact-object" &&
    preferredBinding.backing.locator
  ) {
    return preferredBinding.backing.locator;
  }

  // Catalog-backed local artifacts use storageKey as artifact identity in desktop flows.
  // When no explicit storage binding exists yet, use the artifact id as local key.
  return artifactId;
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType === "text/markdown" || mediaType === "text/x-markdown") {
    return ".md";
  }

  if (
    mediaType === "application/x-ndjson" ||
    mediaType === "application/jsonl"
  ) {
    return ".jsonl";
  }

  if (mediaType === "application/json" || mediaType === "text/json") {
    return ".json";
  }

  if (mediaType === "text/csv" || mediaType === "application/csv") {
    return ".csv";
  }

  if (mediaType === "application/pdf") {
    return ".pdf";
  }

  if (
    mediaType === "application/x-parquet" ||
    mediaType === "application/vnd.apache.parquet"
  ) {
    return ".parquet";
  }

  return ".txt";
}

function sanitizeRuntimeSourceFileSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "source";
}

function buildRuntimeSourceInputPath(
  runtimeWorkingDir: string,
  artifactId: string,
  mediaType: string,
  originalName: string | undefined,
  sourceIndex: number,
): string {
  const sourceName = originalName?.trim() || basename(artifactId);
  const stem = sanitizeRuntimeSourceFileSegment(
    parse(sourceName).name || sourceName,
  );
  const prefix = `${String(sourceIndex + 1).padStart(4, "0")}-${stem}`;
  return join(
    runtimeWorkingDir,
    `${prefix}${extensionForMediaType(mediaType)}`,
  );
}

interface ResolvedOutputDestinations {
  local: boolean;
  huggingFace?: {
    provider: "huggingface";
    repository: string;
    revision?: string;
    pathPrefix?: string;
  };
}

function resolveOutputDestinations(
  output: PrepareTrainingDatasetRequest["output"],
): ResolvedOutputDestinations {
  const localEnabled = output.destinations?.local?.enabled ?? true;
  const huggingFace = output.destinations?.huggingFace;

  if (!localEnabled && !huggingFace?.enabled) {
    throw new Error("At least one dataset output destination must be enabled.");
  }

  if (!huggingFace?.enabled) {
    return { local: localEnabled };
  }

  return {
    local: localEnabled,
    huggingFace: {
      provider: "huggingface",
      repository: huggingFace.repository,
      revision: huggingFace.revision,
      pathPrefix: huggingFace.pathPrefix,
    },
  };
}

function joinRepoPath(
  pathPrefix: string | undefined,
  fileName: string,
): string {
  const normalizedPrefix = pathPrefix?.trim().replace(/^\/+|\/+$/g, "");
  return normalizedPrefix ? `${normalizedPrefix}/${fileName}` : fileName;
}

function buildGeneratedDatasetStorageKey(
  outputName: string,
  outputFormat: PrepareTrainingDatasetRequest["output"]["format"],
  nowIsoString: string,
): string {
  const compactTimestamp = nowIsoString.replace(/[-:.TZ]/g, "");
  const safeOutputName = outputName
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const outputBaseName = safeOutputName.length > 0 ? safeOutputName : "dataset";
  const suffix = randomUUID().replaceAll("-", "");
  return `generated/${compactTimestamp}-${suffix}-${outputBaseName}.${outputFormat}`;
}

function applyApprovedDatasetSaveName(
  runtimeResult: PrepareTrainingDatasetResult,
  requestedBaseName: string,
): PrepareTrainingDatasetResult {
  const baseName = requestedBaseName.trim() || "training-dataset";
  return {
    ...runtimeResult,
    outputs: runtimeResult.outputs.map((output) => {
      const suffix =
        output.role === "train" ||
        output.role === "validation" ||
        output.role === "test"
          ? `-${output.role}`
          : output.role === "dataset" || output.role === "artifact"
            ? ""
            : undefined;
      return suffix === undefined
        ? output
        : { ...output, name: `${baseName}${suffix}` };
    }),
  };
}

function buildDatasetMetadata(
  command: PrepareTrainingDatasetFromArtifactsCommand,
  summary: DatasetPreparationSummary,
  destination: {
    provider: "local" | "huggingface";
    publication?: {
      repository: string;
      path: string;
      revision?: string;
    };
  },
  runtimeMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const taskRecipe =
    command.recipe.task ?? createDefaultDatasetPreparationTaskRecipe();
  const taskProfile = resolveDatasetPreparationTaskProfileDefinition(
    taskRecipe.taskType,
  );
  return {
    sourceArtifactIds: command.sourceArtifactIds,
    ...(command.preparation ? { preparation: command.preparation } : {}),
    recipe: command.recipe,
    split: command.split,
    datasetPreparationTask: {
      taskType: taskProfile.taskType,
      modelFamily: taskProfile.modelFamily,
      outputSchema: taskProfile.outputSchema,
      runtimeSupport: taskProfile.runtimeSupport,
      compatibleTrainingMethods: [...taskProfile.compatibleTrainingMethods],
      recipe: taskRecipe,
    },
    ...(command.recipe.generation
      ? {
          generationModel: {
            provider: command.recipe.generation.model.provider,
            modelId: command.recipe.generation.model.modelId,
          },
        }
      : {}),
    summary,
    destination,
    runtime: runtimeMetadata,
  };
}

async function validateDatasetOutput(
  tempPath: string,
  format: PrepareTrainingDatasetRequest["output"]["format"],
): Promise<void> {
  const outputStat = await stat(tempPath);
  if (outputStat.size <= 0) {
    throw new Error(`Runtime output file '${tempPath}' is empty.`);
  }

  if (format === "parquet") {
    return;
  }

  const contents = await readFile(tempPath, "utf-8");
  if (!contents.trim()) {
    throw new Error(`Runtime output file '${tempPath}' contains no data.`);
  }

  if (format === "json") {
    JSON.parse(contents);
    return;
  }

  if (format === "jsonl") {
    const lines = contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      throw new Error(
        `Runtime output file '${tempPath}' does not contain any JSONL rows.`,
      );
    }
    for (const line of lines) {
      JSON.parse(line);
    }
    return;
  }

  const [header] = contents.split(/\r?\n/);
  if (!header || header.trim().length === 0) {
    throw new Error(
      `Runtime output file '${tempPath}' does not include a CSV header.`,
    );
  }
}

async function resolveRuntimeOutputPath(
  runtimeWorkingDirectory: string,
  outputHandle: string,
): Promise<string> {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(outputHandle) ||
    basename(outputHandle) !== outputHandle ||
    isAbsolute(outputHandle)
  ) {
    throw new Error("Runtime returned an invalid output handle.");
  }
  const rootStats = await lstat(runtimeWorkingDirectory);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("Runtime working directory is invalid.");
  }
  const canonicalRoot = await realpath(runtimeWorkingDirectory);
  const candidate = resolve(canonicalRoot, outputHandle);
  const relativeCandidate = relative(canonicalRoot, candidate);
  if (relativeCandidate.startsWith("..") || isAbsolute(relativeCandidate)) {
    throw new Error("Runtime output handle escaped its working directory.");
  }
  const candidateStats = await lstat(candidate);
  if (
    candidateStats.isSymbolicLink() ||
    !candidateStats.isFile() ||
    candidateStats.nlink !== 1
  ) {
    throw new Error("Runtime output must be a private regular file.");
  }
  const canonicalCandidate = await realpath(candidate);
  const canonicalRelative = relative(canonicalRoot, canonicalCandidate);
  if (canonicalRelative.startsWith("..") || isAbsolute(canonicalRelative)) {
    throw new Error("Runtime output escaped its working directory.");
  }
  return canonicalCandidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonicalRuntimeJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalRuntimeJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(
        ([key, item]) => `${JSON.stringify(key)}:${canonicalRuntimeJson(item)}`,
      )
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Structured output settings must be JSON compatible.");
  }
  return serialized;
}

function isDatasetPreparationSummary(
  value: unknown,
): value is DatasetPreparationSummary {
  return (
    isRecord(value) &&
    typeof value.sourceDocumentCount === "number" &&
    typeof value.normalizedDocumentCount === "number" &&
    typeof value.skippedDocumentCount === "number" &&
    typeof value.chunkCount === "number" &&
    typeof value.generatedExampleCount === "number" &&
    typeof value.datasetRowCount === "number" &&
    typeof value.trainRowCount === "number" &&
    (value.validationRowCount === undefined ||
      typeof value.validationRowCount === "number") &&
    typeof value.testRowCount === "number"
  );
}

const DATASET_QUALITY_REPORT_MAX_BYTES = 1024 * 1024;
const DATASET_QUALITY_QUARANTINE_MAX_BYTES = 256 * 1024 * 1024;
const DATASET_QUALITY_REVIEW_MAX_BYTES = 256 * 1024 * 1024;
const DATASET_QUALITY_REVIEW_MAX_LINE_BYTES = 1024 * 1024;
const DATASET_QUALITY_REVIEW_PAGE_SIZE = 10 as const;
const DATASET_QUALITY_REVIEW_MAX_FIELDS = 256;
const DATASET_QUALITY_REVIEW_MAX_DEPTH = 8;
const DATASET_QUALITY_REVIEW_MAX_TEXT_BYTES = 8_192;
const DATASET_QUALITY_REVIEW_MAX_ROW_BYTES = 32 * 1024;
const DATASET_QUALITY_REPORT_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const DATASET_QUALITY_REASON_CODE_SET = new Set<string>(
  DATASET_QUALITY_REASON_CODES,
);

function isDatasetQualityReport(value: unknown): value is DatasetQualityReport {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "1" ||
    !["ready", "needs-attention", "blocked"].includes(String(value.status)) ||
    typeof value.reportFingerprint !== "string" ||
    !DATASET_QUALITY_REPORT_FINGERPRINT_PATTERN.test(value.reportFingerprint) ||
    !isRecord(value.policy) ||
    !isRecord(value.mapping) ||
    !Array.isArray(value.fields) ||
    value.fields.length > 128 ||
    !isRecord(value.distributions) ||
    !isRecord(value.counts) ||
    !Number.isInteger(value.counts.inputRows) ||
    !Number.isInteger(value.counts.acceptedRows) ||
    !Number.isInteger(value.counts.quarantinedRows) ||
    Number(value.counts.inputRows) < 0 ||
    Number(value.counts.acceptedRows) < 0 ||
    Number(value.counts.quarantinedRows) < 0 ||
    Number(value.counts.acceptedRows) + Number(value.counts.quarantinedRows) !==
      Number(value.counts.inputRows) ||
    !isRecord(value.reasonCounts) ||
    !Array.isArray(value.samples) ||
    value.samples.length > DATASET_QUALITY_REASON_CODES.length * 100 ||
    typeof value.reviewRequired !== "boolean" ||
    typeof value.approvalAllowed !== "boolean"
  ) {
    return false;
  }
  if (
    value.inspection !== undefined &&
    (!isRecord(value.inspection) ||
      typeof value.inspection.taskType !== "string" ||
      !["checked", "not-applicable"].includes(
        String(value.inspection.textContent),
      ) ||
      value.inspection.imagePixels !== "not-inspected" ||
      !Array.isArray(value.inspection.checkedSurfaces) ||
      value.inspection.checkedSurfaces.length > 16 ||
      value.inspection.checkedSurfaces.some(
        (surface) => typeof surface !== "string" || surface.length > 256,
      ) ||
      !Array.isArray(value.inspection.limitations) ||
      value.inspection.limitations.length > 16 ||
      value.inspection.limitations.some(
        (limitation) =>
          typeof limitation !== "string" || limitation.length > 1024,
      ))
  ) {
    return false;
  }
  return value.samples.every(
    (sample) =>
      isRecord(sample) &&
      typeof sample.sourceArtifactId === "string" &&
      Number.isInteger(sample.sourceRowIndex) &&
      Array.isArray(sample.reasonCodes) &&
      sample.reasonCodes.length > 0 &&
      sample.reasonCodes.every(
        (reason) =>
          typeof reason === "string" &&
          DATASET_QUALITY_REASON_CODE_SET.has(reason),
      ) &&
      Array.isArray(sample.fieldNames) &&
      sample.fieldNames.length <= 32 &&
      sample.fieldNames.every(
        (field) => typeof field === "string" && field.length <= 128,
      ) &&
      typeof sample.summary === "string" &&
      sample.summary.length <= 1024 &&
      !("row" in sample) &&
      !("value" in sample),
  );
}

function fingerprintsMatch(left: string, right: string): boolean {
  if (
    !DATASET_QUALITY_REPORT_FINGERPRINT_PATTERN.test(left) ||
    !DATASET_QUALITY_REPORT_FINGERPRINT_PATTERN.test(right)
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function parseDatasetQualityReviewLineId(
  value: unknown,
):
  | { kind: "ready" | "set-aside"; reason?: DatasetQualityReasonCode }
  | undefined {
  if (value === "ready" || value === "set-aside") {
    return { kind: value };
  }
  if (typeof value !== "string" || !value.startsWith("reason:")) {
    return undefined;
  }
  const reason = value.slice("reason:".length);
  return DATASET_QUALITY_REASON_CODE_SET.has(reason)
    ? { kind: "set-aside", reason: reason as DatasetQualityReasonCode }
    : undefined;
}

function boundedReviewValue(
  value: unknown,
  budget: { remaining: number },
  depth = 0,
): unknown {
  if (budget.remaining <= 0) return "[additional value omitted]";
  if (depth > DATASET_QUALITY_REVIEW_MAX_DEPTH) return "[nested value]";
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    budget.remaining -= Math.min(String(value).length, budget.remaining);
    return value;
  }
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    if (
      bytes <= DATASET_QUALITY_REVIEW_MAX_TEXT_BYTES &&
      bytes <= budget.remaining
    ) {
      budget.remaining -= bytes;
      return value;
    }
    const allowed = Math.min(
      DATASET_QUALITY_REVIEW_MAX_TEXT_BYTES,
      budget.remaining,
    );
    const suffix = " [truncated]";
    const prefix = Buffer.from(value, "utf8")
      .subarray(0, Math.max(0, allowed - Buffer.byteLength(suffix)))
      .toString("utf8");
    budget.remaining -= allowed;
    return prefix + suffix;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => boundedReviewValue(item, budget, depth + 1));
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(
      0,
      DATASET_QUALITY_REVIEW_MAX_FIELDS,
    )) {
      if (budget.remaining <= 0) {
        result.additional_fields = "[additional fields omitted]";
        break;
      }
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        continue;
      }
      result[key.slice(0, 128)] = boundedReviewValue(item, budget, depth + 1);
    }
    return result;
  }
  return boundedReviewValue(String(value), budget, depth);
}

function readDatasetQualityReviewJsonlPage(
  content: Uint8Array,
  line: ReturnType<typeof parseDatasetQualityReviewLineId> & {},
  page: number,
  totalRows: number,
): Promise<readonly DatasetQualityReviewRow[]> {
  const offset = page * DATASET_QUALITY_REVIEW_PAGE_SIZE;
  const rows: DatasetQualityReviewRow[] = [];
  let matchingIndex = 0;
  let physicalIndex = 0;
  for (const rawLine of datasetQualityReviewJsonlLines(content)) {
    if (!rawLine.trim()) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      throw new Error("Dataset preparation review data is invalid.");
    }
    if (!isRecord(parsed)) {
      throw new Error(
        "Dataset preparation review data contains an invalid row.",
      );
    }
    let values: Record<string, unknown>;
    let matches = line.kind === "ready";
    if (line.kind === "ready") {
      values = parsed;
    } else {
      const reasons = Array.isArray(parsed.reasonCodes)
        ? parsed.reasonCodes.filter(
            (reason): reason is string => typeof reason === "string",
          )
        : [];
      matches = line.reason ? reasons.includes(line.reason) : true;
      if (
        typeof parsed.sourceArtifactId !== "string" ||
        !Number.isSafeInteger(parsed.sourceRowIndex) ||
        !isRecord(parsed.row) ||
        reasons.some((reason) => !DATASET_QUALITY_REASON_CODE_SET.has(reason))
      ) {
        throw new Error(
          "Dataset preparation review data contains invalid lineage.",
        );
      }
      values = {
        sourceArtifactId: parsed.sourceArtifactId,
        sourceRowIndex: parsed.sourceRowIndex,
        reasonCodes: reasons,
        ...parsed.row,
      };
    }
    if (matches) {
      if (
        matchingIndex >= offset &&
        rows.length < DATASET_QUALITY_REVIEW_PAGE_SIZE
      ) {
        const bounded = boundedReviewValue(values, {
          remaining: DATASET_QUALITY_REVIEW_MAX_ROW_BYTES,
        });
        if (!isRecord(bounded)) {
          throw new Error(
            "Dataset preparation review data contains an invalid row.",
          );
        }
        const rowFingerprint = `sha256:${createHash("sha256")
          .update(rawLine)
          .digest("hex")}` as const;
        rows.push({
          rowIndex: physicalIndex,
          rowFingerprint,
          values: bounded,
        });
      }
      matchingIndex += 1;
      if (
        rows.length === DATASET_QUALITY_REVIEW_PAGE_SIZE &&
        matchingIndex >=
          Math.min(totalRows, offset + DATASET_QUALITY_REVIEW_PAGE_SIZE)
      ) {
        break;
      }
    }
    physicalIndex += 1;
  }
  return Promise.resolve(rows);
}

function validateDatasetQualityReviewJsonl(
  content: Uint8Array,
  expectedRows: number,
): void {
  let rows = 0;
  for (const rawLine of datasetQualityReviewJsonlLines(content)) {
    if (!rawLine.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(rawLine);
    } catch {
      throw new Error("Dataset preparation review data is invalid.");
    }
    if (!isRecord(value)) {
      throw new Error(
        "Dataset preparation review data contains an invalid row.",
      );
    }
    rows += 1;
    if (rows > expectedRows) {
      throw new Error(
        "Dataset preparation review row count does not match the quality report.",
      );
    }
  }
  if (rows !== expectedRows) {
    throw new Error(
      "Dataset preparation review row count does not match the quality report.",
    );
  }
}

function* datasetQualityReviewJsonlLines(
  content: Uint8Array,
): Generator<string> {
  if (
    !(content instanceof Uint8Array) ||
    content.byteLength <= 0 ||
    content.byteLength > DATASET_QUALITY_REVIEW_MAX_BYTES
  ) {
    throw new Error("Dataset preparation review data is unavailable.");
  }
  const bytes = Buffer.from(
    content.buffer,
    content.byteOffset,
    content.byteLength,
  );
  let start = 0;
  for (let end = 0; end <= bytes.length; end += 1) {
    if (end < bytes.length && bytes[end] !== 0x0a) continue;
    if (end === bytes.length && start === end) break;
    let lineEnd = end;
    if (lineEnd > start && bytes[lineEnd - 1] === 0x0d) lineEnd -= 1;
    const lineBytes = bytes.subarray(start, lineEnd);
    if (lineBytes.byteLength > DATASET_QUALITY_REVIEW_MAX_LINE_BYTES) {
      throw new Error(
        "Dataset preparation review data contains an oversized row.",
      );
    }
    yield lineBytes.toString("utf8");
    start = end + 1;
  }
}

async function readBoundedOutput(
  path: string,
  maximumBytes: number,
  label: string,
): Promise<Uint8Array> {
  const descriptor = await lstat(path);
  if (!descriptor.isFile() || descriptor.size > maximumBytes) {
    throw new Error(
      `Dataset preparation ${label} is not a bounded regular file.`,
    );
  }
  return new Uint8Array(await readFile(path));
}

function validateQuarantineOutput(
  bytes: Uint8Array,
  report: DatasetQualityReport,
  sourceArtifactIds: string[],
): void {
  const allowedSources = new Set(sourceArtifactIds);
  const lines = Buffer.from(bytes)
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length !== report.counts.quarantinedRows) {
    throw new Error(
      "Dataset preparation quarantine count does not match its report.",
    );
  }
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error("Dataset preparation quarantine is invalid.");
    }
    if (
      !isRecord(value) ||
      typeof value.sourceArtifactId !== "string" ||
      !allowedSources.has(value.sourceArtifactId) ||
      !Number.isInteger(value.sourceRowIndex) ||
      !Array.isArray(value.reasonCodes) ||
      value.reasonCodes.length === 0 ||
      value.reasonCodes.some(
        (reason) =>
          typeof reason !== "string" ||
          !DATASET_QUALITY_REASON_CODE_SET.has(reason),
      ) ||
      !isRecord(value.row)
    ) {
      throw new Error(
        "Dataset preparation quarantine contains invalid row lineage.",
      );
    }
  }
}

type DatasetSplitOutputRole = "train" | "validation" | "test";

function validateRuntimeSplitOutputs(
  runtimeResult: PrepareTrainingDatasetResult,
): void {
  const counts: Record<DatasetSplitOutputRole, number> = {
    train: runtimeResult.summary.trainRowCount,
    validation: runtimeResult.summary.validationRowCount ?? 0,
    test: runtimeResult.summary.testRowCount,
  };
  const splitOutputs = runtimeResult.outputs.filter(
    (output): output is typeof output & { role: DatasetSplitOutputRole } =>
      output.role === "train" ||
      output.role === "validation" ||
      output.role === "test",
  );
  if (
    splitOutputs.length === 0 &&
    runtimeResult.summary.validationRowCount === undefined
  ) {
    return;
  }
  const roles = new Set(splitOutputs.map((output) => output.role));
  if (roles.size !== splitOutputs.length) {
    throw new Error("Dataset preparation returned duplicate split outputs.");
  }
  if (
    counts.train + counts.validation + counts.test !==
    runtimeResult.summary.datasetRowCount
  ) {
    throw new Error(
      "Dataset preparation split counts do not match the dataset total.",
    );
  }
  for (const role of ["train", "validation", "test"] as const) {
    const output = splitOutputs.find((candidate) => candidate.role === role);
    if (counts[role] > 0 !== Boolean(output)) {
      throw new Error(
        "Dataset preparation " + role + " output does not match its row count.",
      );
    }
    const metadataCount = output?.metadata?.rowCount;
    if (metadataCount !== undefined && metadataCount !== counts[role]) {
      throw new Error(
        "Dataset preparation " +
          role +
          " output metadata does not match its row count.",
      );
    }
  }
}

function isPrepareTrainingDatasetResult(
  value: unknown,
): value is PrepareTrainingDatasetResult {
  if (
    !isRecord(value) ||
    !Array.isArray(value.outputs) ||
    !isDatasetPreparationSummary(value.summary)
  ) {
    return false;
  }

  return value.outputs.every(
    (output) =>
      isRecord(output) &&
      typeof output.name === "string" &&
      typeof output.outputHandle === "string" &&
      !("tempPath" in output) &&
      typeof output.mediaType === "string" &&
      (output.role === undefined || typeof output.role === "string") &&
      (output.metadata === undefined || isRecord(output.metadata)),
  );
}

function normalizeDatasetPreparationCommand(
  command: PrepareTrainingDatasetFromArtifactsCommand,
): PrepareTrainingDatasetFromArtifactsCommand {
  const rawTaskType =
    isRecord(command.recipe.task) &&
    typeof command.recipe.task.taskType === "string"
      ? command.recipe.task.taskType
      : DEFAULT_DATASET_PREPARATION_TASK_TYPE;
  const taskType = isDatasetPreparationTaskType(rawTaskType)
    ? rawTaskType
    : DEFAULT_DATASET_PREPARATION_TASK_TYPE;
  const defaultTaskRecipe = createDefaultDatasetPreparationTaskRecipe(taskType);
  const taskRecipe = isRecord(command.recipe.task)
    ? { ...defaultTaskRecipe, ...command.recipe.task }
    : defaultTaskRecipe;
  const textInputMode = command.preparation
    ? command.preparation.generationMode === "none"
      ? "provided"
      : "generate"
    : taskRecipe.textInputMode === "generate" ||
        taskRecipe.textInputMode === "provided"
      ? taskRecipe.textInputMode
      : defaultTaskRecipe.textInputMode;
  const defaultGenerationModel =
    resolveDefaultDatasetPreparationTextGenerationModel(taskType);
  const shouldGenerateText = textInputMode === "generate";
  const generation = command.recipe.generation;
  const promptTemplate = shouldGenerateText
    ? generation?.promptTemplate?.trim() ||
      resolveDefaultDatasetPreparationPromptTemplate(taskType)
    : generation?.promptTemplate;
  const model = generation?.model ?? defaultGenerationModel;
  const modelId =
    model?.modelId?.trim() ||
    (shouldGenerateText ? defaultGenerationModel?.modelId : undefined) ||
    model?.modelId;

  const normalizedGeneration =
    shouldGenerateText && model && modelId
      ? {
          ...generation,
          mode: generation?.mode ?? ("qa" as const),
          promptTemplate,
          model: {
            ...model,
            modelId,
            inferenceMode:
              model.inferenceMode === "auto" && shouldGenerateText
                ? (defaultGenerationModel?.inferenceMode ?? model.inferenceMode)
                : model.inferenceMode,
            device:
              model.device ??
              (shouldGenerateText ? defaultGenerationModel?.device : undefined),
            torchDtype:
              model.torchDtype ??
              (shouldGenerateText
                ? defaultGenerationModel?.torchDtype
                : undefined),
          },
        }
      : command.preparation
        ? undefined
        : generation;

  return {
    ...command,
    recipe: {
      ...command.recipe,
      task: {
        ...taskRecipe,
        textInputMode,
      },
      ...(normalizedGeneration
        ? { generation: normalizedGeneration }
        : { generation: undefined }),
    },
  };
}

function compileRuntimeStructuredOutput(
  command: PrepareTrainingDatasetFromArtifactsCommand,
):
  | {
      ok: true;
      value: NonNullable<
        NonNullable<
          PrepareTrainingDatasetRequest["runtime"]
        >["structuredOutput"]
      >;
    }
  | { ok: false; message: string } {
  const taskType =
    command.recipe.task?.taskType ?? DEFAULT_DATASET_PREPARATION_TASK_TYPE;
  const taskRecipe = command.recipe.task;
  const multiLabel =
    taskRecipe?.taskType === "llm-classification" &&
    taskRecipe.multiLabel === true;
  const allowedLabels =
    "labelSet" in (taskRecipe ?? {}) &&
    Array.isArray((taskRecipe as { labelSet?: unknown }).labelSet)
      ? (taskRecipe as { labelSet: string[] }).labelSet
      : undefined;
  const requested = command.recipe.generation?.structuredOutput;
  const resolved = resolveDatasetPreparationVisualOutputShape(
    taskType,
    requested?.visualShape,
    { multiLabel },
  );
  const compiled = compileDatasetPreparationVisualOutputShape(resolved.shape, {
    taskType,
    outputFormat: command.output.format,
    multiLabel,
    allowedLabels,
  });
  if (!compiled.ok) {
    return {
      ok: false,
      message:
        compiled.diagnostics[0]?.message ??
        "The generated output layout is invalid.",
    };
  }
  const constrainedDecoding = requested?.constrainedDecoding === true;
  if (constrainedDecoding && !compiled.value.decoderCompatible) {
    return {
      ok: false,
      message:
        "Token-level JSON constraints require a fixed set of output fields.",
    };
  }
  if (
    constrainedDecoding &&
    command.recipe.generation?.model.inferenceMode === "text2text"
  ) {
    return {
      ok: false,
      message:
        "Token-level JSON constraints require a causal or chat generation model.",
    };
  }
  const fingerprintInput = {
    schema: compiled.value.envelopeSchema,
    example: compiled.value.exampleEnvelope,
    payloadKey: compiled.value.payloadKey,
    purposePaths: compiled.value.purposePaths,
    constrainedDecoding,
  };
  return {
    ok: true,
    value: {
      ...fingerprintInput,
      schemaFingerprint: createHash("sha256")
        .update(canonicalRuntimeJson(fingerprintInput), "utf8")
        .digest("hex"),
    },
  };
}

function resolveAdaptiveCommandForStagedSources(
  command: PrepareTrainingDatasetFromArtifactsCommand,
  sourceInputs: PrepareTrainingDatasetRequest["sourceInputs"],
): PrepareTrainingDatasetFromArtifactsCommand {
  const taskType =
    command.recipe.task?.taskType ?? DEFAULT_DATASET_PREPARATION_TASK_TYPE;
  const capabilities = sourceInputs.map((source) => {
    const capability = resolveDatasetPreparationSourceCapability({
      fileName: source.originalName ?? source.localPath,
      mediaType: source.mediaType,
    });
    if (!capability) {
      throw new Error(
        "A selected source no longer has a supported preparation format.",
      );
    }
    return capability;
  });
  const resolution = resolveDatasetPreparationAdaptivePlan({
    taskType,
    sources: capabilities,
  });
  if (resolution.status !== "ready") {
    throw new Error(
      resolution.action
        ? `${resolution.message} ${resolution.action}`
        : resolution.message,
    );
  }

  const isLegacy = command.preparation === undefined;
  const method = isLegacy
    ? normalizeLegacyDatasetPreparationMethod({
        taskType,
        sourceKinds: resolution.sourceKinds,
        sourceCount: sourceInputs.length,
        preset:
          command.advanced?.preset === "standard" ||
          command.advanced?.preset === "better-document-understanding" ||
          command.advanced?.preset === "generate-examples"
            ? command.advanced.preset
            : undefined,
        textInputMode: command.recipe.task?.textInputMode,
      })
    : command.preparation!.method;
  const preparation = createDatasetPreparationExecutionPlan(resolution, method);

  if (
    command.preparation &&
    !isDeepStrictEqual(command.preparation, preparation)
  ) {
    throw new Error(
      "The selected preparation method no longer matches the selected sources and training goal. Choose the method again.",
    );
  }

  const needsDocuments = [
    "fixed-length",
    "topic-aware",
    "structure-aware",
  ].includes(preparation.method);
  const needsFixedChunking = preparation.method === "fixed-length";
  const needsGeneration = preparation.generationMode !== "none";
  const expectedAdvanced = createDatasetPreparationAdvancedConfigForMethod(
    preparation.method,
  );

  if (
    (expectedAdvanced?.semantic?.enabled ||
      expectedAdvanced?.synthetic?.enabled) &&
    !command.quality
  ) {
    throw new Error(
      "Topic-aware and structure-aware preparation require data checks and review.",
    );
  }

  if (needsDocuments && !isRecord(command.recipe.normalization)) {
    throw new Error(
      "Document preparation settings are required for the selected method.",
    );
  }
  if (needsFixedChunking && !isRecord(command.recipe.chunking)) {
    throw new Error(
      "Fixed-length section settings are required for the selected method.",
    );
  }
  if (needsGeneration && !isRecord(command.recipe.generation)) {
    throw new Error(
      "Local generation settings are required for the selected method.",
    );
  }

  if (!isLegacy) {
    if (!needsDocuments && command.recipe.normalization !== undefined) {
      throw new Error(
        "Document cleaning settings are not used by the selected preparation method.",
      );
    }
    if (!needsFixedChunking && command.recipe.chunking !== undefined) {
      throw new Error(
        "Section size and overlap are not used by the selected preparation method.",
      );
    }
    if (!needsGeneration && command.recipe.generation !== undefined) {
      throw new Error(
        "Model and prompt settings are not used by the selected preparation method.",
      );
    }
    validateAdaptiveAdvancedSettings(
      preparation.method,
      command.advanced,
      expectedAdvanced,
    );
  }

  return {
    ...command,
    preparation,
    recipe: {
      task: {
        ...command.recipe.task,
        taskType,
        textInputMode: needsGeneration ? "generate" : "provided",
      },
      ...(needsDocuments
        ? { normalization: command.recipe.normalization }
        : {}),
      ...(needsFixedChunking ? { chunking: command.recipe.chunking } : {}),
      ...(needsGeneration ? { generation: command.recipe.generation } : {}),
    },
    ...(expectedAdvanced
      ? { advanced: isLegacy ? expectedAdvanced : command.advanced }
      : { advanced: undefined }),
  };
}

function validateAdaptiveAdvancedSettings(
  method: NonNullable<PrepareTrainingDatasetRequest["preparation"]>["method"],
  actual: PrepareTrainingDatasetRequest["advanced"],
  expected: PrepareTrainingDatasetRequest["advanced"],
): void {
  if (!expected) {
    if (actual !== undefined) {
      throw new Error(
        "Advanced document settings are not used by the selected preparation method.",
      );
    }
    return;
  }
  if (!actual) {
    throw new Error(
      "Compatible Advanced settings are required for the selected preparation method.",
    );
  }
  if (method === "topic-aware") {
    if (
      actual.preset !== "topic-aware" ||
      actual.content?.strategy !== "semantic" ||
      actual.content.layoutEnabled !== undefined ||
      actual.semantic?.enabled !== true ||
      actual.synthetic?.enabled !== true
    ) {
      throw new Error(
        "Topic-aware preparation contains an incompatible Advanced setting.",
      );
    }
    return;
  }
  if (
    method !== "structure-aware" ||
    actual.preset !== "structure-aware" ||
    actual.content?.strategy !== "layout" ||
    actual.content.layoutEnabled !== true ||
    actual.content.semanticBoundaryThreshold !== undefined ||
    actual.semantic?.enabled !== true ||
    actual.synthetic?.enabled !== true
  ) {
    throw new Error(
      "Structure-aware preparation contains an incompatible Advanced setting.",
    );
  }
}

export class PrepareTrainingDatasetFromArtifactsUseCase {
  private readonly runtimeTaskRegistry: RuntimeTaskRegistryPort;
  private readonly storageBindings: ArtifactStorageBindingPort;
  private readonly storage: ArtifactObjectStoragePort;
  private readonly artifactRepoStorage?: ArtifactRepoStoragePort;
  private readonly artifactCatalog?: ArtifactCatalogReadPort;
  private readonly taskPowerLifecycle: TaskPowerLifecyclePort;
  private readonly runtimeCapabilityGuard?: Pick<
    RuntimeCapabilityGuardService,
    "requireCapabilityReady"
  >;
  private readonly datasetQualityPolicyProvider?: DatasetQualityPolicyProviderPort;
  private readonly datasetVersionFinalizer?: DatasetVersionFinalizationService;
  private readonly datasetVersionHasher?: DatasetVersionHasherPort;
  private readonly now: () => string;
  private readonly runtimeWorkingDirsByRequestId = new Map<string, string>();
  private readonly commandByRequestId = new Map<
    string,
    PrepareTrainingDatasetFromArtifactsCommand
  >();
  private readonly materializedResultsByRequestId = new Map<
    string,
    PrepareTrainingDatasetFromArtifactsValue
  >();
  private readonly taskScopeByRequestId = new Map<
    string,
    { workspaceId: string; organizationId?: string; principalId?: string }
  >();
  private readonly runtimeQualityByRequestId = new Map<
    string,
    DatasetQualityRuntimeConfig
  >();
  private readonly pendingQualityReviewsByRequestId = new Map<
    string,
    PendingDatasetQualityReview
  >();
  private readonly sourceVersionLineageByRequestId = new Map<
    string,
    readonly DatasetVersionSource[]
  >();

  public constructor(
    dependencies: PrepareTrainingDatasetFromArtifactsUseCaseDependencies,
  ) {
    this.runtimeTaskRegistry = dependencies.runtimeTaskRegistry;
    this.storageBindings = dependencies.storageBindings;
    this.storage = dependencies.storage;
    this.artifactRepoStorage = dependencies.artifactRepoStorage;
    this.artifactCatalog = dependencies.artifactCatalog;
    this.taskPowerLifecycle = dependencies.taskPowerLifecycle;
    this.runtimeCapabilityGuard = dependencies.runtimeCapabilityGuard;
    this.datasetQualityPolicyProvider =
      dependencies.datasetQualityPolicyProvider;
    this.datasetVersionFinalizer = dependencies.datasetVersioning?.finalizer;
    this.datasetVersionHasher = dependencies.datasetVersioning?.hasher;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public async startPrepareTrainingDataset(
    command: PrepareTrainingDatasetFromArtifactsCommand,
    context?: ApplicationRequestContext,
  ): Promise<
    ContractResult<{
      requestId: string;
      taskType: string;
      accepted: true;
      status: "queued" | "running";
      startedAt?: string;
      updatedAt?: string;
      metadata?: Record<string, unknown>;
    }>
  > {
    if (!isWorkspaceId(context?.workspaceId)) {
      return createFailureResult(
        createContractError(
          "validation",
          "Workspace id is required for dataset preparation.",
        ),
        context,
      );
    }

    const commandValidationError = validateDatasetPreparationCommand(command);
    if (commandValidationError) {
      return createFailureResult(
        createContractError("validation", commandValidationError),
        context,
      );
    }

    try {
      await this.runtimeCapabilityGuard?.requireCapabilityReady(
        "dataset-preparation",
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "unavailable"
      ) {
        return createFailureResult(
          createContractError("unavailable", error.message, {
            details: (error as { details?: Record<string, unknown> }).details,
          }),
          context,
        );
      }
      throw error;
    }

    let normalizedCommand = normalizeDatasetPreparationCommand(command);
    let quality: PrepareTrainingDatasetRequest["quality"];
    if (normalizedCommand.quality) {
      if (!this.datasetQualityPolicyProvider) {
        return createFailureResult(
          createContractError(
            "unavailable",
            "Data quality policy is unavailable. Dataset preparation was not started.",
          ),
          context,
        );
      }
      try {
        const effectivePolicy =
          await this.datasetQualityPolicyProvider.resolveDatasetQualityPolicy({
            workspaceId: context.workspaceId,
            ...(context.organizationId
              ? { organizationId: String(context.organizationId) }
              : {}),
            requestedPolicy: normalizedCommand.quality.policy,
          });
        quality = {
          requestedPolicy: normalizedCommand.quality.policy,
          effectivePolicy,
          reviewRequired: normalizedCommand.quality.reviewRequired ?? true,
        };
      } catch (error) {
        return createFailureResult(
          createContractError(
            "validation",
            error instanceof Error
              ? error.message
              : "Data quality settings are not allowed by workspace policy.",
          ),
          context,
        );
      }
    }
    const staged = await this.stageRuntimeInputs(normalizedCommand, context);
    if (!staged.ok) {
      return staged;
    }

    try {
      normalizedCommand = resolveAdaptiveCommandForStagedSources(
        normalizedCommand,
        staged.value.sourceInputs,
      );
    } catch (error) {
      await rm(staged.value.runtimeWorkingDir, {
        recursive: true,
        force: true,
      });
      return createFailureResult(
        createContractError(
          "validation",
          error instanceof Error
            ? error.message
            : "The selected preparation method is not compatible with these sources.",
        ),
        context,
      );
    }

    const runtimeStructuredOutput =
      compileRuntimeStructuredOutput(normalizedCommand);
    if (!runtimeStructuredOutput.ok) {
      await rm(staged.value.runtimeWorkingDir, {
        recursive: true,
        force: true,
      });
      return createFailureResult(
        createContractError("validation", runtimeStructuredOutput.message),
        context,
      );
    }

    const runtimeRequest: PrepareTrainingDatasetRequest = {
      workspaceId: context.workspaceId,
      sourceInputs: staged.value.sourceInputs,
      preparation: normalizedCommand.preparation,
      recipe: normalizedCommand.recipe,
      split: normalizedCommand.split,
      output: normalizedCommand.output,
      ...(quality ? { quality } : {}),
      ...(normalizedCommand.advanced
        ? { advanced: normalizedCommand.advanced }
        : {}),
      runtime: {
        runtimeWorkingDirectory: staged.value.runtimeWorkingDir,
        structuredOutput: runtimeStructuredOutput.value,
      },
    };

    try {
      const started = await this.runtimeTaskRegistry.startTask({
        requestId: context?.requestId,
        taskType: TaskType.DATASET_PREPARATION,
        payload: runtimeRequest,
        workspaceId: context.workspaceId,
        metadata: {
          workspaceId: context.workspaceId,
          ...(context.organizationId
            ? { organizationId: String(context.organizationId) }
            : {}),
        },
      });
      if (
        typeof started.requestId !== "string" ||
        started.requestId.trim().length === 0
      ) {
        await rm(staged.value.runtimeWorkingDir, {
          recursive: true,
          force: true,
        });
        return createFailureResult(
          createContractError(
            "internal",
            "Dataset preparation start response missing requestId.",
          ),
          context,
        );
      }
      this.runtimeWorkingDirsByRequestId.set(
        started.requestId,
        staged.value.runtimeWorkingDir,
      );
      this.commandByRequestId.set(started.requestId, normalizedCommand);
      if (this.datasetVersionFinalizer) {
        this.sourceVersionLineageByRequestId.set(
          started.requestId,
          staged.value.sourceVersionLineage,
        );
      }
      if (quality) {
        this.runtimeQualityByRequestId.set(started.requestId, quality);
      }
      this.taskScopeByRequestId.set(started.requestId, {
        workspaceId: context.workspaceId,
        ...(context.organizationId
          ? { organizationId: String(context.organizationId) }
          : {}),
        ...(context.principalId
          ? { principalId: String(context.principalId) }
          : {}),
      });
      try {
        await this.taskPowerLifecycle.startTask(
          started.requestId,
          TaskType.DATASET_PREPARATION,
        );
      } catch {
        // Blocker startup failures must not fail dataset preparation.
      }
      return createSuccessResult(
        {
          requestId: started.requestId,
          taskType: "prepare-training-dataset",
          accepted: true,
          status: "queued",
        },
        context,
      );
    } catch (error) {
      await rm(staged.value.runtimeWorkingDir, {
        recursive: true,
        force: true,
      });
      const message =
        error instanceof Error
          ? error.message
          : "Failed to start dataset preparation.";
      const normalizedMessage = message.includes(
        "Python runtime failed to start or become ready",
      )
        ? `Python runtime could not be started before dataset preparation. ${message}`
        : message;
      return createFailureResult(
        createContractError("internal", normalizedMessage),
        context,
      );
    }
  }

  public async readPrepareTrainingDataset(
    requestId: string,
    context?: ApplicationRequestContext,
  ): Promise<
    ContractResult<
      | RuntimeTaskStatusRecord
      | {
          requestId: string;
          taskType: string;
          status: "succeeded" | "review-required";
          result: PrepareTrainingDatasetFromArtifactsValue;
        }
    >
  > {
    try {
      if (!isWorkspaceId(context?.workspaceId)) {
        return createFailureResult(
          createContractError(
            "validation",
            "Workspace id is required for dataset preparation status reads.",
          ),
          context,
        );
      }
      const recordedScope = this.taskScopeByRequestId.get(requestId);
      if (recordedScope && !this.isRecordedScopeOwned(recordedScope, context)) {
        return createFailureResult(
          createContractError(
            "not-found",
            "Dataset preparation task was not found.",
          ),
          context,
        );
      }
      const pendingReview =
        this.pendingQualityReviewsByRequestId.get(requestId);
      if (pendingReview) {
        return createSuccessResult(
          {
            requestId,
            taskType: "prepare-training-dataset",
            status: "review-required",
            result: pendingReview.evidence,
          },
          context,
        );
      }
      const cached = this.materializedResultsByRequestId.get(requestId);
      if (cached) {
        return createSuccessResult(
          {
            requestId,
            taskType: "prepare-training-dataset",
            status: "succeeded",
            result: cached,
          },
          context,
        );
      }
      const statusRecord =
        await this.runtimeTaskRegistry.getTaskStatus(requestId);
      if (
        "recordType" in statusRecord
          ? statusRecord.recordType !== "not-found"
          : !this.isTaskOwnedByScope(statusRecord, context)
      ) {
        return createFailureResult(
          createContractError(
            "not-found",
            "Dataset preparation task was not found.",
          ),
          context,
        );
      }
      if (statusRecord.status === "succeeded" && statusRecord.data) {
        let terminalStatus: RuntimeTaskStatus = statusRecord.status;
        let retainForReview = false;
        try {
          const command = this.commandByRequestId.get(requestId);
          if (!command) {
            throw new Error(
              `Dataset preparation command context missing for request '${requestId}'.`,
            );
          }
          if (!isPrepareTrainingDatasetResult(statusRecord.data)) {
            throw new Error(
              `Dataset preparation runtime result is invalid for request '${requestId}'.`,
            );
          }
          const runtimeWorkingDirectory =
            this.runtimeWorkingDirsByRequestId.get(requestId);
          if (!runtimeWorkingDirectory) {
            throw new Error(
              "Dataset preparation runtime working directory is unavailable.",
            );
          }
          const quality = this.runtimeQualityByRequestId.get(requestId);
          if (quality?.reviewRequired) {
            try {
              const reviewEvidence = await this.materializeReviewEvidence(
                command,
                statusRecord.data,
                runtimeWorkingDirectory,
                quality,
                context,
              );
              const scope = this.taskScopeByRequestId.get(requestId);
              if (!scope) {
                throw new Error(
                  "Dataset preparation review scope is unavailable.",
                );
              }
              this.pendingQualityReviewsByRequestId.set(requestId, {
                command,
                runtimeResult: statusRecord.data,
                runtimeWorkingDirectory,
                quality,
                evidence: reviewEvidence.value,
                evidenceStorageKeys: reviewEvidence.storageKeys,
                ...(reviewEvidence.reviewStorage
                  ? { reviewStorage: reviewEvidence.reviewStorage }
                  : {}),
                scope,
              });
              retainForReview = true;
              return createSuccessResult(
                {
                  requestId: statusRecord.requestId,
                  taskType: "prepare-training-dataset",
                  status: "review-required",
                  result: reviewEvidence.value,
                },
                context,
              );
            } catch (error) {
              throw error;
            }
          }
          const materialized = await this.materializeRuntimeResult(
            command,
            statusRecord.data,
            runtimeWorkingDirectory,
            context,
          );
          const finalized = await this.finalizeDatasetVersion(
            requestId,
            command,
            statusRecord.data,
            materialized,
            context,
          );
          this.materializedResultsByRequestId.set(requestId, finalized);
          return createSuccessResult(
            {
              requestId: statusRecord.requestId,
              taskType: "prepare-training-dataset",
              status: "succeeded",
              result: finalized,
            },
            context,
          );
        } catch (error) {
          terminalStatus = "failed";
          throw error;
        } finally {
          if (!retainForReview) {
            await this.taskPowerLifecycle.completeTask(
              requestId,
              terminalStatus,
            );
            await this.cleanupRuntimeWorkingDir(requestId);
          }
        }
      }
      if (
        statusRecord.status === "succeeded" ||
        statusRecord.status === "failed" ||
        statusRecord.status === "cancelled" ||
        statusRecord.status === "unknown"
      ) {
        await this.taskPowerLifecycle.completeTask(
          requestId,
          statusRecord.status,
        );
        await this.cleanupRuntimeWorkingDir(requestId);
      }
      return createSuccessResult(statusRecord, context);
    } catch (error) {
      return createFailureResult(
        createContractError(
          "internal",
          error instanceof Error
            ? error.message
            : "Failed to read dataset preparation status.",
        ),
        context,
      );
    }
  }

  public async cancelPrepareTrainingDataset(
    requestId: string,
    context?: ApplicationRequestContext,
  ): Promise<
    ContractResult<{
      requestId: string;
      cancelled: boolean;
      status: "cancelled" | "running" | "unknown";
    }>
  > {
    try {
      if (!isWorkspaceId(context?.workspaceId)) {
        return createFailureResult(
          createContractError(
            "validation",
            "Workspace id is required for dataset preparation cancellation.",
          ),
          context,
        );
      }
      const pendingReview =
        this.pendingQualityReviewsByRequestId.get(requestId);
      if (pendingReview) {
        if (!this.isRecordedScopeOwned(pendingReview.scope, context)) {
          return createFailureResult(
            createContractError(
              "not-found",
              "Dataset preparation task was not found.",
            ),
            context,
          );
        }
        await this.deleteStoredArtifacts(
          [
            ...pendingReview.evidenceStorageKeys,
            ...(pendingReview.reviewStorage
              ? [pendingReview.reviewStorage.key]
              : []),
          ],
          context,
        );
        this.pendingQualityReviewsByRequestId.delete(requestId);
        await this.taskPowerLifecycle.completeTask(requestId, "cancelled");
        await this.cleanupRuntimeWorkingDir(requestId);
        return createSuccessResult(
          {
            requestId,
            cancelled: true,
            status: "cancelled",
          },
          context,
        );
      }
      const statusRecord =
        await this.runtimeTaskRegistry.getTaskStatus(requestId);
      if (
        ("recordType" in statusRecord &&
          statusRecord.recordType === "not-found") ||
        !this.isTaskOwnedByScope(statusRecord, context)
      ) {
        return createFailureResult(
          createContractError(
            "not-found",
            "Dataset preparation task was not found.",
          ),
          context,
        );
      }
      const cancellation = await this.runtimeTaskRegistry.cancelTask(requestId);
      const status =
        cancellation.cancelled || cancellation.status === "cancelled"
          ? "cancelled"
          : cancellation.status === "running"
            ? "running"
            : "unknown";
      if (status === "cancelled") {
        await this.taskPowerLifecycle.completeTask(requestId, "cancelled");
        await this.cleanupRuntimeWorkingDir(requestId);
      }
      return createSuccessResult(
        {
          requestId,
          cancelled: status === "cancelled",
          status,
        },
        context,
      );
    } catch {
      return createFailureResult(
        createContractError(
          "internal",
          "Failed to cancel dataset preparation.",
        ),
        context,
      );
    }
  }

  public async readPreparedDatasetQualityReviewPage(
    input: ReadPreparedDatasetQualityReviewPageInput,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<DatasetQualityReviewPage>> {
    const line = parseDatasetQualityReviewLineId(input?.lineId);
    if (
      !isWorkspaceId(context?.workspaceId) ||
      !isRecord(input) ||
      typeof input.requestId !== "string" ||
      input.requestId.trim().length === 0 ||
      typeof input.reportFingerprint !== "string" ||
      !DATASET_QUALITY_REPORT_FINGERPRINT_PATTERN.test(
        input.reportFingerprint,
      ) ||
      !line ||
      !Number.isSafeInteger(input.page) ||
      input.page < 0
    ) {
      return createFailureResult(
        createContractError(
          "validation",
          "A valid workspace, task, report line, fingerprint, and page are required.",
        ),
        context,
      );
    }
    const pending = this.pendingQualityReviewsByRequestId.get(input.requestId);
    if (!pending || !this.isRecordedScopeOwned(pending.scope, context)) {
      return createFailureResult(
        createContractError(
          "not-found",
          "Dataset preparation review was not found.",
        ),
        context,
      );
    }
    const report = pending.runtimeResult.qualityReport;
    if (
      !isDatasetQualityReport(report) ||
      !fingerprintsMatch(report.reportFingerprint, input.reportFingerprint)
    ) {
      return createFailureResult(
        createContractError(
          "conflict",
          "Dataset preparation review changed. Reload the results and retry.",
        ),
        context,
      );
    }
    const totalRows =
      line.kind === "ready"
        ? report.counts.acceptedRows
        : line.reason
          ? (report.reasonCounts[line.reason] ?? 0)
          : report.counts.quarantinedRows;
    if (
      input.page * DATASET_QUALITY_REVIEW_PAGE_SIZE >= totalRows &&
      totalRows > 0
    ) {
      return createFailureResult(
        createContractError(
          "validation",
          "The requested review page is outside the available rows.",
        ),
        context,
      );
    }
    if (totalRows === 0) {
      return createSuccessResult(
        {
          lineId: input.lineId,
          page: input.page,
          pageSize: DATASET_QUALITY_REVIEW_PAGE_SIZE,
          totalRows,
          rows: [],
        },
        context,
      );
    }
    try {
      const storage =
        line.kind === "ready"
          ? pending.reviewStorage
          : pending.evidence.outputs.local?.quarantine
            ? {
                key: String(
                  pending.evidence.outputs.local.quarantine.storage.key,
                ),
                sha256:
                  pending.evidence.outputs.local.quarantine.storage.checksum
                    ?.algorithm === "sha256"
                    ? pending.evidence.outputs.local.quarantine.storage.checksum
                        .value
                    : undefined,
              }
            : undefined;
      if (!storage) {
        throw new Error("Dataset preparation review data is unavailable.");
      }
      const retrieved = await this.storage.retrieveArtifact<Uint8Array>(
        createRetrieveArtifactRequest(storage.key),
        context,
      );
      if (
        !retrieved.ok ||
        !(retrieved.value.content instanceof Uint8Array) ||
        retrieved.value.content.byteLength === 0 ||
        retrieved.value.content.byteLength > DATASET_QUALITY_REVIEW_MAX_BYTES
      ) {
        throw new Error("Dataset preparation review data is unavailable.");
      }
      if (
        storage.sha256 &&
        createHash("sha256").update(retrieved.value.content).digest("hex") !==
          storage.sha256
      ) {
        throw new Error(
          "Dataset preparation review data failed integrity checks.",
        );
      }
      const rows = await readDatasetQualityReviewJsonlPage(
        retrieved.value.content,
        line,
        input.page,
        totalRows,
      );
      return createSuccessResult(
        {
          lineId: input.lineId,
          page: input.page,
          pageSize: DATASET_QUALITY_REVIEW_PAGE_SIZE,
          totalRows,
          rows,
        },
        context,
      );
    } catch {
      return createFailureResult(
        createContractError(
          "unavailable",
          "Dataset preparation review data could not be read.",
        ),
        context,
      );
    }
  }

  public async approvePreparedTrainingDataset(
    approval: DatasetQualityApprovalRequest,
    context?: ApplicationRequestContext,
  ): Promise<
    ContractResult<{
      requestId: string;
      taskType: "prepare-training-dataset";
      status: "succeeded";
      result: PrepareTrainingDatasetFromArtifactsValue;
    }>
  > {
    if (
      !isWorkspaceId(context?.workspaceId) ||
      !isRecord(approval) ||
      typeof approval.requestId !== "string" ||
      approval.requestId.trim().length === 0 ||
      typeof approval.reportFingerprint !== "string" ||
      !DATASET_QUALITY_REPORT_FINGERPRINT_PATTERN.test(
        approval.reportFingerprint,
      )
    ) {
      return createFailureResult(
        createContractError(
          "validation",
          "A valid workspace, task, and review fingerprint are required.",
        ),
        context,
      );
    }
    const saveNameError = validateDatasetPreparationSaveName(
      approval.outputBaseName,
    );
    if (saveNameError) {
      return createFailureResult(
        createContractError("validation", saveNameError),
        context,
      );
    }
    const pending = this.pendingQualityReviewsByRequestId.get(
      approval.requestId,
    );
    if (!pending || !this.isRecordedScopeOwned(pending.scope, context)) {
      return createFailureResult(
        createContractError(
          "not-found",
          "Dataset preparation review was not found.",
        ),
        context,
      );
    }
    const qualityReport = pending.runtimeResult.qualityReport;
    if (
      !isDatasetQualityReport(qualityReport) ||
      !fingerprintsMatch(
        approval.reportFingerprint,
        qualityReport.reportFingerprint,
      )
    ) {
      return createFailureResult(
        createContractError(
          "conflict",
          "The data review changed. Review the latest results before approving.",
        ),
        context,
      );
    }
    if (!qualityReport.approvalAllowed || qualityReport.status === "blocked") {
      return createFailureResult(
        createContractError(
          "conflict",
          "This dataset is blocked. Correct the data issues before approval.",
        ),
        context,
      );
    }

    try {
      const outputNameWasProvided = approval.outputBaseName !== undefined;
      const approvedOutputBaseName = outputNameWasProvided
        ? approval.outputBaseName!.trim() || undefined
        : pending.command.output.naming?.baseName;
      const approvedCommand = outputNameWasProvided
        ? {
            ...pending.command,
            output: {
              ...pending.command.output,
              naming: {
                ...pending.command.output.naming,
                baseName: approvedOutputBaseName,
              },
            },
          }
        : pending.command;
      const approvedRuntimeResult = outputNameWasProvided
        ? applyApprovedDatasetSaveName(
            pending.runtimeResult,
            approval.outputBaseName!,
          )
        : pending.runtimeResult;
      const materialized = await this.materializeRuntimeResult(
        approvedCommand,
        approvedRuntimeResult,
        pending.runtimeWorkingDirectory,
        context,
      );
      const approved: PrepareTrainingDatasetFromArtifactsValue = {
        ...materialized,
        outputs: {
          ...materialized.outputs,
          local: {
            ...pending.evidence.outputs.local,
            ...materialized.outputs.local,
          },
        },
        qualityReport,
        review: {
          state: "approved",
          reportFingerprint: qualityReport.reportFingerprint,
          approvalAllowed: true,
        },
      };
      const finalized = await this.finalizeDatasetVersion(
        approval.requestId,
        approvedCommand,
        approvedRuntimeResult,
        approved,
        context,
      );
      if (pending.reviewStorage) {
        await this.deleteStoredArtifacts([pending.reviewStorage.key], context);
      }
      this.materializedResultsByRequestId.set(approval.requestId, finalized);
      this.pendingQualityReviewsByRequestId.delete(approval.requestId);
      await this.taskPowerLifecycle.completeTask(
        approval.requestId,
        "succeeded",
      );
      await this.cleanupRuntimeWorkingDir(approval.requestId);
      return createSuccessResult(
        {
          requestId: approval.requestId,
          taskType: "prepare-training-dataset",
          status: "succeeded",
          result: finalized,
        },
        context,
      );
    } catch (error) {
      return createFailureResult(
        createContractError(
          "internal",
          error instanceof Error
            ? error.message
            : "Failed to approve the prepared dataset.",
        ),
        context,
      );
    }
  }

  private async materializeReviewEvidence(
    command: PrepareTrainingDatasetFromArtifactsCommand,
    runtimeResult: PrepareTrainingDatasetResult,
    runtimeWorkingDirectory: string,
    quality: DatasetQualityRuntimeConfig,
    context?: ApplicationRequestContext,
  ): Promise<{
    value: PrepareTrainingDatasetFromArtifactsValue;
    storageKeys: string[];
    reviewStorage?: { key: string; sha256: string };
  }> {
    validateRuntimeSplitOutputs(runtimeResult);
    const report = runtimeResult.qualityReport;
    if (
      !isDatasetQualityReport(report) ||
      !report.reviewRequired ||
      !isDeepStrictEqual(report.policy, quality.effectivePolicy) ||
      report.counts.acceptedRows !== runtimeResult.summary.datasetRowCount ||
      report.counts.quarantinedRows !==
        (runtimeResult.summary.quarantinedRowCount ?? 0) ||
      report.counts.inputRows >
        quality.effectivePolicy.maxRowsPerSource *
          command.sourceArtifactIds.length ||
      report.approvalAllowed !== report.counts.acceptedRows > 0 ||
      (report.status === "blocked") !== (report.counts.acceptedRows === 0)
    ) {
      throw new Error(
        "Dataset preparation returned invalid or mismatched quality evidence.",
      );
    }
    const reportOutputs = runtimeResult.outputs.filter(
      (output) => output.role === "report",
    );
    const quarantineOutputs = runtimeResult.outputs.filter(
      (output) => output.role === "quarantine",
    );
    const reviewOutputs = runtimeResult.outputs.filter(
      (output) => output.role === "review",
    );
    if (
      reportOutputs.length !== 1 ||
      quarantineOutputs.length > 1 ||
      reviewOutputs.length !== (report.counts.acceptedRows > 0 ? 1 : 0) ||
      report.counts.quarantinedRows > 0 !== (quarantineOutputs.length === 1)
    ) {
      throw new Error(
        "Dataset preparation quality evidence outputs are incomplete.",
      );
    }
    const reviewOutput = reviewOutputs[0];
    if (
      reviewOutput &&
      (reviewOutput.mediaType !== "application/x-ndjson" ||
        !isRecord(reviewOutput.metadata) ||
        reviewOutput.metadata.rowCount !== report.counts.acceptedRows ||
        reviewOutput.metadata.reportFingerprint !== report.reportFingerprint)
    ) {
      throw new Error(
        "Dataset preparation review rows do not match the quality report.",
      );
    }

    const storageKeys: string[] = [];
    let reviewStorage: { key: string; sha256: string } | undefined;
    const local: NonNullable<
      PrepareTrainingDatasetFromArtifactsValue["outputs"]["local"]
    > = {};
    try {
      const reportPath = await resolveRuntimeOutputPath(
        runtimeWorkingDirectory,
        reportOutputs[0].outputHandle,
      );
      const reportBytes = await readBoundedOutput(
        reportPath,
        DATASET_QUALITY_REPORT_MAX_BYTES,
        "quality report",
      );
      let parsedReport: unknown;
      try {
        parsedReport = JSON.parse(Buffer.from(reportBytes).toString("utf8"));
      } catch {
        throw new Error("Dataset preparation quality report is invalid.");
      }
      if (
        !isDatasetQualityReport(parsedReport) ||
        !fingerprintsMatch(
          parsedReport.reportFingerprint,
          report.reportFingerprint,
        )
      ) {
        throw new Error(
          "Dataset preparation quality report does not match runtime evidence.",
        );
      }
      const reportName = reportOutputs[0].name + ".json";
      const reportStore = await this.storage.storeArtifact(
        createStoreArtifactRequest(reportBytes, {
          descriptor: {
            key: buildGeneratedDatasetStorageKey(
              reportOutputs[0].name,
              "json",
              this.now(),
            ),
            mediaType: "application/json",
            metadata: {
              workspaceId: context?.workspaceId,
              originalFileName: reportName,
              runtimeRole: "report",
              reportFingerprint: report.reportFingerprint,
            },
          },
        }),
        context,
      );
      if (!reportStore.ok) {
        throw new Error(reportStore.error.message);
      }
      storageKeys.push(String(reportStore.value.key));
      local.report = createStagedArtifactDescriptorFromStorageObjectDescriptor(
        reportStore.value,
        { sourceKind: "runtime", originalName: reportName },
      );
      await rm(reportPath, { force: true });

      const quarantineOutput = quarantineOutputs[0];
      if (quarantineOutput) {
        const quarantinePath = await resolveRuntimeOutputPath(
          runtimeWorkingDirectory,
          quarantineOutput.outputHandle,
        );
        const quarantineBytes = await readBoundedOutput(
          quarantinePath,
          DATASET_QUALITY_QUARANTINE_MAX_BYTES,
          "quality quarantine",
        );
        validateQuarantineOutput(
          quarantineBytes,
          report,
          command.sourceArtifactIds,
        );
        const quarantineName = quarantineOutput.name + ".jsonl";
        const quarantineSha256 = createHash("sha256")
          .update(quarantineBytes)
          .digest("hex");
        const quarantineStore = await this.storage.storeArtifact(
          createStoreArtifactRequest(quarantineBytes, {
            descriptor: {
              key: buildGeneratedDatasetStorageKey(
                quarantineOutput.name,
                "jsonl",
                this.now(),
              ),
              mediaType: "application/x-ndjson",
              checksum: { algorithm: "sha256", value: quarantineSha256 },
              metadata: {
                workspaceId: context?.workspaceId,
                originalFileName: quarantineName,
                runtimeRole: "quarantine",
                reportFingerprint: report.reportFingerprint,
                rowCount: report.counts.quarantinedRows,
              },
            },
          }),
          context,
        );
        if (!quarantineStore.ok) {
          throw new Error(quarantineStore.error.message);
        }
        storageKeys.push(String(quarantineStore.value.key));
        local.quarantine =
          createStagedArtifactDescriptorFromStorageObjectDescriptor(
            quarantineStore.value,
            { sourceKind: "runtime", originalName: quarantineName },
          );
      }

      if (reviewOutput) {
        const reviewPath = await resolveRuntimeOutputPath(
          runtimeWorkingDirectory,
          reviewOutput.outputHandle,
        );
        const reviewBytes = await readBoundedOutput(
          reviewPath,
          DATASET_QUALITY_REVIEW_MAX_BYTES,
          "review rows",
        );
        validateDatasetQualityReviewJsonl(
          reviewBytes,
          report.counts.acceptedRows,
        );
        const reviewName = reviewOutput.name + ".jsonl";
        const reviewSha256 = createHash("sha256")
          .update(reviewBytes)
          .digest("hex");
        const reviewStore = await this.storage.storeArtifact(
          createStoreArtifactRequest(reviewBytes, {
            descriptor: {
              key: buildGeneratedDatasetStorageKey(
                reviewOutput.name,
                "jsonl",
                this.now(),
              ),
              mediaType: "application/x-ndjson",
              checksum: { algorithm: "sha256", value: reviewSha256 },
              metadata: {
                workspaceId: context?.workspaceId,
                originalFileName: reviewName,
                runtimeRole: "review",
                reportFingerprint: report.reportFingerprint,
                rowCount: report.counts.acceptedRows,
              },
            },
          }),
          context,
        );
        if (!reviewStore.ok) {
          throw new Error(reviewStore.error.message);
        }
        reviewStorage = {
          key: String(reviewStore.value.key),
          sha256: reviewSha256,
        };
        await rm(reviewPath, { force: true });
      }

      return {
        value: this.buildResultValue(
          command,
          runtimeResult,
          { local },
          {
            state: "review-required",
            reportFingerprint: report.reportFingerprint,
            approvalAllowed: report.approvalAllowed,
          },
        ),
        storageKeys,
        ...(reviewStorage ? { reviewStorage } : {}),
      };
    } catch (error) {
      await this.deleteStoredArtifacts(
        [...storageKeys, ...(reviewStorage ? [reviewStorage.key] : [])],
        context,
      );
      throw error;
    }
  }

  private async materializeRuntimeResult(
    command: PrepareTrainingDatasetFromArtifactsCommand,
    runtimeResult: PrepareTrainingDatasetResult,
    runtimeWorkingDirectory: string,
    context?: ApplicationRequestContext,
  ): Promise<PrepareTrainingDatasetFromArtifactsValue> {
    validateRuntimeSplitOutputs(runtimeResult);
    const datasetOutput = runtimeResult.outputs.find(
      (output) => output.role === "dataset" || output.role === "artifact",
    );
    if (!datasetOutput) {
      throw new Error(
        "Dataset preparation runtime result is missing a dataset output.",
      );
    }

    const datasetOutputPath = await resolveRuntimeOutputPath(
      runtimeWorkingDirectory,
      datasetOutput.outputHandle,
    );
    await validateDatasetOutput(datasetOutputPath, command.output.format);
    const datasetBytes = new Uint8Array(await readFile(datasetOutputPath));
    const outputDestinations = resolveOutputDestinations(command.output);
    const resultOutputs: PrepareTrainingDatasetFromArtifactsValue["outputs"] =
      {};
    const storedLocalKeys: string[] = [];

    try {
      if (outputDestinations.local || this.datasetVersionFinalizer) {
        const storageKey = buildGeneratedDatasetStorageKey(
          datasetOutput.name,
          command.output.format,
          this.now(),
        );
        const originalFileName = `${datasetOutput.name}.${command.output.format}`;
        const storeDataset = await this.storage.storeArtifact(
          createStoreArtifactRequest(datasetBytes, {
            descriptor: {
              key: storageKey,
              mediaType: datasetOutput.mediaType,
              metadata: {
                workspaceId: context?.workspaceId,
                originalFileName,
                runtimeRole: "dataset",
                ...buildDatasetMetadata(
                  command,
                  runtimeResult.summary,
                  { provider: "local" },
                  datasetOutput.metadata,
                ),
              },
            },
          }),
          context,
        );
        if (!storeDataset.ok) {
          throw new Error(storeDataset.error.message);
        }
        storedLocalKeys.push(String(storeDataset.value.key));
        resultOutputs.local = {
          dataset: createStagedArtifactDescriptorFromStorageObjectDescriptor(
            storeDataset.value,
            {
              sourceKind: "runtime",
              originalName: originalFileName,
            },
          ),
        };
      }

      if (outputDestinations.huggingFace && !this.datasetVersionFinalizer) {
        const artifactRepoStorage = this.artifactRepoStorage;
        if (!artifactRepoStorage) {
          throw new Error(
            "Hugging Face output requested but artifact repository storage is unavailable.",
          );
        }
        const datasetPath = joinRepoPath(
          outputDestinations.huggingFace.pathPrefix,
          `${datasetOutput.name}.${command.output.format}`,
        );
        const publishDataset = await artifactRepoStorage.storeArtifactInRepo(
          createStoreArtifactInRepoRequest(datasetBytes, {
            target: {
              provider: outputDestinations.huggingFace.provider,
              repository: outputDestinations.huggingFace.repository,
              revision: outputDestinations.huggingFace.revision,
              path: datasetPath,
            },
            mediaType: datasetOutput.mediaType,
            metadata: buildDatasetMetadata(
              command,
              runtimeResult.summary,
              {
                provider: "huggingface",
                publication: {
                  repository: outputDestinations.huggingFace.repository,
                  path: datasetPath,
                  revision: outputDestinations.huggingFace.revision,
                },
              },
              datasetOutput.metadata,
            ),
          }),
          context,
        );
        if (!publishDataset.ok) {
          throw new Error(publishDataset.error.message);
        }
        const publishDatasetTarget = publishDataset.value.descriptor.target;
        const verifyPublishedDataset =
          await artifactRepoStorage.hasArtifactInRepo(
            createHasArtifactInRepoRequest(publishDatasetTarget),
            context,
          );
        if (!verifyPublishedDataset.ok) {
          throw new Error(verifyPublishedDataset.error.message);
        }
        resultOutputs.huggingFace = {
          dataset: {
            provider: "huggingface",
            repository: publishDatasetTarget.repository,
            path: publishDatasetTarget.path ?? datasetPath,
            revision: publishDatasetTarget.revision,
            exists: verifyPublishedDataset.value.exists,
            verifiedAt: this.now(),
          },
        };
      }

      const splitOutputs = runtimeResult.outputs.filter(
        (output): output is typeof output & { role: DatasetSplitOutputRole } =>
          output.role === "train" ||
          output.role === "validation" ||
          output.role === "test",
      );
      for (const splitOutput of splitOutputs) {
        const splitOutputPath = await resolveRuntimeOutputPath(
          runtimeWorkingDirectory,
          splitOutput.outputHandle,
        );
        await validateDatasetOutput(splitOutputPath, command.output.format);
        const splitBytes = new Uint8Array(await readFile(splitOutputPath));

        if (
          (outputDestinations.local || this.datasetVersionFinalizer) &&
          resultOutputs.local
        ) {
          const storageKey = buildGeneratedDatasetStorageKey(
            splitOutput.name,
            command.output.format,
            this.now(),
          );
          const originalFileName =
            splitOutput.name + "." + command.output.format;
          const storeSplit = await this.storage.storeArtifact(
            createStoreArtifactRequest(splitBytes, {
              descriptor: {
                key: storageKey,
                mediaType: splitOutput.mediaType,
                metadata: {
                  workspaceId: context?.workspaceId,
                  originalFileName,
                  runtimeRole: splitOutput.role,
                  ...buildDatasetMetadata(
                    command,
                    runtimeResult.summary,
                    { provider: "local" },
                    splitOutput.metadata,
                  ),
                },
              },
            }),
            context,
          );
          if (!storeSplit.ok) {
            throw new Error(storeSplit.error.message);
          }
          storedLocalKeys.push(String(storeSplit.value.key));
          resultOutputs.local[splitOutput.role] =
            createStagedArtifactDescriptorFromStorageObjectDescriptor(
              storeSplit.value,
              {
                sourceKind: "runtime",
                originalName: originalFileName,
              },
            );
        }

        if (
          outputDestinations.huggingFace &&
          !this.datasetVersionFinalizer &&
          resultOutputs.huggingFace
        ) {
          const artifactRepoStorage = this.artifactRepoStorage;
          if (!artifactRepoStorage) {
            throw new Error(
              "Hugging Face output requested but artifact repository storage is unavailable.",
            );
          }
          const splitPath = joinRepoPath(
            outputDestinations.huggingFace.pathPrefix,
            splitOutput.name + "." + command.output.format,
          );
          const publishSplit = await artifactRepoStorage.storeArtifactInRepo(
            createStoreArtifactInRepoRequest(splitBytes, {
              target: {
                provider: outputDestinations.huggingFace.provider,
                repository: outputDestinations.huggingFace.repository,
                revision: outputDestinations.huggingFace.revision,
                path: splitPath,
              },
              mediaType: splitOutput.mediaType,
              metadata: buildDatasetMetadata(
                command,
                runtimeResult.summary,
                {
                  provider: "huggingface",
                  publication: {
                    repository: outputDestinations.huggingFace.repository,
                    path: splitPath,
                    revision: outputDestinations.huggingFace.revision,
                  },
                },
                splitOutput.metadata,
              ),
            }),
            context,
          );
          if (!publishSplit.ok) {
            throw new Error(publishSplit.error.message);
          }
          const publishedTarget = publishSplit.value.descriptor.target;
          const verified = await artifactRepoStorage.hasArtifactInRepo(
            createHasArtifactInRepoRequest(publishedTarget),
            context,
          );
          if (!verified.ok) {
            throw new Error(verified.error.message);
          }
          resultOutputs.huggingFace[splitOutput.role] = {
            provider: "huggingface",
            repository: publishedTarget.repository,
            path: publishedTarget.path ?? splitPath,
            revision: publishedTarget.revision,
            exists: verified.value.exists,
            verifiedAt: this.now(),
          };
        }
      }

      return this.buildResultValue(command, runtimeResult, resultOutputs);
    } catch (error) {
      await this.deleteStoredArtifacts(storedLocalKeys, context);
      throw error;
    }
  }

  private buildResultValue(
    command: PrepareTrainingDatasetFromArtifactsCommand,
    runtimeResult: PrepareTrainingDatasetResult,
    outputs: PrepareTrainingDatasetFromArtifactsValue["outputs"],
    review?: PrepareTrainingDatasetFromArtifactsValue["review"],
  ): PrepareTrainingDatasetFromArtifactsValue {
    const taskRecipe =
      command.recipe.task ?? createDefaultDatasetPreparationTaskRecipe();
    const taskProfile = resolveDatasetPreparationTaskProfileDefinition(
      taskRecipe.taskType,
    );
    return {
      outputs,
      provenance: {
        sourceArtifactIds: command.sourceArtifactIds,
        ...(command.preparation ? { preparation: command.preparation } : {}),
        recipe: command.recipe,
        split: command.split,
        output: command.output,
        datasetPreparationTask: {
          taskType: taskProfile.taskType,
          modelFamily: taskProfile.modelFamily,
          outputSchema: taskProfile.outputSchema,
          runtimeSupport: taskProfile.runtimeSupport,
          compatibleTrainingMethods: [...taskProfile.compatibleTrainingMethods],
          recipe: taskRecipe,
        },
        ...(command.recipe.generation
          ? { generationModelId: command.recipe.generation.model.modelId }
          : {}),
        summary: runtimeResult.summary,
      },
      summary: runtimeResult.summary,
      ...(runtimeResult.qualityReport
        ? { qualityReport: runtimeResult.qualityReport }
        : {}),
      ...(runtimeResult.advancedReport
        ? { advancedReport: runtimeResult.advancedReport }
        : {}),
      ...(review ? { review } : {}),
      warnings: runtimeResult.warnings,
    };
  }

  private async finalizeDatasetVersion(
    requestId: string,
    command: PrepareTrainingDatasetFromArtifactsCommand,
    runtimeResult: PrepareTrainingDatasetResult,
    value: PrepareTrainingDatasetFromArtifactsValue,
    context?: ApplicationRequestContext,
  ): Promise<PrepareTrainingDatasetFromArtifactsValue> {
    const finalizer = this.datasetVersionFinalizer;
    const hasher = this.datasetVersionHasher;
    if (!finalizer || !hasher) return value;
    if (!context?.workspaceId) {
      throw new Error(
        "Workspace scope is required to finalize a dataset version.",
      );
    }
    const local = value.outputs.local;
    if (!local?.dataset) {
      throw new Error(
        "A complete local dataset artifact is required to create a version.",
      );
    }
    const rowCounts: Partial<
      Record<"dataset" | "train" | "validation" | "test" | "quarantine", number>
    > = {
      dataset: runtimeResult.summary.datasetRowCount,
      train: runtimeResult.summary.trainRowCount,
      validation: runtimeResult.summary.validationRowCount ?? 0,
      test: runtimeResult.summary.testRowCount,
      quarantine: runtimeResult.summary.quarantinedRowCount ?? 0,
    };
    const artifacts = (
      Object.entries(local) as Array<
        [
          "dataset" | "train" | "validation" | "test" | "report" | "quarantine",
          StagedArtifactDescriptor | undefined,
        ]
      >
    )
      .filter((entry): entry is [(typeof entry)[0], StagedArtifactDescriptor] =>
        Boolean(entry[1]),
      )
      .map(([role, descriptor]) => ({
        role,
        artifactKey: descriptor.storage.key,
        mediaType: descriptor.storage.mediaType ?? "application/octet-stream",
        sizeBytes: descriptor.storage.sizeBytes,
        checksum: descriptor.storage.checksum,
        ...(role in rowCounts
          ? { rowCount: rowCounts[role as keyof typeof rowCounts] }
          : {}),
      }));
    const qualityReport = runtimeResult.qualityReport;
    const effectivePolicy = qualityReport?.policy;
    const baselineFingerprint = hasher.digest("dataset-quality:baseline:1");
    const taskType =
      command.recipe.task?.taskType ?? DEFAULT_DATASET_PREPARATION_TASK_TYPE;
    const datasetName =
      command.output.naming?.baseName?.trim() || `${taskType}-dataset`;
    let result: Awaited<
      ReturnType<DatasetVersionFinalizationService["finalize"]>
    >;
    try {
      result = await finalizer.finalize(
        {
          workspaceId: context.workspaceId,
          ...(context.organizationId
            ? { organizationId: context.organizationId }
            : {}),
          createdBy: context.principalId?.trim() || "local-user",
          datasetName,
          recipeSnapshot: {
            recipe: command.recipe,
            ...(command.advanced ? { advanced: command.advanced } : {}),
            split: command.split,
            output: {
              format: command.output.format,
              naming: command.output.naming,
            },
            ...(effectivePolicy
              ? { effectiveQualityPolicy: effectivePolicy }
              : {}),
          },
          recipeImplementation: {
            id: "builtin.dataset-preparation",
            version: "1.0.0",
          },
          sources: this.sourceVersionLineageByRequestId.get(requestId) ?? [],
          artifacts,
          split: {
            strategy:
              command.split.shuffle === false ? "ordered" : "source-group",
            seed: command.split.seed ?? 42,
          },
          quality: effectivePolicy
            ? {
                policyId: effectivePolicy.policyId,
                policyVersion: effectivePolicy.revision,
                policyFingerprint: hasher.digest(
                  JSON.stringify(effectivePolicy),
                ),
                reportFingerprint: normalizeDatasetVersionDigest(
                  `sha256:${qualityReport!.reportFingerprint}`,
                ),
              }
            : {
                policyId: "baseline",
                policyVersion: "1",
                policyFingerprint: baselineFingerprint,
                reportFingerprint: baselineFingerprint,
              },
          documentation: {
            name: datasetName,
            summary: `Prepared ${taskType.replaceAll("-", " ")} training dataset.`,
            intendedUses: ["Model training and evaluation."],
            limitations: ["Review source rights and suitability before use."],
          },
          totalRows: runtimeResult.summary.datasetRowCount,
          createdAt: this.now(),
        },
        context,
      );
    } catch (error) {
      await this.deleteStoredArtifacts(
        artifacts
          .filter((artifact) =>
            ["dataset", "train", "validation", "test"].includes(artifact.role),
          )
          .map((artifact) => artifact.artifactKey),
        context,
      );
      throw error;
    }
    return {
      ...value,
      datasetVersion: {
        versionId: result.version.versionId,
        datasetId: result.version.datasetId,
        versionDigest: result.version.versionDigest,
        createdAt: result.version.createdAt,
      },
    };
  }

  private async deleteStoredArtifacts(
    storageKeys: string[],
    context?: ApplicationRequestContext,
  ): Promise<void> {
    for (const storageKey of [...storageKeys].reverse()) {
      try {
        await this.storage.deleteArtifact(
          createDeleteArtifactRequest(storageKey),
          context,
        );
      } catch {
        // Best-effort rollback. The storage adapter owns any retry/audit policy.
      }
    }
  }

  private async cleanupRuntimeWorkingDir(requestId: string): Promise<void> {
    const runtimeWorkingDir = this.runtimeWorkingDirsByRequestId.get(requestId);
    this.runtimeWorkingDirsByRequestId.delete(requestId);
    this.commandByRequestId.delete(requestId);
    this.runtimeQualityByRequestId.delete(requestId);
    this.sourceVersionLineageByRequestId.delete(requestId);
    if (!runtimeWorkingDir) {
      return;
    }
    await rm(runtimeWorkingDir, { recursive: true, force: true });
  }

  private isTaskOwnedByScope(
    statusRecord: RuntimeTaskStatusRecord,
    context: ApplicationRequestContext,
  ): boolean {
    const recordedScope = this.taskScopeByRequestId.get(statusRecord.requestId);
    if (recordedScope !== undefined) {
      return this.isRecordedScopeOwned(recordedScope, context);
    }
    if ("recordType" in statusRecord) {
      return false;
    }
    const metadataWorkspaceId = statusRecord.metadata?.workspaceId;
    const workspaceOwned =
      statusRecord.workspaceId === context.workspaceId ||
      metadataWorkspaceId === context.workspaceId;
    if (!workspaceOwned) {
      return false;
    }
    const metadataOrganizationId = statusRecord.metadata?.organizationId;
    return typeof metadataOrganizationId === "string"
      ? metadataOrganizationId === String(context.organizationId ?? "")
      : true;
  }

  private isRecordedScopeOwned(
    recordedScope: {
      workspaceId: string;
      organizationId?: string;
      principalId?: string;
    },
    context: ApplicationRequestContext,
  ): boolean {
    return (
      recordedScope.workspaceId === context.workspaceId &&
      (recordedScope.organizationId === undefined ||
        recordedScope.organizationId ===
          String(context.organizationId ?? "")) &&
      (recordedScope.principalId === undefined ||
        recordedScope.principalId === String(context.principalId ?? ""))
    );
  }

  private async stageRuntimeInputs(
    command: PrepareTrainingDatasetFromArtifactsCommand,
    context?: ApplicationRequestContext,
  ): Promise<
    ContractResult<{
      runtimeWorkingDir: string;
      sourceInputs: PrepareTrainingDatasetRequest["sourceInputs"];
      sourceVersionLineage: readonly DatasetVersionSource[];
    }>
  > {
    const runtimeWorkingDir = await mkdtemp(
      join(tmpdir(), "ai-system-builder-runtime-"),
    );
    const sourceInputs: PrepareTrainingDatasetRequest["sourceInputs"] = [];
    const sourceVersionLineage: DatasetVersionSource[] = [];
    try {
      const failAndCleanup = async (
        error: ReturnType<typeof createContractError>,
      ) => {
        await rm(runtimeWorkingDir, { recursive: true, force: true });
        return createFailureResult(error, context);
      };
      for (const [
        sourceIndex,
        artifactId,
      ] of command.sourceArtifactIds.entries()) {
        const bindingsResult = resolveArtifactBindingsReadFailureAsEmpty(
          await this.storageBindings.readArtifactStorageBindings(
            { artifactId },
            context,
          ),
        );
        if (!bindingsResult.ok) {
          return failAndCleanup(bindingsResult.error);
        }
        let storageKey = resolveLocalStorageKeyForArtifact(
          artifactId,
          bindingsResult.value.bindings,
        );
        if (!storageKey.trim()) {
          return failAndCleanup(
            createContractError(
              "not-found",
              `Storage locator missing for artifact '${artifactId}'.`,
            ),
          );
        }
        let retrieveResult = await this.storage.retrieveArtifact(
          createRetrieveArtifactRequest(storageKey),
          context,
        );
        if (!retrieveResult.ok) {
          const importedSource = resolveImportedSourceBinding(
            bindingsResult.value.bindings,
          );
          const importedTarget = importedSource?.backing.target;
          if (retrieveResult.error.code !== "not-found" || !importedTarget) {
            return failAndCleanup(retrieveResult.error);
          }
          if (!this.artifactRepoStorage) {
            return failAndCleanup(
              createContractError(
                "unavailable",
                "This repository source must be downloaded before it can be prepared.",
              ),
            );
          }
          const remoteResult =
            await this.artifactRepoStorage.retrieveArtifactFromRepo(
              createRetrieveArtifactFromRepoRequest(importedTarget),
              context,
            );
          if (!remoteResult.ok) {
            return failAndCleanup(
              createContractError(
                remoteResult.error.code,
                "The repository source could not be downloaded for preparation.",
                { details: remoteResult.error.details },
              ),
            );
          }
          const remotePathSegments =
            importedTarget.path?.split("/").filter(Boolean) ?? [];
          const remoteOriginalName =
            remotePathSegments[remotePathSegments.length - 1];
          const localizedResult = await this.storage.storeArtifact(
            createStoreArtifactRequest(remoteResult.value.content, {
              descriptor: {
                key: artifactId,
                mediaType: remoteResult.value.descriptor.mediaType,
                metadata: {
                  originalName: remoteOriginalName,
                  sourceProvider: importedTarget.provider,
                  sourceRepository: importedTarget.repository,
                  sourcePath: importedTarget.path,
                  sourceRevision: importedTarget.revision,
                },
              },
              overwrite: true,
            }),
            context,
          );
          if (!localizedResult.ok) {
            return failAndCleanup(localizedResult.error);
          }
          const bindingResult =
            await this.storageBindings.upsertArtifactStorageBinding(
              {
                binding: {
                  ...(context?.workspaceId
                    ? { workspaceId: createWorkspaceId(context.workspaceId) }
                    : {}),
                  artifactId,
                  backing: {
                    kind: "artifact-object",
                    provider: "local-filesystem",
                    locator: localizedResult.value.key,
                  },
                  role: "primary",
                  createdAt: this.now(),
                },
              },
              context,
            );
          if (!bindingResult.ok) {
            return failAndCleanup(bindingResult.error);
          }
          storageKey = localizedResult.value.key;
          retrieveResult = await this.storage.retrieveArtifact(
            createRetrieveArtifactRequest(storageKey),
            context,
          );
          if (!retrieveResult.ok) {
            return failAndCleanup(retrieveResult.error);
          }
        }
        const descriptorMediaType = retrieveResult.value.descriptor.mediaType;
        const descriptorMetadata = retrieveResult.value.descriptor.metadata;
        const metadataOriginalName =
          descriptorMetadata &&
          typeof descriptorMetadata === "object" &&
          !Array.isArray(descriptorMetadata) &&
          typeof (descriptorMetadata as { originalName?: unknown })
            .originalName === "string"
            ? (descriptorMetadata as { originalName: string }).originalName
            : undefined;
        const artifactCatalog = this.artifactCatalog;
        const catalogRecord = artifactCatalog
          ? await artifactCatalog
              .readArtifactCatalogRecord({ storageKey }, context)
              .then((result) => (result.ok ? result.value.record : undefined))
          : undefined;
        const resolvedOriginalName =
          metadataOriginalName ?? catalogRecord?.originalName;
        const sourceMediaType = descriptorMediaType ?? catalogRecord?.mediaType;
        const taskType =
          command.recipe.task?.taskType ??
          DEFAULT_DATASET_PREPARATION_TASK_TYPE;
        const sourceReadiness = evaluateDatasetPreparationSourceReadiness({
          fileName: resolvedOriginalName ?? storageKey,
          mediaType: sourceMediaType,
          taskType,
        });
        if (!sourceReadiness.ready) {
          return failAndCleanup(
            createContractError(
              "validation",
              [sourceReadiness.message, sourceReadiness.action]
                .filter(Boolean)
                .join(" "),
              {
                details: {
                  code: sourceReadiness.code,
                  sourceFormat: sourceReadiness.capability?.format,
                  taskType,
                },
              },
            ),
          );
        }
        const mediaType =
          sourceMediaType ??
          sourceReadiness.capability?.mediaTypes[0] ??
          "application/octet-stream";
        if (this.datasetVersionHasher) {
          sourceVersionLineage.push({
            sourceArtifactId: artifactId,
            artifactKey: storageKey,
            digest: this.datasetVersionHasher.digest(
              retrieveResult.value.content as Uint8Array,
            ),
            mediaType,
          });
        }
        const localPath = buildRuntimeSourceInputPath(
          runtimeWorkingDir,
          artifactId,
          mediaType,
          resolvedOriginalName,
          sourceIndex,
        );
        await writeFile(
          localPath,
          Buffer.from(retrieveResult.value.content as Uint8Array),
        );
        sourceInputs.push({
          artifactId,
          localPath,
          mediaType,
          originalName: resolvedOriginalName,
          metadata:
            descriptorMetadata &&
            typeof descriptorMetadata === "object" &&
            !Array.isArray(descriptorMetadata)
              ? (descriptorMetadata as Record<string, unknown>)
              : undefined,
        });
      }
      return createSuccessResult(
        { runtimeWorkingDir, sourceInputs, sourceVersionLineage },
        context,
      );
    } catch (error) {
      await rm(runtimeWorkingDir, { recursive: true, force: true });
      return createFailureResult(
        createContractError(
          "internal",
          error instanceof Error
            ? error.message
            : "Failed to stage runtime dataset preparation source inputs.",
        ),
        context,
      );
    }
  }
}
