import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LoggingPort } from "../../../../application/ports/logging";
import type { ApplicationRequestContext } from "../../../../application/ports";
import type { ArtifactCatalogAppendPort } from "../../../../application/ports/artifact-catalog";
import type { ArtifactObjectStoragePort } from "../../../../application/ports/storage";
import { resolveArtifactFamily } from "../../../../application/shared/artifact-family-classifier";
import type { ContractErrorCode } from "../../../../contracts/shared";
import { createContractError } from "../../../../contracts/shared";
import {
  createDeleteArtifactFailureResult,
  createDeleteArtifactSuccessResult,
  createHasArtifactFailureResult,
  createHasArtifactSuccessResult,
  createRetrieveArtifactFailureResult,
  createRetrieveArtifactSuccessResult,
  createStoreArtifactFailureResult,
  createStoreArtifactSuccessResult,
  normalizeStorageArtifactKey,
  type StorageObjectChecksum,
  type DeleteArtifactRequest,
  type DeleteArtifactResult,
  type HasArtifactRequest,
  type HasArtifactResult,
  type RetrieveArtifactRequest,
  type RetrieveArtifactResult,
  type StoreArtifactRequest,
  type StoreArtifactResult,
} from "../../../../contracts/storage";

const STORAGE_COMPONENT = "adapters.storage.filesystem";
const DEFAULT_STORAGE_HOST = "desktop";
const STORAGE_CHECKSUM_ALGORITHM = "sha256";

class StorageAdapterValidationError extends Error {}
class StorageAdapterVerificationError extends Error {}

export interface CreateFilesystemArtifactStorageAdapterOptions {
  rootDirectory: string;
  host?: "desktop" | "server";
  logging?: LoggingPort;
  now?: () => string;
  randomSuffix?: () => string;
  statPath?: typeof stat;
  artifactCatalogAppend?: ArtifactCatalogAppendPort;
}

function isFsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function toErrorCode(
  error: unknown,
  fallback: ContractErrorCode = "internal",
): ContractErrorCode {
  if (error instanceof StorageAdapterValidationError) {
    return "validation";
  }

  if (error instanceof StorageAdapterVerificationError) {
    return "unavailable";
  }

  if (!isFsError(error)) {
    return fallback;
  }

  switch (error.code) {
    case "ENOENT":
      return "not-found";
    case "EEXIST":
      return "conflict";
    case "EACCES":
    case "EPERM":
    case "EROFS":
    case "ENOSPC":
    case "EMFILE":
    case "ENFILE":
    case "EBUSY":
    case "ENOTDIR":
      return "unavailable";
    default:
      return fallback;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function resolvePathInsideRoot(rootDirectory: string, key: string): string {
  const segments = key
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    throw new StorageAdapterValidationError("Storage key must include at least one segment.");
  }

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new StorageAdapterValidationError(
        "Storage key segments must not contain path traversal tokens.",
      );
    }
  }

  const absolutePath = path.resolve(rootDirectory, ...segments);
  const relativePath = path.relative(rootDirectory, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new StorageAdapterValidationError(
      "Storage key must resolve to a path inside the configured storage root.",
    );
  }

  return absolutePath;
}

function toBytes(content: unknown): Uint8Array {
  if (content instanceof Uint8Array) {
    return content;
  }

  if (content instanceof ArrayBuffer) {
    return new Uint8Array(content);
  }

  if (ArrayBuffer.isView(content)) {
    return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  }

  throw new StorageAdapterValidationError("Storage content must be binary bytes.");
}

function extensionForMediaType(mediaType: string | undefined): string {
  switch (mediaType?.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    case "application/x-ndjson":
    case "application/jsonl":
      return "jsonl";
    case "application/json":
    case "text/json":
      return "json";
    case "text/csv":
    case "application/csv":
      return "csv";
    case "application/x-parquet":
    case "application/vnd.apache.parquet":
      return "parquet";
    case "text/plain":
      return "txt";
    default:
      return "bin";
  }
}

function extensionFromOriginalFileName(originalFileName: string | undefined): string | undefined {
  if (typeof originalFileName !== "string") {
    return undefined;
  }

  const normalized = path.basename(originalFileName.trim());
  if (normalized.length === 0) {
    return undefined;
  }

  const dot = normalized.lastIndexOf(".");
  if (dot <= 0 || dot === normalized.length - 1) {
    return undefined;
  }

  return normalized.slice(dot + 1).toLowerCase();
}

function createContentChecksum(bytes: Uint8Array): StorageObjectChecksum {
  const digest = createHash(STORAGE_CHECKSUM_ALGORITHM).update(bytes).digest("hex");

  return {
    algorithm: STORAGE_CHECKSUM_ALGORITHM,
    value: digest,
  };
}


function resolveRequestContext(
  request: { requestId?: string; correlationId?: string },
  context: ApplicationRequestContext | undefined,
): ApplicationRequestContext {
  return {
    requestId: context?.requestId ?? request.requestId,
    correlationId: context?.correlationId ?? request.correlationId,
  };
}

export function createFilesystemArtifactObjectStorageAdapter(
  options: CreateFilesystemArtifactStorageAdapterOptions,
): ArtifactObjectStoragePort {
  if (options.rootDirectory.trim().length === 0) {
    throw new Error("rootDirectory must be a non-empty path.");
  }

  const rootDirectory = path.resolve(options.rootDirectory);
  const logging = options.logging;
  const now = options.now ?? (() => new Date().toISOString());
  const randomSuffix = options.randomSuffix ?? (() => randomUUID().replaceAll("-", ""));
  const statPath = options.statPath ?? stat;

  async function logBoundaryEvent(event: {
    level: "debug" | "info" | "warn" | "error";
    name: string;
    message: string;
    operation: string;
    requestId?: string;
    correlationId?: string;
    durationMs?: number;
    outcome?: "success" | "failure";
    data?: Readonly<Record<string, unknown>>;
    error?: {
      errorType: string;
      errorCode?: string;
      errorMessage: string;
      details?: Readonly<Record<string, unknown>>;
    };
  }): Promise<void> {
    if (!logging) {
      return;
    }

    try {
      await logging.log({
        timestamp: now(),
        level: event.level,
        verbosity: "normal",
        event: event.name,
        message: event.message,
        component: STORAGE_COMPONENT,
        operation: event.operation,
        host: options.host ?? DEFAULT_STORAGE_HOST,
        requestId: event.requestId,
        correlationId: event.correlationId,
        durationMs: event.durationMs,
        outcome: event.outcome,
        data: event.data,
        error: event.error,
      });
    } catch {
      // Logging must never break storage operations.
    }
  }

  function createGeneratedKey(input: {
    mediaType: string | undefined;
    originalFileName: string | undefined;
  }): string {
    const compactTimestamp = now().replace(/[-:.TZ]/g, "");
    const extension = extensionFromOriginalFileName(input.originalFileName) ?? extensionForMediaType(input.mediaType);
    return normalizeStorageArtifactKey(
      `uploads/${compactTimestamp}-${randomSuffix()}.${extension}`,
    );
  }

  return {
    async storeArtifact<TContent = Uint8Array>(
      request: StoreArtifactRequest<TContent>,
      context: ApplicationRequestContext = {},
    ): Promise<StoreArtifactResult> {
      const startedAt = Date.now();
      const requestContext = resolveRequestContext(request, context);
      let attemptedKey: string | undefined;
      let attemptedAbsolutePath: string | undefined;

      await logBoundaryEvent({
        level: "debug",
        name: "storage.filesystem.store.started",
        message: "Starting artifact write to local filesystem storage.",
        operation: "storage.artifact.store",
        requestId: requestContext.requestId,
        correlationId: requestContext.correlationId,
        data: {
          keyProvided: typeof request.descriptor.key === "string",
          overwrite: request.overwrite === true,
        },
      });

      try {
        const originalFileName =
          typeof (request.descriptor.metadata as { originalFileName?: unknown } | undefined)?.originalFileName === "string"
            ? (request.descriptor.metadata as { originalFileName?: string }).originalFileName
            : undefined;
        const key = request.descriptor.key
          ? normalizeStorageArtifactKey(request.descriptor.key)
          : createGeneratedKey({
            mediaType: request.descriptor.mediaType,
            originalFileName,
          });
        const extension = extensionFromOriginalFileName(originalFileName) ?? path.extname(key).replace(/^\./, "");
        attemptedKey = key;
        const bytes = toBytes(request.content);
        const checksum = createContentChecksum(bytes);
        const absolutePath = resolvePathInsideRoot(rootDirectory, key);
        attemptedAbsolutePath = absolutePath;
        const writeFlag = request.overwrite === true ? "w" : "wx";

        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, bytes, { flag: writeFlag });
        const writtenStats = await statPath(absolutePath);

        if (!writtenStats.isFile()) {
          throw new StorageAdapterVerificationError(
            "Post-write verification failed: resolved artifact path is not a file.",
          );
        }

        if (writtenStats.size !== bytes.byteLength) {
          throw new StorageAdapterVerificationError(
            `Post-write verification failed: expected ${bytes.byteLength} bytes but found ${writtenStats.size}.`,
          );
        }

        if (options.artifactCatalogAppend) {
          const appendResult = await options.artifactCatalogAppend.appendArtifactCatalogRecord({
            record: {
              storageKey: key,
              artifactFamily: resolveArtifactFamily({
                mediaType: request.descriptor.mediaType,
                extension,
                fileName: originalFileName,
              }),
              mediaType: request.descriptor.mediaType,
              sizeBytes: bytes.byteLength,
              sourceKind: "upload",
              originalName: originalFileName,
              createdAt: now(),
              checksum,
            },
          }, {
            requestId: requestContext.requestId,
            correlationId: requestContext.correlationId,
          });

          if (!appendResult.ok) {
            throw new StorageAdapterVerificationError(appendResult.error.message);
          }
        }

        await logBoundaryEvent({
          level: "info",
          name: "storage.filesystem.store.succeeded",
          message: "Stored artifact in desktop filesystem storage.",
          operation: "storage.artifact.store",
          requestId: requestContext.requestId,
          correlationId: requestContext.correlationId,
          durationMs: Date.now() - startedAt,
          outcome: "success",
          data: {
            key,
            absolutePath,
            sizeBytes: bytes.byteLength,
            mediaType: request.descriptor.mediaType,
            checksumAlgorithm: checksum.algorithm,
            checksumValue: checksum.value,
          },
        });

        return createStoreArtifactSuccessResult(
          {
            key,
            mediaType: request.descriptor.mediaType,
            sizeBytes: bytes.byteLength,
            checksum,
            metadata: request.descriptor.metadata,
          },
          requestContext,
        );
      } catch (error) {
        const code = toErrorCode(error);
        const message = code === "conflict"
          ? "Storage artifact already exists and overwrite is disabled."
          : `Failed to store artifact bytes: ${toErrorMessage(error)}`;

        await logBoundaryEvent({
          level: "error",
          name: "storage.filesystem.store.failed",
          message: "Failed to store artifact in desktop filesystem storage.",
          operation: "storage.artifact.store",
          requestId: requestContext.requestId,
          correlationId: requestContext.correlationId,
          durationMs: Date.now() - startedAt,
          outcome: "failure",
          error: {
            errorType: "storage",
            errorCode: code,
            errorMessage: message,
            details: {
              key: attemptedKey,
              absolutePath: attemptedAbsolutePath,
              filesystemCode: isFsError(error) ? (error.code ?? "unknown") : "unknown",
            },
          },
        });

        return createStoreArtifactFailureResult(
          createContractError(code, message, {
            ...requestContext,
            details: {
              operation: "storeArtifact",
              key: attemptedKey,
              absolutePath: attemptedAbsolutePath,
              filesystemCode: isFsError(error) ? error.code : undefined,
            },
          }),
          requestContext,
        );
      }
    },

    async retrieveArtifact<TContent = Uint8Array>(
      request: RetrieveArtifactRequest,
      context: ApplicationRequestContext = {},
    ): Promise<RetrieveArtifactResult<TContent>> {
      const requestContext = resolveRequestContext(request, context);
      try {
        const key = normalizeStorageArtifactKey(request.key);
        const absolutePath = resolvePathInsideRoot(rootDirectory, key);
        const [fileContent, fileStats] = await Promise.all([
          readFile(absolutePath),
          stat(absolutePath),
        ]);

        return createRetrieveArtifactSuccessResult(
          {
            key,
            sizeBytes: fileStats.size,
          },
          new Uint8Array(fileContent) as TContent,
          {
            requestId: requestContext.requestId,
            correlationId: requestContext.correlationId,
          },
        );
      } catch (error) {
        const code = toErrorCode(error, "not-found");
        return createRetrieveArtifactFailureResult<TContent>(
          createContractError(code, `Failed to retrieve artifact bytes: ${toErrorMessage(error)}`, {
            requestId: requestContext.requestId,
            correlationId: requestContext.correlationId,
            details: {
              operation: "retrieveArtifact",
              filesystemCode: isFsError(error) ? error.code : undefined,
            },
          }),
          requestContext,
        );
      }
    },

    async hasArtifact(
      request: HasArtifactRequest,
      context: ApplicationRequestContext = {},
    ): Promise<HasArtifactResult> {
      const requestContext = resolveRequestContext(request, context);
      try {
        const key = normalizeStorageArtifactKey(request.key);
        const absolutePath = resolvePathInsideRoot(rootDirectory, key);
        const fileStats = await stat(absolutePath);

        return createHasArtifactSuccessResult(true, {
          descriptor: {
            key,
            sizeBytes: fileStats.size,
          },
          requestId: requestContext.requestId,
          correlationId: requestContext.correlationId,
        });
      } catch (error) {
        if (isFsError(error) && error.code === "ENOENT") {
          return createHasArtifactSuccessResult(false, {
            requestId: requestContext.requestId,
            correlationId: requestContext.correlationId,
          });
        }

        const code = toErrorCode(error, "internal");
        return createHasArtifactFailureResult(
          createContractError(code, `Failed to check artifact existence: ${toErrorMessage(error)}`, {
            requestId: requestContext.requestId,
            correlationId: requestContext.correlationId,
            details: {
              operation: "hasArtifact",
              filesystemCode: isFsError(error) ? error.code : undefined,
            },
          }),
          requestContext,
        );
      }
    },

    async deleteArtifact(
      request: DeleteArtifactRequest,
      context: ApplicationRequestContext = {},
    ): Promise<DeleteArtifactResult> {
      const requestContext = resolveRequestContext(request, context);
      try {
        const key = normalizeStorageArtifactKey(request.key);
        const absolutePath = resolvePathInsideRoot(rootDirectory, key);
        await unlink(absolutePath);

        // Best-effort cleanup of empty parent directories under the root.
        const parentDirectory = path.dirname(absolutePath);
        if (path.relative(rootDirectory, parentDirectory) !== "") {
          await rm(parentDirectory, { recursive: false, force: false }).catch(() => {});
        }

        return createDeleteArtifactSuccessResult(true, requestContext);
      } catch (error) {
        if (isFsError(error) && error.code === "ENOENT") {
          return createDeleteArtifactSuccessResult(false, requestContext);
        }

        const code = toErrorCode(error, "internal");
        return createDeleteArtifactFailureResult(
          createContractError(code, `Failed to delete artifact: ${toErrorMessage(error)}`, {
            requestId: requestContext.requestId,
            correlationId: requestContext.correlationId,
            details: {
              operation: "deleteArtifact",
              filesystemCode: isFsError(error) ? error.code : undefined,
            },
          }),
          requestContext,
        );
      }
    },
  };
}


/**
 * Backward-compatible alias for artifact-object storage adapter naming.
 */
export function createFilesystemArtifactStorageAdapter(
  options: CreateFilesystemArtifactStorageAdapterOptions,
): ArtifactObjectStoragePort {
  return createFilesystemArtifactObjectStorageAdapter(options);
}
