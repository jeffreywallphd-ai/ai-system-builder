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
import { randomUUID } from "node:crypto";

import {
  createStagedArtifactDescriptorFromStorageObjectDescriptor,
  type StagedArtifactDescriptor,
} from "../../contracts/ingestion";
import {
  createContractError,
  createFailureResult,
  createSuccessResult,
  type ContractResult,
} from "../../contracts/shared";
import {
  createHasArtifactInRepoRequest,
  createRetrieveArtifactRequest,
  createStoreArtifactInRepoRequest,
  createStoreArtifactRequest,
} from "../../contracts/storage";
import type {
  DatasetPreparationSummary,
  DatasetPreparationWarning,
  PrepareTrainingDatasetRequest,
  PrepareTrainingDatasetResult,
} from "../../contracts/runtime";
import {
  DEFAULT_DATASET_PREPARATION_TASK_TYPE,
  createDefaultDatasetPreparationTaskRecipe,
  isDatasetPreparationTaskType,
  resolveDatasetPreparationTaskProfileDefinition,
  resolveDefaultDatasetPreparationPromptTemplate,
  resolveDefaultDatasetPreparationTextGenerationModel,
} from "../../contracts/runtime";

import type { ApplicationRequestContext } from "../ports";
import type { RuntimeTaskRegistryPort } from "../ports/runtime";
import type { ArtifactCatalogReadPort } from "../ports/artifact-catalog";
import type {
  ArtifactStorageBindingPort,
  ArtifactObjectStoragePort,
  ArtifactRepoStoragePort,
} from "../ports/storage";
import type { ArtifactStorageBinding } from "../../contracts/storage";
import { TaskType } from "../../contracts/runtime";
import { isWorkspaceId } from "../../contracts/workspace";
import type {
  RuntimeCapabilityGuardService,
  TaskPowerLifecyclePort,
} from "../services/runtime";
import type {
  RuntimeTaskStatus,
  RuntimeTaskStatusRecord,
} from "../../contracts/runtime";

export interface PrepareTrainingDatasetFromArtifactsCommand {
  sourceArtifactIds: string[];
  recipe: PrepareTrainingDatasetRequest["recipe"];
  split: PrepareTrainingDatasetRequest["split"];
  output: PrepareTrainingDatasetRequest["output"];
}

export interface PrepareTrainingDatasetFromArtifactsValue {
  outputs: {
    local?: {
      dataset: StagedArtifactDescriptor;
    };
    huggingFace?: {
      dataset: {
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
    generationModelId: string;
    summary: DatasetPreparationSummary;
  };
  summary: DatasetPreparationSummary;
  warnings?: DatasetPreparationWarning[];
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
        binding.backing.provider === "local" &&
        binding.role === "primary",
    ) ??
    bindings.find((binding) => binding.backing.kind === "artifact-object") ??
    bindings[0]
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
    generationModel: {
      provider: command.recipe.generation.model.provider,
      modelId: command.recipe.generation.model.modelId,
    },
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
    typeof value.testRowCount === "number"
  );
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
  const textInputMode =
    taskRecipe.textInputMode === "generate" ||
    taskRecipe.textInputMode === "provided"
      ? taskRecipe.textInputMode
      : defaultTaskRecipe.textInputMode;
  const defaultGenerationModel =
    resolveDefaultDatasetPreparationTextGenerationModel(taskType);
  const shouldGenerateText = textInputMode === "generate";
  const promptTemplate = shouldGenerateText
    ? command.recipe.generation.promptTemplate?.trim() ||
      resolveDefaultDatasetPreparationPromptTemplate(taskType)
    : command.recipe.generation.promptTemplate;
  const model = command.recipe.generation.model;
  const modelId =
    model.modelId?.trim() ||
    (shouldGenerateText ? defaultGenerationModel?.modelId : undefined) ||
    model.modelId;

  return {
    ...command,
    recipe: {
      ...command.recipe,
      task: {
        ...taskRecipe,
        textInputMode,
      },
      generation: {
        ...command.recipe.generation,
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
      },
    },
  };
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

    const normalizedCommand = normalizeDatasetPreparationCommand(command);
    const staged = await this.stageRuntimeInputs(normalizedCommand, context);
    if (!staged.ok) {
      return staged;
    }

    const runtimeRequest: PrepareTrainingDatasetRequest = {
      workspaceId: context.workspaceId,
      sourceInputs: staged.value.sourceInputs,
      recipe: normalizedCommand.recipe,
      split: normalizedCommand.split,
      output: normalizedCommand.output,
      runtime: {
        runtimeWorkingDirectory: staged.value.runtimeWorkingDir,
      },
    };

    try {
      const started = await this.runtimeTaskRegistry.startTask({
        requestId: context?.requestId,
        taskType: TaskType.DATASET_PREPARATION,
        payload: runtimeRequest,
        workspaceId: context.workspaceId,
        metadata: { workspaceId: context.workspaceId },
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
          status: "succeeded";
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
      if (statusRecord.status === "succeeded" && statusRecord.data) {
        let terminalStatus: RuntimeTaskStatus = statusRecord.status;
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
          const materialized = await this.materializeRuntimeResult(
            command,
            statusRecord.data,
            runtimeWorkingDirectory,
            context,
          );
          this.materializedResultsByRequestId.set(requestId, materialized);
          return createSuccessResult(
            {
              requestId: statusRecord.requestId,
              taskType: "prepare-training-dataset",
              status: "succeeded",
              result: materialized,
            },
            context,
          );
        } catch (error) {
          terminalStatus = "failed";
          throw error;
        } finally {
          await this.taskPowerLifecycle.completeTask(requestId, terminalStatus);
          await this.cleanupRuntimeWorkingDir(requestId);
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

  private async materializeRuntimeResult(
    command: PrepareTrainingDatasetFromArtifactsCommand,
    runtimeResult: PrepareTrainingDatasetResult,
    runtimeWorkingDirectory: string,
    context?: ApplicationRequestContext,
  ): Promise<PrepareTrainingDatasetFromArtifactsValue> {
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

    if (outputDestinations.local) {
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

    if (outputDestinations.huggingFace) {
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

    await rm(datasetOutputPath, { force: true });
    const taskRecipe =
      command.recipe.task ?? createDefaultDatasetPreparationTaskRecipe();
    const taskProfile = resolveDatasetPreparationTaskProfileDefinition(
      taskRecipe.taskType,
    );
    return {
      outputs: resultOutputs,
      provenance: {
        sourceArtifactIds: command.sourceArtifactIds,
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
        generationModelId: command.recipe.generation.model.modelId,
        summary: runtimeResult.summary,
      },
      summary: runtimeResult.summary,
      warnings: runtimeResult.warnings,
    };
  }

  private async cleanupRuntimeWorkingDir(requestId: string): Promise<void> {
    const runtimeWorkingDir = this.runtimeWorkingDirsByRequestId.get(requestId);
    if (!runtimeWorkingDir) {
      return;
    }
    this.runtimeWorkingDirsByRequestId.delete(requestId);
    this.commandByRequestId.delete(requestId);
    await rm(runtimeWorkingDir, { recursive: true, force: true });
  }

  private async stageRuntimeInputs(
    command: PrepareTrainingDatasetFromArtifactsCommand,
    context?: ApplicationRequestContext,
  ): Promise<
    ContractResult<{
      runtimeWorkingDir: string;
      sourceInputs: PrepareTrainingDatasetRequest["sourceInputs"];
    }>
  > {
    const runtimeWorkingDir = await mkdtemp(
      join(tmpdir(), "ai-system-builder-runtime-"),
    );
    const sourceInputs: PrepareTrainingDatasetRequest["sourceInputs"] = [];
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
        const storageKey = resolveLocalStorageKeyForArtifact(
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
        const retrieveResult = await this.storage.retrieveArtifact(
          createRetrieveArtifactRequest(storageKey),
          context,
        );
        if (!retrieveResult.ok) {
          return failAndCleanup(retrieveResult.error);
        }
        const mediaType =
          retrieveResult.value.descriptor.mediaType ?? "application/json";
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
        const catalogOriginalName = artifactCatalog
          ? await artifactCatalog
              .readArtifactCatalogRecord({ storageKey }, context)
              .then((result) =>
                result.ok ? result.value.record.originalName : undefined,
              )
          : undefined;
        const resolvedOriginalName =
          metadataOriginalName ?? catalogOriginalName;
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
      return createSuccessResult({ runtimeWorkingDir, sourceInputs }, context);
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
