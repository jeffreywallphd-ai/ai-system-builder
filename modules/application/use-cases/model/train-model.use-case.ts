import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, parse, relative, resolve } from "node:path";

import {
  normalizeModelTrainingRequest,
  normalizeModelTrainingResult,
  type ModelTrainingRequest,
  type ModelTrainingResult,
  type ModelTrainingProgress,
} from "../../../contracts/model";
import { TaskType, type RuntimeTaskRecord } from "../../../contracts/runtime";
import { createRetrieveArtifactRequest } from "../../../contracts/storage";
import type { GeneratedModelStoragePort, ModelPublisherPort, ModelRegistryPort } from "../../ports/model";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import type { ArtifactObjectStoragePort, ArtifactStorageBindingPort } from "../../ports/storage";
import type { TaskPowerLifecyclePort } from "../../services/runtime";

function ensureBaseModelSelection(request: ModelTrainingRequest): void {
  if (!request.baseModel.modelRecordId && !request.baseModel.modelId && !request.baseModel.localPath) {
    throw new Error("Model training requires a base model selection.");
  }
}

function ensureDatasetSelections(request: ModelTrainingRequest): void {
  if (request.datasets.length === 0) {
    throw new Error("Model training requires at least one dataset artifact.");
  }

  request.datasets.forEach((dataset, index) => {
    if (!dataset.artifactId || dataset.artifactId.trim().length === 0) {
      throw new Error(`Model training dataset at index ${index} is missing artifactId.`);
    }
  });
}

function ensureOutputDestinationSelection(request: ModelTrainingRequest): void {
  const localEnabled = request.output.destination.local.enabled === true;
  const huggingFaceEnabled = request.output.destination.huggingFace?.enabled === true;
  if (!localEnabled && !huggingFaceEnabled) {
    throw new Error("Model training requires at least one output destination.");
  }

  if (huggingFaceEnabled && !request.output.destination.huggingFace?.repository) {
    throw new Error("Publishing trained models to Hugging Face requires a repository.");
  }
}

function extensionForMediaType(mediaType: string | undefined): string {
  if (mediaType === "application/x-parquet" || mediaType === "application/vnd.apache.parquet") {
    return ".parquet";
  }

  if (mediaType === "application/x-ndjson" || mediaType === "application/jsonl") {
    return ".jsonl";
  }

  if (mediaType === "application/json" || mediaType === "text/json") {
    return ".json";
  }

  if (mediaType === "text/csv" || mediaType === "application/csv") {
    return ".csv";
  }

  return ".parquet";
}

function sanitizeRuntimeDatasetFileSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "dataset";
}

function buildRuntimeDatasetPath(
  runtimeDatasetDir: string,
  artifactId: string,
  mediaType: string | undefined,
  datasetIndex: number,
): string {
  const sourceName = basename(artifactId);
  const stem = sanitizeRuntimeDatasetFileSegment(parse(sourceName).name || sourceName);
  const extension = parse(sourceName).ext || extensionForMediaType(mediaType);
  const prefix = `${String(datasetIndex + 1).padStart(4, "0")}-${stem}`;
  return join(runtimeDatasetDir, `${prefix}${extension}`);
}

export class TrainModelUseCase {
  private readonly registeredResultsByRequestId = new Map<string, ModelTrainingResult>();
  private readonly requestContextByRequestId = new Map<string, { normalizedRequest: ModelTrainingRequest; baseModelRecordId?: string }>();
  private readonly runtimeDatasetDirsByRequestId = new Map<string, string>();

  public constructor(
    private readonly dependencies: {
      runtimeTaskRegistry: RuntimeTaskRegistryPort;
      modelRegistry: ModelRegistryPort;
      storageBindings: Pick<ArtifactStorageBindingPort, "readArtifactStorageBindings">;
      storage: Pick<ArtifactObjectStoragePort, "retrieveArtifact">;
      generatedModelStorage?: GeneratedModelStoragePort;
      modelPublisher?: ModelPublisherPort;
      taskPowerLifecycle: TaskPowerLifecyclePort;
    },
  ) {}

  public async execute(request: ModelTrainingRequest): Promise<ModelTrainingResult> {
    const normalizedRequest = normalizeModelTrainingRequest(request);
    ensureBaseModelSelection(normalizedRequest);
    ensureDatasetSelections(normalizedRequest);
    ensureOutputDestinationSelection(normalizedRequest);

    let baseModelRecordId: string | undefined = normalizedRequest.baseModel.modelRecordId;

    if (normalizedRequest.baseModel.modelRecordId) {
      const baseModelRecord = await this.dependencies.modelRegistry.getModelRecord(normalizedRequest.baseModel.modelRecordId);
      if (!baseModelRecord) {
        throw new Error(`Base model record '${normalizedRequest.baseModel.modelRecordId}' was not found.`);
      }

      baseModelRecordId = baseModelRecord.modelRecordId;
      normalizedRequest.baseModel = {
        ...normalizedRequest.baseModel,
        modelRecordId: baseModelRecord.modelRecordId,
        provider: normalizedRequest.baseModel.provider ?? baseModelRecord.provider,
        modelId: normalizedRequest.baseModel.modelId ?? baseModelRecord.modelId,
        localPath: normalizedRequest.baseModel.localPath ?? baseModelRecord.localPath,
        inferenceMode: normalizedRequest.baseModel.inferenceMode ?? baseModelRecord.inferenceMode,
      };
    }

    let runtimeDatasetDir: string | undefined;
    try {
      const resolvedDatasets = [];
      for (const [datasetIndex, dataset] of normalizedRequest.datasets.entries()) {
        const resolved = await this.resolveDatasetForRuntime(dataset, datasetIndex, () => runtimeDatasetDir, (value) => { runtimeDatasetDir = value; });
        resolvedDatasets.push(resolved);
      }

      const started = await this.dependencies.runtimeTaskRegistry.startTask({
        taskType: TaskType.MODEL_TRAINING,
        payload: {
          ...normalizedRequest,
          datasets: resolvedDatasets,
        },
      });

      if (typeof started.requestId !== "string" || started.requestId.trim().length === 0) {
        throw new Error("Model training start response missing requestId.");
      }

      this.requestContextByRequestId.set(started.requestId, { normalizedRequest, baseModelRecordId });
      if (runtimeDatasetDir) {
        this.runtimeDatasetDirsByRequestId.set(started.requestId, runtimeDatasetDir);
      }
      try {
        await this.dependencies.taskPowerLifecycle.startTask(started.requestId, TaskType.MODEL_TRAINING);
      } catch {
        // Power blocker startup failures must not fail model training.
      }

      return {
        runId: started.requestId,
        status: "queued",
      };
    } catch (error) {
      if (runtimeDatasetDir) {
        await rm(runtimeDatasetDir, { recursive: true, force: true });
      }
      throw error;
    }
  }

  public async read(requestId: string): Promise<ModelTrainingResult> {
    const cached = this.registeredResultsByRequestId.get(requestId);
    if (cached) {
      return cached;
    }

    const statusRecord = await this.dependencies.runtimeTaskRegistry.getTaskStatus(requestId);
    if (statusRecord.status === "succeeded") {
      return this.resolveSucceededResult(statusRecord);
    }

    if (statusRecord.status === "failed" || statusRecord.status === "cancelled" || statusRecord.status === "unknown") {
      await this.completePowerLifecycle(requestId, statusRecord.status);
      await this.cleanupRuntimeDatasetDir(requestId);
      return normalizeModelTrainingResult({
        runId: requestId,
        status: statusRecord.status === "unknown" ? "failed" : statusRecord.status,
        ...(statusRecord.error ? { error: statusRecord.error } : {}),
      });
    }

    return normalizeModelTrainingResult({
      runId: requestId,
      status: statusRecord.status,
      progress: this.mapTrainingProgress(statusRecord),
    });
  }

  private async resolveSucceededResult(statusRecord: RuntimeTaskRecord): Promise<ModelTrainingResult> {
    if (!statusRecord.data || typeof statusRecord.data !== "object") {
      throw new Error(`Model training runtime result missing for request '${statusRecord.requestId}'.`);
    }

    const trainingResult = normalizeModelTrainingResult(statusRecord.data as ModelTrainingResult);

    if (trainingResult.status !== "succeeded" || !trainingResult.generatedModelCandidate) {
      await this.completePowerLifecycle(statusRecord.requestId, "unknown");
      await this.cleanupRuntimeDatasetDir(statusRecord.requestId);
      return trainingResult;
    }

    const requestContext = this.requestContextByRequestId.get(statusRecord.requestId);
    if (!requestContext) {
      throw new Error(`Model training request context missing for request '${statusRecord.requestId}'.`);
    }

    const { normalizedRequest, baseModelRecordId } = requestContext;
    const generated = trainingResult.generatedModelCandidate;
    const registration = normalizedRequest.output.registration;
    const destination = normalizedRequest.output.destination;
    const localStorageResult = destination.local.enabled
      ? await this.storeGeneratedModelLocally(normalizedRequest, trainingResult, generated)
      : undefined;
    const publishedResult = destination.huggingFace?.enabled
      ? await this.publishGeneratedModel(normalizedRequest, statusRecord.requestId, generated)
      : undefined;
    const trainingValidation = generated.metadata && typeof generated.metadata["validation"] === "object"
      ? generated.metadata["validation"] as Record<string, unknown>
      : undefined;
    const runtimeValidationReportPath = typeof trainingResult.validationReportPath === "string"
      ? trainingResult.validationReportPath
      : (typeof trainingValidation?.["validationReportPath"] === "string" ? trainingValidation["validationReportPath"] : undefined);
    const validationReportPath = localStorageResult
      ? this.resolveStoredOutputPath(runtimeValidationReportPath, generated.localPath, localStorageResult.localPath)
      : (publishedResult ? undefined : runtimeValidationReportPath);
    const generatedMetadata = localStorageResult
      ? this.rewriteGeneratedMetadataPaths(generated.metadata, generated.localPath, localStorageResult.localPath)
      : (publishedResult ? this.removeGeneratedMetadataOutputPaths(generated.metadata) : generated.metadata);
    const registered = await this.dependencies.modelRegistry.registerGeneratedModel({
      displayName: registration?.displayName ?? generated.displayName,
      provider: publishedResult ? "huggingface" : generated.provider,
      modelId: publishedResult?.repository ?? generated.modelId ?? localStorageResult?.modelId,
      localPath: localStorageResult?.localPath,
      artifactForm: generated.artifactForm ?? registration?.artifactForm ?? (normalizedRequest.method === "lora" ? "adapter" : "full-model"),
      inferenceMode: generated.inferenceMode ?? registration?.inferenceMode ?? normalizedRequest.baseModel.inferenceMode,
      taskTags: generated.taskTags ?? registration?.taskTags,
      baseModelId: generated.baseModelId ?? registration?.baseModelId ?? normalizedRequest.baseModel.modelId,
      adapterOfModelId: generated.adapterOfModelId ?? registration?.adapterOfModelId ?? normalizedRequest.baseModel.modelId,
      generatedFromRunId: generated.generatedFromRunId ?? trainingResult.runId,
      serializationFormat: generated.serializationFormat,
      sizeBytes: generated.sizeBytes,
      metadata: {
        baseModelRecordId,
        ...registration?.metadata,
        ...generatedMetadata,
        ...(localStorageResult ? { localStorage: { localPath: localStorageResult.localPath, modelId: localStorageResult.modelId } } : {}),
        ...(publishedResult ? {
          published: {
            provider: publishedResult.provider,
            repository: publishedResult.repository,
            revision: publishedResult.revision,
            url: publishedResult.url,
          },
        } : {}),
      },
      validationStatus: typeof trainingValidation?.["status"] === "string"
        ? trainingValidation["status"] as "unknown" | "valid" | "invalid" | "warning"
        : undefined,
      validationReportPath:
        validationReportPath,
    });

    const outputModel = publishedResult
      ? (await this.dependencies.modelRegistry.updateModelRecord({
          modelRecordId: registered.model.modelRecordId,
          patch: {
            published: {
              provider: publishedResult.provider,
              repository: publishedResult.repository,
              revision: publishedResult.revision,
              url: publishedResult.url,
              publishedAt: new Date().toISOString(),
            },
          },
        })).model
      : registered.model;

    const result = {
      ...trainingResult,
      outputDirectory: localStorageResult?.localPath ?? (publishedResult ? undefined : trainingResult.outputDirectory),
      validationReportPath,
      generatedModelCandidate: {
        ...generated,
        localPath: localStorageResult?.localPath,
        metadata: generatedMetadata,
      },
      outputModel,
    };
    this.registeredResultsByRequestId.set(statusRecord.requestId, result);
    await this.completePowerLifecycle(statusRecord.requestId, "succeeded");
    await this.cleanupRuntimeDatasetDir(statusRecord.requestId);
    await this.cleanupRuntimeOutputDirectory(generated.localPath, localStorageResult?.localPath);
    return result;
  }

  private async storeGeneratedModelLocally(
    request: ModelTrainingRequest,
    result: ModelTrainingResult,
    generated: NonNullable<ModelTrainingResult["generatedModelCandidate"]>,
  ): Promise<{ localPath: string; modelId?: string }> {
    if (!generated.localPath) {
      throw new Error("Model training succeeded but did not report a generated model directory to store locally.");
    }

    if (!this.dependencies.generatedModelStorage) {
      throw new Error("Local generated model storage is not configured.");
    }

    return this.dependencies.generatedModelStorage.storeGeneratedModel({
      sourceDirectory: generated.localPath,
      outputModelName: result.outputModelName ?? request.output.outputModelName,
      runId: result.runId,
      repository: request.output.destination.huggingFace?.repository,
    });
  }

  private async publishGeneratedModel(
    request: ModelTrainingRequest,
    requestId: string,
    generated: NonNullable<ModelTrainingResult["generatedModelCandidate"]>,
  ) {
    const huggingFace = request.output.destination.huggingFace;
    if (!huggingFace?.enabled || !huggingFace.repository) {
      throw new Error("Hugging Face publish destination is incomplete.");
    }

    if (!generated.localPath) {
      throw new Error("Model training succeeded but did not report a generated model directory to publish.");
    }

    if (!this.dependencies.modelPublisher) {
      throw new Error("Hugging Face model publishing is not configured.");
    }

    return this.dependencies.modelPublisher.publishModel({
      modelRecordId: requestId,
      repository: huggingFace.repository,
      revision: huggingFace.revision,
      pathPrefix: huggingFace.pathPrefix,
      private: huggingFace.private,
      modelPath: generated.localPath,
    });
  }

  private resolveStoredOutputPath(
    candidatePath: string | undefined,
    runtimeOutputDirectory: string | undefined,
    storedLocalDirectory: string | undefined,
  ): string | undefined {
    if (!candidatePath || !runtimeOutputDirectory || !storedLocalDirectory) {
      return candidatePath;
    }

    const relativePath = relative(resolve(runtimeOutputDirectory), resolve(candidatePath));
    if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) {
      return candidatePath;
    }

    return join(storedLocalDirectory, relativePath);
  }

  private rewriteGeneratedMetadataPaths(
    metadata: Record<string, unknown> | undefined,
    runtimeOutputDirectory: string | undefined,
    storedLocalDirectory: string | undefined,
  ): Record<string, unknown> | undefined {
    if (!metadata) {
      return metadata;
    }

    const validation = metadata["validation"];
    if (!validation || typeof validation !== "object") {
      return metadata;
    }

    const validationRecord = validation as Record<string, unknown>;
    const validationReportPath = typeof validationRecord["validationReportPath"] === "string"
      ? this.resolveStoredOutputPath(validationRecord["validationReportPath"], runtimeOutputDirectory, storedLocalDirectory)
      : undefined;
    if (!validationReportPath || validationReportPath === validationRecord["validationReportPath"]) {
      return metadata;
    }

    return {
      ...metadata,
      validation: {
        ...validationRecord,
        validationReportPath,
      },
    };
  }

  private removeGeneratedMetadataOutputPaths(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!metadata) {
      return metadata;
    }

    const validation = metadata["validation"];
    if (!validation || typeof validation !== "object") {
      return metadata;
    }

    const validationRecord = { ...(validation as Record<string, unknown>) };
    delete validationRecord["validationReportPath"];

    return {
      ...metadata,
      validation: validationRecord,
    };
  }

  private mapTrainingProgress(statusRecord: RuntimeTaskRecord): ModelTrainingProgress | undefined {
    const details = statusRecord.progress?.details;
    if (!details || typeof details !== "object") {
      return statusRecord.progress?.message ? { message: statusRecord.progress.message } : undefined;
    }

    return {
      stage: typeof details.stage === "string" ? details.stage : undefined,
      message: typeof details.message === "string" ? details.message : statusRecord.progress?.message,
      epoch: typeof details.epoch === "number" ? details.epoch : undefined,
      totalEpochs: typeof details.totalEpochs === "number" ? details.totalEpochs : undefined,
      batch: typeof details.batch === "number" ? details.batch : undefined,
      totalBatches: typeof details.totalBatches === "number" ? details.totalBatches : undefined,
    };
  }

  private async resolveDatasetForRuntime(
    dataset: ModelTrainingRequest["datasets"][number],
    datasetIndex: number,
    getRuntimeDatasetDir: () => string | undefined,
    setRuntimeDatasetDir: (value: string) => void,
  ): Promise<ModelTrainingRequest["datasets"][number]> {
    if (dataset.path && dataset.path.trim().length > 0) {
      return dataset;
    }

    const bindingsResult = await this.dependencies.storageBindings.readArtifactStorageBindings({ artifactId: dataset.artifactId });
    if (!bindingsResult.ok) {
      throw new Error(`Failed to resolve storage binding for dataset artifact '${dataset.artifactId}': ${bindingsResult.error.message}`);
    }

    const localFilesystemBinding = bindingsResult.value.bindings.find((binding) =>
      binding.backing.provider === "local-filesystem"
      && binding.backing.locator.trim().length > 0,
    );
    if (localFilesystemBinding) {
      return { ...dataset, path: localFilesystemBinding.backing.locator };
    }

    const localObjectBinding = bindingsResult.value.bindings.find((binding) =>
      binding.backing.kind === "artifact-object"
      && binding.backing.provider === "local"
      && binding.backing.locator.trim().length > 0,
    );
    const storageKey = localObjectBinding?.backing.locator ?? dataset.artifactId;
    const retrieved = await this.dependencies.storage.retrieveArtifact(createRetrieveArtifactRequest(storageKey));
    if (!retrieved.ok) {
      throw new Error(`Failed to retrieve local dataset artifact '${dataset.artifactId}' from artifact-object storage key '${storageKey}': ${retrieved.error.message}`);
    }

    let runtimeDatasetDir = getRuntimeDatasetDir();
    if (!runtimeDatasetDir) {
      runtimeDatasetDir = await mkdtemp(join(tmpdir(), "ai-system-builder-training-datasets-"));
      setRuntimeDatasetDir(runtimeDatasetDir);
    }
    const localPath = buildRuntimeDatasetPath(runtimeDatasetDir, dataset.artifactId, retrieved.value.descriptor.mediaType, datasetIndex);
    await writeFile(localPath, Buffer.from(retrieved.value.content as Uint8Array));
    return {
      ...dataset,
      path: localPath,
      format: dataset.format ?? parse(localPath).ext.replace(/^\./, ""),
    };
  }

  private async completePowerLifecycle(requestId: string, status: "succeeded" | "failed" | "cancelled" | "unknown"): Promise<void> {
    try {
      await this.dependencies.taskPowerLifecycle.completeTask(requestId, status);
    } catch {
      // Power blocker teardown failures must not fail model training.
    }
  }

  private async cleanupRuntimeDatasetDir(requestId: string): Promise<void> {
    const runtimeDatasetDir = this.runtimeDatasetDirsByRequestId.get(requestId);
    if (!runtimeDatasetDir) {
      return;
    }

    this.runtimeDatasetDirsByRequestId.delete(requestId);
    await rm(runtimeDatasetDir, { recursive: true, force: true });
  }

  private async cleanupRuntimeOutputDirectory(runtimeOutputDirectory: string | undefined, storedLocalDirectory: string | undefined): Promise<void> {
    if (!runtimeOutputDirectory) {
      return;
    }

    if (storedLocalDirectory && resolve(runtimeOutputDirectory) === resolve(storedLocalDirectory)) {
      return;
    }

    await rm(runtimeOutputDirectory, { recursive: true, force: true });
  }
}
