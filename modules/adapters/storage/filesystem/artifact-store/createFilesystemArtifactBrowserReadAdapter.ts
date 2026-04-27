import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

import type {
  ArtifactCatalogAppendPort,
  ArtifactCatalogReadPort,
  ArtifactCatalogRecord,
} from "../../../../application/ports/artifact-catalog";
import type {
  ArtifactBrowserContentReadPort,
  ArtifactBrowserMetadataReadPort,
  ArtifactBrowserUnregisteredPort,
  BrowseArtifactsRequest,
  ReadArtifactContentRequest,
  ReadArtifactDetailRequest,
} from "../../../../application/ports/artifact-browser";
import type { ApplicationRequestContext } from "../../../../application/ports";
import type { ArtifactObjectStoragePort } from "../../../../application/ports/storage";
import type { ArtifactStorageBindingPort } from "../../../../application/ports/storage";
import {
  createArtifactBrowserLocator,
  type ArtifactBrowseItem,
  type ArtifactContentReadSuccessValue,
  type ArtifactReadSuccessValue,
} from "../../../../contracts/artifact-browser";
import {
  createContractError,
  createFailureResult,
  createSuccessResult,
} from "../../../../contracts/shared";
import {
  normalizeStorageArtifactKey,
  resolveArtifactRepoBackingTarget,
  type ArtifactStorageBindingRole,
  type StorageObjectMetadata,
} from "../../../../contracts/storage";
import { resolveArtifactFamily } from "../../../../application/shared/artifact-family-classifier";

export interface FilesystemArtifactBrowserReadAdapter
  extends ArtifactBrowserMetadataReadPort,
  ArtifactBrowserContentReadPort,
  ArtifactBrowserUnregisteredPort {}

export interface CreateFilesystemArtifactBrowserReadAdapterOptions {
  rootDirectory: string;
  artifactCatalogRead: ArtifactCatalogReadPort;
  artifactCatalogAppend: ArtifactCatalogAppendPort;
  storage?: Pick<ArtifactObjectStoragePort, "hasArtifact">;
  artifactBindingRead?: Pick<ArtifactStorageBindingPort, "readArtifactStorageBindings">;
}

const UPLOADS_ROOT_SEGMENT = "uploads";

function toUploadStorageKeyRelativePath(storageKey: string): string | undefined {
  const normalized = normalizeStorageArtifactKey(storageKey);
  if (!normalized.startsWith(`${UPLOADS_ROOT_SEGMENT}/`)) {
    return undefined;
  }

  return normalized.slice(UPLOADS_ROOT_SEGMENT.length + 1);
}

function inferMediaTypeFromStorageKey(storageKey: string): string | undefined {
  const extension = path.extname(storageKey).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json";
    case ".parquet":
      return "application/x-parquet";
    case ".txt":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".pdf":
      return "application/pdf";
    default:
      return undefined;
  }
}

async function listRelativeFilesRecursively(rootDirectory: string): Promise<string[]> {
  async function walk(absoluteDirectory: string, relativePrefix: string): Promise<string[]> {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true }).catch(() => []);
    const discovered: string[] = [];
    for (const entry of entries) {
      const relativePath = relativePrefix.length > 0
        ? `${relativePrefix}/${entry.name}`
        : entry.name;
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        discovered.push(...(await walk(absolutePath, relativePath)));
        continue;
      }

      if (entry.isFile()) {
        discovered.push(relativePath);
      }
    }

    return discovered;
  }

  return walk(rootDirectory, "");
}

interface RepoBackingReadModel {
  target: {
    provider: string;
    repository: string;
    path: string;
    revision?: string;
    locator: string;
  };
  verification: {
    exists: boolean;
    verifiedAt?: string;
  };
}

interface ArtifactBrowserStateMetadata {
  backingState: {
    hasImportedSourceBacking: boolean;
    hasPublishedBacking: boolean;
    hasLocalObjectAvailable: boolean;
    isLocalized: boolean;
    isRemoteOnly: boolean;
  };
}

function withPublishedBackingMetadata<TMetadata extends StorageObjectMetadata>(
  metadata: TMetadata | undefined,
  repoBackings: {
    publishedBacking?: RepoBackingReadModel;
    importedSourceBacking?: RepoBackingReadModel;
  },
): TMetadata {
  return {
    ...(metadata ?? {}),
    ...repoBackings,
  } as unknown as TMetadata;
}

function withArtifactStateMetadata<TMetadata extends StorageObjectMetadata>(
  metadata: TMetadata | undefined,
  stateMetadata: ArtifactBrowserStateMetadata,
): TMetadata {
  return {
    ...(metadata ?? {}),
    ...stateMetadata,
  } as unknown as TMetadata;
}

async function readLatestRepoBackingByRole(
  options: CreateFilesystemArtifactBrowserReadAdapterOptions,
  artifactId: string,
  context: ApplicationRequestContext,
  role: ArtifactStorageBindingRole,
): Promise<RepoBackingReadModel | undefined> {
  if (!options.artifactBindingRead) {
    return undefined;
  }

  const bindingsResult = await options.artifactBindingRead.readArtifactStorageBindings({ artifactId }, context);
  if (!bindingsResult.ok) {
    return undefined;
  }

  const latestPublishedBinding = bindingsResult.value.bindings
    .filter((binding) => binding.role === role && binding.backing.kind === "artifact-repo")
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))[0];

  if (!latestPublishedBinding) {
    return undefined;
  }

  const target = resolveArtifactRepoBackingTarget(latestPublishedBinding.backing);
  if (!target) {
    return undefined;
  }

  return {
    target,
    verification: {
      exists: latestPublishedBinding.backing.verification?.exists ?? false,
      verifiedAt: latestPublishedBinding.backing.verification?.verifiedAt,
    },
  };
}

function toBrowseItem(record: ArtifactCatalogRecord): ArtifactBrowseItem {
  return {
    artifactId: record.storageKey,
    storageKey: record.storageKey,
    artifactFamily: record.artifactFamily,
    mediaType: record.mediaType,
    sizeBytes: record.sizeBytes,
    sourceKind: record.sourceKind,
    originalName: record.originalName,
    createdAt: record.createdAt,
  };
}

async function readLocalObjectAvailability(
  options: CreateFilesystemArtifactBrowserReadAdapterOptions,
  artifactId: string,
  context: ApplicationRequestContext,
): Promise<boolean> {
  if (!options.storage) {
    return false;
  }

  const hasArtifactResult = await options.storage.hasArtifact({ key: artifactId }, context);
  return hasArtifactResult.ok && hasArtifactResult.value.exists;
}

async function readBrowseStateMetadata(
  options: CreateFilesystemArtifactBrowserReadAdapterOptions,
  artifactId: string,
  context: ApplicationRequestContext,
): Promise<ArtifactBrowserStateMetadata | undefined> {
  const [publishedBacking, importedSourceBacking, hasLocalObjectAvailable] = await Promise.all([
    readLatestRepoBackingByRole(options, artifactId, context, "published"),
    readLatestRepoBackingByRole(options, artifactId, context, "imported-source"),
    readLocalObjectAvailability(options, artifactId, context),
  ]);

  const hasImportedSourceBacking = Boolean(importedSourceBacking);
  const hasPublishedBacking = Boolean(publishedBacking);
  const isLocalized = hasImportedSourceBacking && hasLocalObjectAvailable;
  const isRemoteOnly = hasImportedSourceBacking && !hasLocalObjectAvailable;
  return {
    backingState: {
      hasImportedSourceBacking,
      hasPublishedBacking,
      hasLocalObjectAvailable,
      isLocalized,
      isRemoteOnly,
    },
  };
}

function toDetailValue(record: ArtifactCatalogRecord): ArtifactReadSuccessValue {
  return {
    artifact: {
      locator: createArtifactBrowserLocator(record.storageKey),
      artifactFamily: record.artifactFamily,
      mediaType: record.mediaType,
      sizeBytes: record.sizeBytes,
      checksum: record.checksum,
      sourceKind: record.sourceKind,
      originalName: record.originalName,
      createdAt: record.createdAt,
    },
  };
}

function toContentValue(record: ArtifactCatalogRecord): ArtifactContentReadSuccessValue {
  return {
    content: {
      locator: createArtifactBrowserLocator(record.storageKey),
      mediaType: record.mediaType,
      sizeBytes: record.sizeBytes,
      availability: "available",
      retrieval: "deferred",
    },
  };
}

export function createFilesystemArtifactBrowserReadAdapter(
  options: CreateFilesystemArtifactBrowserReadAdapterOptions,
): FilesystemArtifactBrowserReadAdapter {
  const uploadsRoot = path.resolve(options.rootDirectory, UPLOADS_ROOT_SEGMENT);

  return {
    async browseArtifacts(
      request: BrowseArtifactsRequest,
      context: ApplicationRequestContext = {},
    ) {
      const browseResult = await options.artifactCatalogRead.browseArtifactCatalogRecords(
        {
          artifactFamily: request.artifactFamily,
        },
        context,
      );

      if (!browseResult.ok) {
        return browseResult;
      }

      const items = browseResult.value.records
        .map((record) => toBrowseItem(record))
        .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));

      const enrichedItems = await Promise.all(items.map(async (item) => {
        const stateMetadata = await readBrowseStateMetadata(options, item.storageKey, context);
        if (!stateMetadata) {
          return item;
        }

        return {
          ...item,
          metadata: withArtifactStateMetadata(item.metadata, stateMetadata),
        };
      }));

      return createSuccessResult({ items: enrichedItems }, context);
    },

    async readArtifactDetail<TMetadata extends StorageObjectMetadata = StorageObjectMetadata>(
      request: ReadArtifactDetailRequest,
      context: ApplicationRequestContext = {},
    ) {
      const storageKey = normalizeStorageArtifactKey(request.locator.storageKey);
      const readResult = await options.artifactCatalogRead.readArtifactCatalogRecord(
        { storageKey },
        context,
      );

      if (!readResult.ok) {
        return readResult;
      }

      const detail = toDetailValue(readResult.value.record) as ArtifactReadSuccessValue<TMetadata>;
          const [publishedBacking, importedSourceBacking] = await Promise.all([
        readLatestRepoBackingByRole(options, storageKey, context, "published"),
        readLatestRepoBackingByRole(options, storageKey, context, "imported-source"),
      ]);
      if (publishedBacking || importedSourceBacking) {
        detail.artifact.metadata = withPublishedBackingMetadata(
          detail.artifact.metadata as TMetadata | undefined,
          {
            ...(publishedBacking ? { publishedBacking } : {}),
            ...(importedSourceBacking ? { importedSourceBacking } : {}),
          },
        );
      }

      return createSuccessResult(detail, context);
    },

    async readArtifactContent(
      request: ReadArtifactContentRequest,
      context: ApplicationRequestContext = {},
    ) {
      const storageKey = normalizeStorageArtifactKey(request.locator.storageKey);
      const readResult = await options.artifactCatalogRead.readArtifactCatalogRecord(
        { storageKey },
        context,
      );

      if (!readResult.ok) {
        return readResult;
      }

      if (options.storage) {
        const hasArtifactResult = await options.storage.hasArtifact(
          {
            key: storageKey,
          },
          context,
        );

        if (!hasArtifactResult.ok) {
          return createFailureResult(
            createContractError(
              hasArtifactResult.error.code === "validation" ? "unavailable" : hasArtifactResult.error.code,
              hasArtifactResult.error.message,
              { details: hasArtifactResult.error.details },
            ),
            context,
          );
        }

        if (!hasArtifactResult.value.exists) {
          const importedSourceBacking = await readLatestRepoBackingByRole(
            options,
            storageKey,
            context,
            "imported-source",
          );
          if (importedSourceBacking) {
            return createSuccessResult({
              content: {
                locator: createArtifactBrowserLocator(storageKey),
                mediaType: readResult.value.record.mediaType,
                sizeBytes: readResult.value.record.sizeBytes,
                availability: "unavailable",
                retrieval: "deferred",
              },
            }, context);
          }
          return createFailureResult(
            createContractError(
              "not-found",
              `Artifact content not found for storage key \"${storageKey}\".`,
            ),
            context,
          );
        }
      }

      return createSuccessResult(toContentValue(readResult.value.record), context);
    },

    async browseUnregisteredArtifacts(context: ApplicationRequestContext = {}) {
      const [catalogResult, uploadRelativePaths] = await Promise.all([
        options.artifactCatalogRead.browseArtifactCatalogRecords({}, context),
        listRelativeFilesRecursively(uploadsRoot),
      ]);

      if (!catalogResult.ok) {
        return catalogResult;
      }

      const registeredUploadKeys = new Set(
        catalogResult.value.records
          .map((record) => toUploadStorageKeyRelativePath(record.storageKey))
          .filter((key): key is string => typeof key === "string"),
      );

      const items = await Promise.all(uploadRelativePaths
        .filter((relativePath) => !registeredUploadKeys.has(relativePath))
        .map(async (relativePath) => {
          const storageKey = normalizeStorageArtifactKey(`${UPLOADS_ROOT_SEGMENT}/${relativePath}`);
          const fileStats = await stat(path.resolve(uploadsRoot, relativePath)).catch(() => undefined);

          return {
            storageKey,
            relativePath,
            fileName: path.basename(relativePath),
            mediaType: inferMediaTypeFromStorageKey(storageKey),
            sizeBytes: fileStats?.isFile() ? fileStats.size : undefined,
          };
        }));

      return createSuccessResult({ items }, context);
    },

    async registerUnregisteredArtifact(request: { storageKey: string }, context: ApplicationRequestContext = {}) {
      const storageKey = normalizeStorageArtifactKey(request.storageKey);
      if (!storageKey.startsWith(`${UPLOADS_ROOT_SEGMENT}/`)) {
        return createFailureResult(
          createContractError("validation", "Unregistered artifact must be under the uploads/ storage subtree."),
          context,
        );
      }

      const [catalogResult, fileStats] = await Promise.all([
        options.artifactCatalogRead.browseArtifactCatalogRecords({}, context),
        stat(path.resolve(options.rootDirectory, storageKey)).catch(() => undefined),
      ]);

      if (!catalogResult.ok) {
        return catalogResult;
      }

      if (!fileStats?.isFile()) {
        return createFailureResult(
          createContractError("not-found", `Unregistered artifact file not found for "${storageKey}".`),
          context,
        );
      }

      const alreadyRegistered = catalogResult.value.records.some((record) => record.storageKey === storageKey);
      if (alreadyRegistered) {
        return createFailureResult(
          createContractError("conflict", `Artifact "${storageKey}" is already registered.`),
          context,
        );
      }

      const mediaType = inferMediaTypeFromStorageKey(storageKey);
      const appendResult = await options.artifactCatalogAppend.appendArtifactCatalogRecord({
        record: {
          storageKey,
          artifactFamily: resolveArtifactFamily({ mediaType, fileName: storageKey }),
          mediaType,
          sizeBytes: fileStats.size,
          sourceKind: "upload",
          originalName: path.basename(storageKey),
          createdAt: new Date().toISOString(),
        },
      }, context);

      if (!appendResult.ok) {
        return appendResult;
      }

      return createSuccessResult({ storageKey }, context);
    },

    async deleteUnregisteredArtifact(request: { storageKey: string }, context: ApplicationRequestContext = {}) {
      const storageKey = normalizeStorageArtifactKey(request.storageKey);
      if (!storageKey.startsWith(`${UPLOADS_ROOT_SEGMENT}/`)) {
        return createFailureResult(
          createContractError("validation", "Unregistered artifact must be under the uploads/ storage subtree."),
          context,
        );
      }

      const catalogResult = await options.artifactCatalogRead.browseArtifactCatalogRecords({}, context);
      if (!catalogResult.ok) {
        return catalogResult;
      }

      const alreadyRegistered = catalogResult.value.records.some((record) => record.storageKey === storageKey);
      if (alreadyRegistered) {
        return createFailureResult(
          createContractError("conflict", `Artifact "${storageKey}" is registered and cannot be deleted via unregistered flow.`),
          context,
        );
      }

      try {
        await unlink(path.resolve(options.rootDirectory, storageKey));
      } catch {
        return createFailureResult(
          createContractError("not-found", `Unregistered artifact file not found for "${storageKey}".`),
          context,
        );
      }

      return createSuccessResult({ storageKey }, context);
    },
  };
}
