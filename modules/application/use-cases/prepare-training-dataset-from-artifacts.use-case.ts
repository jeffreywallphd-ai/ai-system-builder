import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, parse } from "node:path";

import {
  createStagedArtifactDescriptorFromStorageObjectDescriptor,
  type StagedArtifactDescriptor,
} from "../../contracts/ingestion";
import { createContractError, createFailureResult, createSuccessResult, type ContractResult } from "../../contracts/shared";
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
} from "../../contracts/runtime";

import type { ApplicationRequestContext } from "../ports";
import { PythonDatasetPreparationError, type PythonDatasetPreparationPort } from "../ports/runtime";
import type { ArtifactCatalogReadPort } from "../ports/artifact-catalog";
import type { ArtifactStorageBindingPort, ArtifactObjectStoragePort, ArtifactRepoStoragePort } from "../ports/storage";
import type { ArtifactStorageBinding } from "../../contracts/storage";

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
    generationModelId: string;
    summary: DatasetPreparationSummary;
  };
  summary: DatasetPreparationSummary;
  warnings?: DatasetPreparationWarning[];
}

export type PrepareTrainingDatasetFromArtifactsResult = ContractResult<PrepareTrainingDatasetFromArtifactsValue>;

export interface PrepareTrainingDatasetFromArtifactsUseCaseDependencies {
  datasetPreparation: PythonDatasetPreparationPort;
  storageBindings: ArtifactStorageBindingPort;
  storage: ArtifactObjectStoragePort;
  artifactRepoStorage?: ArtifactRepoStoragePort;
  artifactCatalog?: ArtifactCatalogReadPort;
  now?: () => string;
}

function resolveArtifactBindingsReadFailureAsEmpty(
  result: Awaited<ReturnType<ArtifactStorageBindingPort["readArtifactStorageBindings"]>>,
): Awaited<ReturnType<ArtifactStorageBindingPort["readArtifactStorageBindings"]>> {
  if (result.ok || result.error.code !== "not-found") {
    return result;
  }

  return createSuccessResult({ bindings: [] }, {
    requestId: result.requestId,
    correlationId: result.correlationId,
  });
}

function resolvePreferredObjectStorageBinding(
  bindings: ArtifactStorageBinding[],
): ArtifactStorageBinding | undefined {
  // Dataset preparation requires locally retrievable object bytes.
  // Prefer an artifact-object + local + primary binding when available, then
  // fallback to any artifact-object binding, then the first entry as a last resort.
  return bindings.find((binding) =>
    binding.backing.kind === "artifact-object"
    && binding.backing.provider === "local"
    && binding.role === "primary")
    ?? bindings.find((binding) => binding.backing.kind === "artifact-object")
    ?? bindings[0];
}

function resolveLocalStorageKeyForArtifact(
  artifactId: string,
  bindings: ArtifactStorageBinding[],
): string {
  const preferredBinding = resolvePreferredObjectStorageBinding(bindings);
  if (preferredBinding?.backing.kind === "artifact-object" && preferredBinding.backing.locator) {
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

  if (mediaType === "application/x-ndjson" || mediaType === "application/jsonl") {
    return ".jsonl";
  }

  if (mediaType === "application/json" || mediaType === "text/json") {
    return ".json";
  }

  if (mediaType === "text/csv" || mediaType === "application/csv") {
    return ".csv";
  }

  if (mediaType === "application/x-parquet" || mediaType === "application/vnd.apache.parquet") {
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
  const stem = sanitizeRuntimeSourceFileSegment(parse(sourceName).name || sourceName);
  const prefix = `${String(sourceIndex + 1).padStart(4, "0")}-${stem}`;
  return join(runtimeWorkingDir, `${prefix}${extensionForMediaType(mediaType)}`);
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

function joinRepoPath(pathPrefix: string | undefined, fileName: string): string {
  const normalizedPrefix = pathPrefix?.trim().replace(/^\/+|\/+$/g, "");
  return normalizedPrefix ? `${normalizedPrefix}/${fileName}` : fileName;
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
  return {
    sourceArtifactIds: command.sourceArtifactIds,
    recipe: command.recipe,
    split: command.split,
    generationModel: {
      provider: command.recipe.generation.model.provider,
      modelId: command.recipe.generation.model.modelId,
    },
    summary,
    destination,
    runtime: runtimeMetadata,
  };
}

async function validateDatasetOutput(tempPath: string, format: PrepareTrainingDatasetRequest["output"]["format"]): Promise<void> {
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
    const lines = contents.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    if (lines.length === 0) {
      throw new Error(`Runtime output file '${tempPath}' does not contain any JSONL rows.`);
    }
    for (const line of lines) {
      JSON.parse(line);
    }
    return;
  }

  const [header] = contents.split(/\r?\n/);
  if (!header || header.trim().length === 0) {
    throw new Error(`Runtime output file '${tempPath}' does not include a CSV header.`);
  }
}

export class PrepareTrainingDatasetFromArtifactsUseCase {
  private readonly datasetPreparation: PythonDatasetPreparationPort;
  private readonly storageBindings: ArtifactStorageBindingPort;
  private readonly storage: ArtifactObjectStoragePort;
  private readonly artifactRepoStorage?: ArtifactRepoStoragePort;
  private readonly artifactCatalog?: ArtifactCatalogReadPort;
  private readonly now: () => string;

  public constructor(dependencies: PrepareTrainingDatasetFromArtifactsUseCaseDependencies) {
    this.datasetPreparation = dependencies.datasetPreparation;
    this.storageBindings = dependencies.storageBindings;
    this.storage = dependencies.storage;
    this.artifactRepoStorage = dependencies.artifactRepoStorage;
    this.artifactCatalog = dependencies.artifactCatalog;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public async execute(
    command: PrepareTrainingDatasetFromArtifactsCommand,
    context?: ApplicationRequestContext,
  ): Promise<PrepareTrainingDatasetFromArtifactsResult> {
    const runtimeWorkingDir = await mkdtemp(join(tmpdir(), "ai-system-builder-runtime-"));

    try {
      const destinations = resolveOutputDestinations(command.output);
      const runtimeRequest: PrepareTrainingDatasetRequest = {
        sourceInputs: [],
        recipe: command.recipe,
        split: command.split,
        output: command.output,
      };

      for (const [sourceIndex, artifactId] of command.sourceArtifactIds.entries()) {
        const bindingsResult = resolveArtifactBindingsReadFailureAsEmpty(
          await this.storageBindings.readArtifactStorageBindings({ artifactId }, context),
        );
        if (!bindingsResult.ok) {
          return createFailureResult(bindingsResult.error, context);
        }

        const storageKey = resolveLocalStorageKeyForArtifact(artifactId, bindingsResult.value.bindings);
        if (!storageKey.trim()) {
          return createFailureResult(
            createContractError("not-found", `Storage locator missing for artifact '${artifactId}'.`),
            context,
          );
        }

        const retrieveResult = await this.storage.retrieveArtifact(createRetrieveArtifactRequest(storageKey), context);
        if (!retrieveResult.ok) {
          return createFailureResult(retrieveResult.error, context);
        }

        const mediaType = retrieveResult.value.descriptor.mediaType ?? "application/json";
        const descriptorMetadata = retrieveResult.value.descriptor.metadata;
        const metadataOriginalName = descriptorMetadata
          && typeof descriptorMetadata === "object"
          && !Array.isArray(descriptorMetadata)
          && typeof (descriptorMetadata as { originalName?: unknown }).originalName === "string"
          ? (descriptorMetadata as { originalName: string }).originalName
          : undefined;
        const artifactCatalog = this.artifactCatalog;
        const catalogOriginalName = artifactCatalog
          ? await artifactCatalog.readArtifactCatalogRecord({ storageKey }, context)
            .then((result) => (result.ok ? result.value.record.originalName : undefined))
          : undefined;
        const resolvedOriginalName = metadataOriginalName ?? catalogOriginalName;
        const localPath = buildRuntimeSourceInputPath(
          runtimeWorkingDir,
          artifactId,
          mediaType,
          resolvedOriginalName,
          sourceIndex,
        );
        await writeFile(localPath, Buffer.from(retrieveResult.value.content as Uint8Array));

        runtimeRequest.sourceInputs.push({
          artifactId,
          localPath,
          mediaType,
          originalName: resolvedOriginalName,
        });
      }

      const prepared = await this.datasetPreparation.prepareTrainingDataset(runtimeRequest);
      const datasetOutput = prepared.outputs.find((output) => output.role === "dataset")
        ?? prepared.outputs.find((output) => output.role === "artifact");

      if (!datasetOutput) {
        return createFailureResult(
          createContractError("internal", "Runtime did not return a dataset output."),
          context,
        );
      }

      let datasetBytes: Buffer;
      try {
        await validateDatasetOutput(datasetOutput.tempPath, command.output.format);
        datasetBytes = await readFile(datasetOutput.tempPath);
      } finally {
        await rm(datasetOutput.tempPath, { force: true });
      }

      let localOutputs: PrepareTrainingDatasetFromArtifactsValue["outputs"]["local"];
      if (destinations.local) {
        const storedDataset = await this.storage.storeArtifact(createStoreArtifactRequest(datasetBytes, {
          descriptor: {
            mediaType: datasetOutput.mediaType,
            metadata: {
              originalFileName: `${datasetOutput.name}.${command.output.format}`,
              runtimeRole: "dataset",
              ...buildDatasetMetadata(command, prepared.summary, { provider: "local" }, datasetOutput.metadata),
            },
          },
        }), context);

        if (!storedDataset.ok) {
          return createFailureResult(storedDataset.error, context);
        }

        localOutputs = {
          dataset: createStagedArtifactDescriptorFromStorageObjectDescriptor(storedDataset.value, {
            sourceKind: "runtime",
            originalName: `${datasetOutput.name}.${command.output.format}`,
          }),
        };
      }

      let huggingFaceOutputs: PrepareTrainingDatasetFromArtifactsValue["outputs"]["huggingFace"];
      if (destinations.huggingFace) {
        const artifactRepoStorage = this.artifactRepoStorage;
        if (!artifactRepoStorage) {
          return createFailureResult(
            createContractError("internal", "Artifact repo storage is required for Hugging Face output."),
            context,
          );
        }

        const datasetPath = joinRepoPath(
          destinations.huggingFace.pathPrefix,
          `${datasetOutput.name}.${command.output.format}`,
        );
        const target = {
          provider: destinations.huggingFace.provider,
          repository: destinations.huggingFace.repository,
          revision: destinations.huggingFace.revision,
        };

        const publishDataset = await artifactRepoStorage.storeArtifactInRepo(
          createStoreArtifactInRepoRequest(new Uint8Array(datasetBytes), {
            target: { ...target, path: datasetPath },
            mediaType: datasetOutput.mediaType,
            metadata: {
              runtimeRole: "dataset",
              ...buildDatasetMetadata(command, prepared.summary, {
                provider: "huggingface",
                publication: {
                  repository: target.repository,
                  path: datasetPath,
                  revision: target.revision,
                },
              }, datasetOutput.metadata),
            },
          }),
          context,
        );

        if (!publishDataset.ok) {
          return createFailureResult(publishDataset.error, context);
        }

        const verifyDataset = await artifactRepoStorage.hasArtifactInRepo(
          createHasArtifactInRepoRequest({ ...target, path: datasetPath }),
          context,
        );

        if (!verifyDataset.ok) {
          return createFailureResult(verifyDataset.error, context);
        }

        const verifiedAt = this.now();
        const publishDatasetTarget = publishDataset.value.descriptor.target;
        huggingFaceOutputs = {
          dataset: {
            provider: "huggingface",
            repository: publishDatasetTarget.repository,
            path: publishDatasetTarget.path ?? datasetPath,
            revision: publishDatasetTarget.revision,
            exists: verifyDataset.value.exists,
            verifiedAt,
          },
        };
      }

      return createSuccessResult({
        outputs: {
          local: localOutputs,
          huggingFace: huggingFaceOutputs,
        },
        provenance: {
          sourceArtifactIds: command.sourceArtifactIds,
          recipe: command.recipe,
          split: command.split,
          output: command.output,
          generationModelId: command.recipe.generation.model.modelId,
          summary: prepared.summary,
        },
        summary: prepared.summary,
        warnings: prepared.warnings,
      }, context);
    } catch (error) {
      if (error instanceof PythonDatasetPreparationError) {
        return createFailureResult(error.contractError, context);
      }
      return createFailureResult(
        createContractError(
          "internal",
          error instanceof Error ? error.message : "Dataset preparation failed unexpectedly.",
        ),
        context,
      );
    } finally {
      await rm(runtimeWorkingDir, { recursive: true, force: true });
    }
  }
}
