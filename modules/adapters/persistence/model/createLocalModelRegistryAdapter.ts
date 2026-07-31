import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import {
  normalizeModelInventoryRecord,
  type DeleteModelRecordRequest,
  type DeleteModelRecordResult,
  type ListModelsRequest,
  type ListModelsResult,
  type ModelInventoryRecord,
  type RegisterDownloadedModelRequest,
  type RegisterDownloadedModelResult,
  type RegisterGeneratedModelRequest,
  type RegisterGeneratedModelResult,
  type SaveModelReferenceRequest,
  type SaveModelReferenceResult,
  type UpdateModelRecordRequest,
  type UpdateModelRecordResult,
} from "../../../contracts/model";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { ModelRegistryPort } from "../../../application/ports/model";
import {
  mutateDocumentRecord,
  readDocumentRecord,
  writeDocumentRecord,
  type StructuredDocumentStore,
} from "../shared";

interface ModelRegistryFileShape {
  models?: ModelInventoryRecord[];
  [key: string]: unknown;
}

type DirectoryEntry = Dirent<string>;
type SharedModelDiscoveryRootProvider =
  string[] | (() => string[] | Promise<string[]>);

export interface LocalModelRegistryAdapterOptions {
  filePath: string;
  rootDirectory?: string;
  documents?: StructuredDocumentStore;
  now?: () => string;
  discovery?: {
    enabled?: boolean;
    searchRoots?: SharedModelDiscoveryRootProvider;
    env?: NodeJS.ProcessEnv;
    homeDirectory?: string;
  };
}

const CHECKPOINT_EXTENSIONS = new Set([".safetensors", ".ckpt"]);

function toTrimmedText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildStableModelRecordId(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 16);
  return `model_${hash}`;
}

function normalizeOptionalPath(value: string | undefined): string | undefined {
  const normalized = toTrimmedText(value);
  return normalized;
}

export function createLocalModelRegistryAdapter(
  options: LocalModelRegistryAdapterOptions,
): ModelRegistryPort {
  const now = options.now ?? (() => new Date().toISOString());
  const discoveryEnabled = options.discovery?.enabled !== false;
  let registryWriteQueue: Promise<void> = Promise.resolve();

  async function readDocument(): Promise<ModelRegistryFileShape> {
    if (options.documents) {
      return (
        await readDocumentRecord(
          {
            rootDirectory: options.rootDirectory ?? dirname(options.filePath),
            documents: options.documents,
          },
          "model-registry/models.json",
          { models: [] },
        )
      ).value;
    }
    try {
      const json = await readFile(options.filePath, "utf8");
      const parsed = JSON.parse(json) as ModelRegistryFileShape;
      if (!parsed || typeof parsed !== "object") {
        return { models: [] };
      }

      return {
        ...parsed,
        models: Array.isArray(parsed.models) ? parsed.models : [],
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { models: [] };
      }

      throw error;
    }
  }

  async function writeDocumentNow(
    document: ModelRegistryFileShape,
  ): Promise<void> {
    if (options.documents) {
      await writeDocumentRecord(
        {
          rootDirectory: options.rootDirectory ?? dirname(options.filePath),
          documents: options.documents,
        },
        "model-registry/models.json",
        document,
      );
      return;
    }
    await mkdir(dirname(options.filePath), { recursive: true });
    const temporaryPath = `${options.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(document, null, 2), "utf8");
      await rename(temporaryPath, options.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  function assertWorkspaceId(
    workspaceId: WorkspaceId | string | undefined,
  ): asserts workspaceId is WorkspaceId {
    if (!isWorkspaceId(workspaceId)) {
      throw new Error(
        "Workspace id is required for model registry operations.",
      );
    }
  }

  function matchesFilters(
    record: ModelInventoryRecord,
    request: ListModelsRequest,
  ): boolean {
    if (record.workspaceId !== request.workspaceId) {
      return false;
    }
    if (request.source && record.source !== request.source) {
      return false;
    }

    if (
      request.lifecycleStatus &&
      record.lifecycleStatus !== request.lifecycleStatus
    ) {
      return false;
    }

    if (request.artifactForm && record.artifactForm !== request.artifactForm) {
      return false;
    }

    if (request.provider && record.provider !== request.provider) {
      return false;
    }

    if (request.taskTags && request.taskTags.length > 0) {
      const currentTags = new Set(record.taskTags ?? []);
      if (!request.taskTags.every((taskTag) => currentTags.has(taskTag))) {
        return false;
      }
    }

    const search = toTrimmedText(request.search)?.toLowerCase();
    if (search) {
      const haystack =
        `${record.displayName} ${record.modelId ?? ""} ${record.modelRecordId}`.toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }

    return true;
  }

  async function updateDocument<TResult>(
    update: (document: ModelRegistryFileShape) => {
      document: ModelRegistryFileShape;
      result: TResult;
    },
  ): Promise<TResult> {
    if (options.documents) {
      return mutateDocumentRecord(
        {
          rootDirectory: options.rootDirectory ?? dirname(options.filePath),
          documents: options.documents,
        },
        "model-registry/models.json",
        { models: [] } as ModelRegistryFileShape,
        (current) => {
          const next = update(current);
          return { value: next.document, result: next.result };
        },
      );
    }
    let result!: TResult;
    const operation = registryWriteQueue.then(async () => {
      const next = update(await readDocument());
      result = next.result;
      await writeDocumentNow(next.document);
    });
    registryWriteQueue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  async function resolveDiscoveryRoots(): Promise<string[]> {
    const roots = new Set<string>();
    const configuredRoots =
      typeof options.discovery?.searchRoots === "function"
        ? await options.discovery.searchRoots()
        : (options.discovery?.searchRoots ?? []);
    for (const configuredRoot of configuredRoots) {
      const normalized = normalizeOptionalPath(configuredRoot);
      if (normalized) {
        roots.add(normalized);
      }
    }
    return [...roots];
  }

  function toModelIdFromRepoDirectoryName(
    directoryName: string,
  ): string | undefined {
    if (!directoryName.startsWith("models--")) {
      return undefined;
    }

    const normalized = directoryName.slice("models--".length);
    if (normalized.length === 0) {
      return undefined;
    }

    return normalized.replaceAll("--", "/");
  }

  async function newestDirectory(path: string): Promise<string | undefined> {
    let entries: DirectoryEntry[];
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return undefined;
      }

      throw error;
    }

    const directories = entries.filter((entry) => entry.isDirectory());
    let newest: { path: string; modifiedAtMs: number } | undefined;
    for (const entry of directories) {
      const candidatePath = join(path, entry.name);
      let stats: Awaited<ReturnType<typeof stat>>;
      try {
        stats = await stat(candidatePath);
      } catch {
        continue;
      }

      if (!newest || stats.mtimeMs > newest.modifiedAtMs) {
        newest = { path: candidatePath, modifiedAtMs: stats.mtimeMs };
      }
    }

    return newest?.path;
  }

  function isCheckpointFile(fileName: string): boolean {
    return CHECKPOINT_EXTENSIONS.has(extname(fileName).toLowerCase());
  }

  async function firstCheckpointFile(
    path: string,
  ): Promise<string | undefined> {
    let entries: DirectoryEntry[];
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return undefined;
    }

    return entries
      .filter((entry) => entry.isFile() && isCheckpointFile(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))[0];
  }

  function createSharedModelRecord(input: {
    workspaceId: WorkspaceId;
    localPath: string;
    recordSeedPath?: string;
    displayName: string;
    modelId?: string;
    artifactForm: ModelInventoryRecord["artifactForm"];
    checkpointFile?: string;
  }): ModelInventoryRecord {
    const timestamp = now();
    return normalizeModelInventoryRecord({
      workspaceId: input.workspaceId,
      modelRecordId: buildStableModelRecordId(
        `shared:${input.recordSeedPath ?? input.localPath}`,
      ),
      displayName: input.displayName,
      source: "local",
      lifecycleStatus: "downloaded",
      artifactForm: input.artifactForm,
      provider: input.modelId ? "huggingface" : "unknown",
      modelId: input.modelId,
      localPath: input.localPath,
      createdAt: timestamp,
      inferenceMode:
        input.artifactForm === "checkpoint" ? "text-to-image" : undefined,
      taskTags:
        input.artifactForm === "checkpoint" ? ["text-to-image"] : undefined,
      storageScope: "shared",
      metadata: {
        discovery: input.modelId
          ? "huggingface-cache"
          : "shared-model-directory",
        storageScope: "shared",
        checkpointFile: input.checkpointFile,
      },
    });
  }

  async function discoverSharedModels(
    existing: ModelInventoryRecord[],
    workspaceId: WorkspaceId,
  ): Promise<ModelInventoryRecord[]> {
    if (!discoveryEnabled) {
      return [];
    }

    const knownPaths = new Set(
      existing
        .map((record) => normalizeOptionalPath(record.localPath))
        .filter((value): value is string => Boolean(value)),
    );
    const knownModelIds = new Set(
      existing
        .map((record) => normalizeOptionalPath(record.modelId))
        .filter((value): value is string => Boolean(value)),
    );
    const discovered: ModelInventoryRecord[] = [];
    const seenDiscoveredPaths = new Set<string>();

    for (const cacheRoot of await resolveDiscoveryRoots()) {
      let rootEntries: DirectoryEntry[];
      try {
        rootEntries = await readdir(cacheRoot, { withFileTypes: true });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES") {
          continue;
        }

        throw error;
      }

      for (const entry of rootEntries) {
        if (entry.isFile() && isCheckpointFile(entry.name)) {
          const localPath = cacheRoot;
          const seedPath = join(cacheRoot, entry.name);
          if (knownPaths.has(localPath) || seenDiscoveredPaths.has(seedPath)) {
            continue;
          }
          discovered.push(
            createSharedModelRecord({
              workspaceId,
              localPath,
              recordSeedPath: seedPath,
              displayName: basename(entry.name, extname(entry.name)),
              artifactForm: "checkpoint",
              checkpointFile: entry.name,
            }),
          );
          seenDiscoveredPaths.add(seedPath);
          continue;
        }

        if (!entry.isDirectory()) continue;

        const repoRoot = join(cacheRoot, entry.name);
        const modelId = toModelIdFromRepoDirectoryName(entry.name);
        const snapshotRoot = modelId
          ? await newestDirectory(join(repoRoot, "snapshots"))
          : undefined;
        const localPath = snapshotRoot ?? repoRoot;
        const checkpoint = await firstCheckpointFile(localPath);
        const artifactForm = checkpoint ? "checkpoint" : "full-model";
        const displayName = modelId ?? entry.name;
        if (modelId && knownModelIds.has(modelId)) {
          continue;
        }
        if (knownPaths.has(localPath) || seenDiscoveredPaths.has(localPath)) {
          continue;
        }

        discovered.push(
          createSharedModelRecord({
            workspaceId,
            localPath,
            displayName,
            modelId,
            artifactForm,
          }),
        );
        seenDiscoveredPaths.add(localPath);
      }
    }

    return discovered;
  }

  return {
    async listModels(request: ListModelsRequest): Promise<ListModelsResult> {
      assertWorkspaceId(request.workspaceId);
      const document = await readDocument();
      const limit = request.limit ?? 50;
      const normalizedModels = (document.models ?? []).map(
        normalizeModelInventoryRecord,
      );
      const includeSharedStorage =
        request.includeDiscovered !== false ||
        request.includeSharedStorage === true;
      const sharedModels = includeSharedStorage
        ? await discoverSharedModels(normalizedModels, request.workspaceId)
        : [];
      const allModels = [...normalizedModels, ...sharedModels];

      const filtered = allModels.filter((model) =>
        matchesFilters(model, request),
      );
      return {
        models: filtered.slice(0, limit),
        nextCursor:
          filtered.length > limit ? filtered[limit]?.modelRecordId : undefined,
      };
    },

    async getModelRecord(
      workspaceId: WorkspaceId,
      modelRecordId: string,
    ): Promise<ModelInventoryRecord | undefined> {
      assertWorkspaceId(workspaceId);
      const document = await readDocument();
      const persisted = (document.models ?? [])
        .map(normalizeModelInventoryRecord)
        .find(
          (record) =>
            record.workspaceId === workspaceId &&
            record.modelRecordId === modelRecordId,
        );
      if (persisted) return persisted;
      return (
        await discoverSharedModels(
          (document.models ?? []).map(normalizeModelInventoryRecord),
          workspaceId,
        )
      ).find((record) => record.modelRecordId === modelRecordId);
    },

    async saveModelReference(
      request: SaveModelReferenceRequest,
    ): Promise<SaveModelReferenceResult> {
      assertWorkspaceId(request.workspaceId);
      const timestamp = now();
      const modelRecordId =
        request.modelRecordId ??
        buildStableModelRecordId(
          `save:${request.provider}:${request.modelId}:${request.displayName ?? ""}`,
        );
      const record = normalizeModelInventoryRecord({
        modelRecordId,
        workspaceId: request.workspaceId,
        displayName: request.displayName?.trim() || request.modelId,
        source: "huggingface",
        lifecycleStatus: "saved-reference",
        artifactForm: request.artifactForm ?? "full-model",
        provider: request.provider,
        modelId: request.modelId,
        inferenceMode: request.inferenceMode,
        taskTags: request.taskTags,
        createdAt: timestamp,
        metadata: request.metadata,
        storageScope: "workspace",
      });

      await updateDocument((document) => ({
        document: {
          ...document,
          models: [
            ...(document.models ?? []).filter(
              (model) =>
                model.workspaceId !== record.workspaceId ||
                model.modelRecordId !== record.modelRecordId,
            ),
            record,
          ],
        },
        result: undefined,
      }));

      return { model: record };
    },

    async registerDownloadedModel(
      request: RegisterDownloadedModelRequest,
    ): Promise<RegisterDownloadedModelResult> {
      assertWorkspaceId(request.workspaceId);
      const timestamp = now();
      const modelRecordId =
        request.modelRecordId ??
        buildStableModelRecordId(
          `downloaded:${request.provider}:${request.modelId ?? request.localPath ?? request.displayName}`,
        );
      const record = normalizeModelInventoryRecord({
        modelRecordId,
        workspaceId: request.workspaceId,
        displayName: request.displayName,
        source: request.source,
        lifecycleStatus: "downloaded",
        artifactForm: request.artifactForm,
        provider: request.provider,
        modelId: request.modelId,
        localPath: request.localPath,
        backingArtifactIds: request.backingArtifactIds,
        primaryArtifactId: request.primaryArtifactId,
        validationStatus: request.validationStatus,
        validationReportPath: request.validationReportPath,
        inferenceMode: request.inferenceMode,
        taskTags: request.taskTags,
        baseModelId: request.baseModelId,
        adapterOfModelId: request.adapterOfModelId,
        serializationFormat:
          request.serializationFormat as ModelInventoryRecord["serializationFormat"],
        sizeBytes: request.sizeBytes,
        createdAt: timestamp,
        metadata: request.metadata,
        storageScope: "workspace",
      });

      await updateDocument((document) => ({
        document: {
          ...document,
          models: [
            ...(document.models ?? []).filter(
              (model) =>
                model.workspaceId !== record.workspaceId ||
                model.modelRecordId !== record.modelRecordId,
            ),
            record,
          ],
        },
        result: undefined,
      }));
      return { model: record };
    },

    async registerGeneratedModel(
      request: RegisterGeneratedModelRequest,
    ): Promise<RegisterGeneratedModelResult> {
      assertWorkspaceId(request.workspaceId);
      const timestamp = now();
      const modelRecordId =
        request.modelRecordId ??
        buildStableModelRecordId(
          `generated:${request.generatedFromRunId ?? "no-run"}:${request.displayName}:${request.modelId ?? ""}`,
        );
      const record = normalizeModelInventoryRecord({
        modelRecordId,
        workspaceId: request.workspaceId,
        displayName: request.displayName,
        source: "generated",
        lifecycleStatus: "generated",
        artifactForm: request.artifactForm,
        provider: request.provider ?? "unknown",
        modelId: request.modelId,
        localPath: request.localPath,
        backingArtifactIds: request.backingArtifactIds,
        primaryArtifactId: request.primaryArtifactId,
        inferenceMode: request.inferenceMode,
        taskTags: request.taskTags,
        baseModelId: request.baseModelId,
        adapterOfModelId: request.adapterOfModelId,
        generatedFromRunId: request.generatedFromRunId,
        serializationFormat:
          request.serializationFormat as ModelInventoryRecord["serializationFormat"],
        sizeBytes: request.sizeBytes,
        createdAt: timestamp,
        metadata: request.metadata,
        storageScope: "workspace",
      });

      await updateDocument((document) => ({
        document: {
          ...document,
          models: [
            ...(document.models ?? []).filter(
              (model) =>
                model.workspaceId !== record.workspaceId ||
                model.modelRecordId !== record.modelRecordId,
            ),
            record,
          ],
        },
        result: undefined,
      }));
      return { model: record };
    },

    async updateModelRecord(
      request: UpdateModelRecordRequest,
    ): Promise<UpdateModelRecordResult> {
      assertWorkspaceId(request.workspaceId);
      const updatedAt = now();
      const updated = await updateDocument<ModelInventoryRecord | undefined>(
        (document) => {
          let updatedRecord: ModelInventoryRecord | undefined;
          const models = (document.models ?? []).map((candidate) => {
            const normalized = normalizeModelInventoryRecord(candidate);
            if (
              normalized.workspaceId !== request.workspaceId ||
              normalized.modelRecordId !== request.modelRecordId
            ) {
              return normalized;
            }

            updatedRecord = normalizeModelInventoryRecord({
              ...normalized,
              ...request.patch,
              modelRecordId: normalized.modelRecordId,
              createdAt: normalized.createdAt,
              updatedAt,
            });
            return updatedRecord;
          });

          return {
            document: { ...document, models },
            result: updatedRecord,
          };
        },
      );

      if (!updated) {
        throw new Error(`Model record ${request.modelRecordId} was not found.`);
      }

      return { model: updated };
    },

    async deleteModelRecord(
      request: DeleteModelRecordRequest,
    ): Promise<DeleteModelRecordResult> {
      assertWorkspaceId(request.workspaceId);
      const deleted = await updateDocument((document) => {
        let deletedRecord = false;
        const models = (document.models ?? []).filter((candidate) => {
          const normalized = normalizeModelInventoryRecord(candidate);
          const keep =
            normalized.workspaceId !== request.workspaceId ||
            normalized.modelRecordId !== request.modelRecordId;
          if (!keep) {
            deletedRecord = true;
          }
          return keep;
        });

        return {
          document: { ...document, models },
          result: deletedRecord,
        };
      });

      if (!deleted) {
        throw new Error(`Model record ${request.modelRecordId} was not found.`);
      }

      return {
        deletedModelRecordId: request.modelRecordId,
        deletedRegistryRecord: true,
        deletedLocalFiles: false,
        deletedBackingArtifactIds: [],
      };
    },
  };
}
