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
import type { ArtifactStorageBindingBatchReadPort } from "../../../../application/ports/storage";
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
  type ArtifactStorageBinding,
  type ArtifactStorageBindingRole,
  type StorageObjectMetadata,
} from "../../../../contracts/storage";
import { isWorkspaceId, type WorkspaceId } from "../../../../contracts/workspace";
import { resolveArtifactFamily } from "../../../../application/shared/artifact-family-classifier";
import type { OrganizationRequestContextProviderPort } from "../../../../application/ports/organization";
import { resolveOrganizationStorageKey } from "../organizationStorageScope";
import {
  deleteContainedFile,
  FilesystemContainmentError,
  listContainedFiles,
  statContainedFile,
} from "../../../filesystem-security";

export interface FilesystemArtifactBrowserReadAdapter
  extends ArtifactBrowserMetadataReadPort,
  ArtifactBrowserContentReadPort,
  ArtifactBrowserUnregisteredPort {}

export interface CreateFilesystemArtifactBrowserReadAdapterOptions {
  rootDirectory: string;
  artifactCatalogRead: ArtifactCatalogReadPort;
  artifactCatalogAppend: ArtifactCatalogAppendPort;
  storage?: Pick<ArtifactObjectStoragePort, "hasArtifact">;
  artifactBindingRead?: Pick<ArtifactStorageBindingPort, "readArtifactStorageBindings">
    & Partial<Pick<ArtifactStorageBindingBatchReadPort, "readArtifactStorageBindingsBatch">>;
  organizationContextProvider?: OrganizationRequestContextProviderPort;
  maximumBrowseItems?: number;
  browseAvailabilityConcurrency?: number;
}

const UPLOADS_ROOT_SEGMENT = "uploads";
const DEFAULT_MAXIMUM_BROWSE_ITEMS = 250;
const DEFAULT_BROWSE_AVAILABILITY_CONCURRENCY = 8;


function requireWorkspaceId(context: ApplicationRequestContext): WorkspaceId | undefined {
  return isWorkspaceId(context.workspaceId) ? context.workspaceId : undefined;
}

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
  prefetchedBindings?: readonly ArtifactStorageBinding[],
): Promise<ArtifactBrowserStateMetadata | undefined> {
  const [publishedBacking, importedSourceBacking, hasLocalObjectAvailable] = await Promise.all([
    prefetchedBindings
      ? Promise.resolve(readLatestRepoBackingFromBindings(prefetchedBindings, "published"))
      : readLatestRepoBackingByRole(options, artifactId, context, "published"),
    prefetchedBindings
      ? Promise.resolve(readLatestRepoBackingFromBindings(prefetchedBindings, "imported-source"))
      : readLatestRepoBackingByRole(options, artifactId, context, "imported-source"),
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

function readLatestRepoBackingFromBindings(
  bindings: readonly ArtifactStorageBinding[],
  role: ArtifactStorageBindingRole,
): RepoBackingReadModel | undefined {
  const latestBinding = bindings
    .filter((binding) => binding.role === role && binding.backing.kind === "artifact-repo")
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))[0];
  if (!latestBinding) return undefined;
  const target = resolveArtifactRepoBackingTarget(latestBinding.backing);
  if (!target) return undefined;
  return {
    target,
    verification: {
      exists: latestBinding.backing.verification?.exists ?? false,
      verifiedAt: latestBinding.backing.verification?.verifiedAt,
    },
  };
}

async function mapWithConcurrency<T, TResult>(
  values: readonly T[],
  concurrency: number,
  map: (value: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await map(values[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
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
  const maximumBrowseItems = options.maximumBrowseItems ?? DEFAULT_MAXIMUM_BROWSE_ITEMS;
  const browseAvailabilityConcurrency = options.browseAvailabilityConcurrency
    ?? DEFAULT_BROWSE_AVAILABILITY_CONCURRENCY;
  if (!Number.isSafeInteger(maximumBrowseItems) || maximumBrowseItems < 1 || maximumBrowseItems > 250) {
    throw new Error("maximumBrowseItems must be a safe integer between 1 and 250.");
  }
  if (
    !Number.isSafeInteger(browseAvailabilityConcurrency)
    || browseAvailabilityConcurrency < 1
    || browseAvailabilityConcurrency > 16
  ) {
    throw new Error("browseAvailabilityConcurrency must be a safe integer between 1 and 16.");
  }
  const resolveScopedStorageKey = (storageKey: string) => resolveOrganizationStorageKey(
    storageKey,
    options.organizationContextProvider,
  );

  return {
    async browseArtifacts(
      request: BrowseArtifactsRequest,
      context: ApplicationRequestContext = {},
    ) {
      const browseResult = await options.artifactCatalogRead.browseArtifactCatalogRecords(
        {
          workspaceId: requireWorkspaceId(context),
          artifactFamily: request.artifactFamily,
        },
        context,
      );

      if (!browseResult.ok) {
        return browseResult;
      }

      const items = browseResult.value.records
        .map((record) => toBrowseItem(record))
        .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))
        .slice(0, maximumBrowseItems);

      const bindingsByArtifactId = new Map<string, ArtifactStorageBinding[]>();
      if (items.length > 0 && options.artifactBindingRead?.readArtifactStorageBindingsBatch) {
        const batch = await options.artifactBindingRead.readArtifactStorageBindingsBatch({
          artifactIds: items.map((item) => item.storageKey),
        }, context);
        if (batch.ok) {
          for (const item of items) bindingsByArtifactId.set(item.storageKey, []);
          for (const binding of batch.value.bindings) {
            const workspaceId = requireWorkspaceId(context);
            if (binding.workspaceId && binding.workspaceId !== workspaceId) continue;
            const bindings = bindingsByArtifactId.get(binding.artifactId) ?? [];
            bindings.push(binding);
            bindingsByArtifactId.set(binding.artifactId, bindings);
          }
        }
      }

      const enrichedItems = await mapWithConcurrency(items, browseAvailabilityConcurrency, async (item) => {
        const stateMetadata = await readBrowseStateMetadata(
          options,
          item.storageKey,
          context,
          bindingsByArtifactId.get(item.storageKey),
        );
        if (!stateMetadata) {
          return item;
        }

        return {
          ...item,
          metadata: withArtifactStateMetadata(item.metadata, stateMetadata),
        };
      });

      return createSuccessResult({ items: enrichedItems }, context);
    },

    async readArtifactDetail<TMetadata extends StorageObjectMetadata = StorageObjectMetadata>(
      request: ReadArtifactDetailRequest,
      context: ApplicationRequestContext = {},
    ) {
      const storageKey = normalizeStorageArtifactKey(request.locator.storageKey);
      const readResult = await options.artifactCatalogRead.readArtifactCatalogRecord(
        { workspaceId: requireWorkspaceId(context), storageKey },
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
        { workspaceId: requireWorkspaceId(context), storageKey },
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
      const catalogResult = await options.artifactCatalogRead.browseArtifactCatalogRecords(
        { workspaceId: requireWorkspaceId(context) },
        context,
      );

      if (!catalogResult.ok) {
        return catalogResult;
      }

      let uploadRelativePaths: string[];
      try {
        uploadRelativePaths = await listContainedFiles({
          rootDirectory: options.rootDirectory,
          prefix: resolveScopedStorageKey(UPLOADS_ROOT_SEGMENT),
        });
      } catch (error) {
        return createFailureResult(
          createContractError(
            error instanceof FilesystemContainmentError ? "validation" : "unavailable",
            "Unable to inspect unregistered artifact storage safely.",
          ),
          context,
        );
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
          const fileStats = await statContainedFile({
            rootDirectory: options.rootDirectory,
            key: resolveScopedStorageKey(storageKey),
          }).catch(() => undefined);

          return {
            storageKey,
            relativePath,
            fileName: path.basename(relativePath),
            mediaType: inferMediaTypeFromStorageKey(storageKey),
            sizeBytes: fileStats?.size,
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

      const catalogResult = await options.artifactCatalogRead.browseArtifactCatalogRecords(
        { workspaceId: requireWorkspaceId(context) },
        context,
      );

      if (!catalogResult.ok) {
        return catalogResult;
      }

      let fileStats: Awaited<ReturnType<typeof statContainedFile>> | undefined;
      try {
        fileStats = await statContainedFile({
          rootDirectory: options.rootDirectory,
          key: resolveScopedStorageKey(storageKey),
        });
      } catch (error) {
        if (error instanceof FilesystemContainmentError) {
          return createFailureResult(
            createContractError("validation", "Unregistered artifact path is not safely contained."),
            context,
          );
        }
      }

      if (!fileStats) {
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
          workspaceId: requireWorkspaceId(context),
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

      const catalogResult = await options.artifactCatalogRead.browseArtifactCatalogRecords({ workspaceId: requireWorkspaceId(context) }, context);
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
        const deletion = await deleteContainedFile({
          rootDirectory: options.rootDirectory,
          key: resolveScopedStorageKey(storageKey),
        });
        if (!deletion.deleted) {
          return createFailureResult(
            createContractError("not-found", `Unregistered artifact file not found for "${storageKey}".`),
            context,
          );
        }
      } catch (error) {
        if (error instanceof FilesystemContainmentError) {
          return createFailureResult(
            createContractError("validation", "Unregistered artifact path is not safely contained."),
            context,
          );
        }
        return createFailureResult(
          createContractError("not-found", `Unregistered artifact file not found for "${storageKey}".`),
          context,
        );
      }

      return createSuccessResult({ storageKey }, context);
    },
  };
}
