import { createHash } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { access, lstat, mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { LoggingPort } from "../../../../application/ports/logging";
import type { GeneratedImagePersistencePort } from "../../../../application/ports/image";
import type { ArtifactCatalogAppendPort } from "../../../../application/ports/artifact-catalog";
import type { ArtifactStorageBindingPort } from "../../../../application/ports/storage";
import { normalizeStorageArtifactKey } from "../../../../contracts/storage";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { SystemArtifactIdFactory } from "../../../../domain/artifact";
import type { OrganizationRequestContextProviderPort } from "../../../../application/ports/organization";
import { resolveOrganizationStorageKey } from "../organizationStorageScope";

class GeneratedImagePersistenceSafeError extends Error {}

function toSafeGeneratedImageError(error: unknown): Error {
  if (error instanceof GeneratedImagePersistenceSafeError) {
    return error;
  }

  if (
    error instanceof Error &&
    error.message.startsWith("Workspace id must be")
  ) {
    error.stack = undefined;
    return error;
  }

  return new Error("Failed to persist generated image.");
}

function safeFailure(message: string): GeneratedImagePersistenceSafeError {
  return new GeneratedImagePersistenceSafeError(message);
}

export function createFilesystemGeneratedImagePersistenceAdapter(options: {
  comfyUiOutputRoot: string;
  artifactStorageRoot: string;
  logging?: LoggingPort;
  artifactCatalogAppend?: ArtifactCatalogAppendPort;
  artifactStorageBinding?: Pick<
    ArtifactStorageBindingPort,
    "upsertArtifactStorageBinding"
  >;
  now?: () => string;
  organizationContextProvider?: OrganizationRequestContextProviderPort;
  maximumGeneratedImageBytes?: number;
}): GeneratedImagePersistencePort {
  const outputRoot = path.resolve(options.comfyUiOutputRoot);
  const storageRoot = path.resolve(options.artifactStorageRoot);
  const now = options.now ?? (() => new Date().toISOString());
  const artifactIdFactory = new SystemArtifactIdFactory();
  const maximumGeneratedImageBytes = Math.min(
    Math.max(options.maximumGeneratedImageBytes ?? 64 * 1024 * 1024, 1),
    512 * 1024 * 1024,
  );

  return {
    async persistGeneratedImage({ output, workspaceId }) {
      let destinationPath: string | undefined;
      try {
        const scopedWorkspaceId = createWorkspaceId(workspaceId);
        const sourcePath = resolveContainedOutputPath(
          outputRoot,
          output.subfolder,
          output.fileName,
        );
        const artifactId = artifactIdFactory.createArtifactId().toString();
        const desiredFileName =
          sanitizeFileName(output.fileName) ?? "generated-image.png";
        const storageKey = await reserveGeneratedImageStorageKey(
          storageRoot,
          scopedWorkspaceId,
          desiredFileName,
          options.organizationContextProvider,
        );
        destinationPath = path.join(
          storageRoot,
          resolveOrganizationStorageKey(
            storageKey,
            options.organizationContextProvider,
          ),
        );
        await mkdir(path.dirname(destinationPath), { recursive: true });

        let finalized: { sizeBytes: number; checksumValue: string };
        const hasInlineContent = Boolean(
          output.contentBase64 && output.contentBase64.trim(),
        );
        if (hasInlineContent) {
          await options.logging?.log({
            timestamp: new Date().toISOString(),
            level: "info",
            verbosity: "normal",
            component: "storage.filesystem",
            event: "generated_image_inline_content_persisted",
            message: "Persisting generated image from inline output content.",
          });
          finalized = await writeInlineBase64Bounded(
            destinationPath,
            output.contentBase64!,
            maximumGeneratedImageBytes,
          );
        } else {
          finalized = await copyGeneratedImageBounded(
            sourcePath,
            destinationPath,
            maximumGeneratedImageBytes,
          );
        }

        const destinationStats = await stat(destinationPath);
        if (!destinationStats.isFile())
          throw safeFailure("Generated image destination is not a file.");
        if (
          destinationStats.size !== finalized.sizeBytes ||
          destinationStats.size > maximumGeneratedImageBytes
        ) {
          throw safeFailure(
            "Generated image exceeded the configured byte limit.",
          );
        }

        const checksum = {
          algorithm: "sha256" as const,
          value: finalized.checksumValue,
        };
        const createdAt = now();
        if (options.artifactCatalogAppend) {
          const appendResult =
            await options.artifactCatalogAppend.appendArtifactCatalogRecord({
              record: {
                workspaceId: scopedWorkspaceId,
                storageKey,
                artifactFamily: "image",
                mediaType: "image/png",
                sizeBytes: destinationStats.size,
                sourceKind: "generated",
                originalName: output.fileName,
                createdAt,
                checksum,
              },
            });
          if (!appendResult.ok)
            throw safeFailure("Failed to register generated image artifact.");
        }
        if (options.artifactStorageBinding) {
          const bindingResult =
            await options.artifactStorageBinding.upsertArtifactStorageBinding({
              binding: {
                workspaceId: scopedWorkspaceId,
                artifactId,
                role: "primary",
                backing: {
                  kind: "artifact-object",
                  provider: "filesystem",
                  locator: storageKey,
                  verification: { exists: true, verifiedAt: createdAt },
                },
                createdAt,
              },
            });
          if (!bindingResult.ok)
            throw safeFailure(
              "Failed to persist generated image primary binding.",
            );
        }
        await rm(sourcePath, { force: true }).catch(() => undefined);
        if (!hasInlineContent) {
          await stat(sourcePath).then(
            () => {
              throw safeFailure(
                "Generated image source still exists after finalization.",
              );
            },
            () => undefined,
          );
          await options.logging?.log({
            timestamp: new Date().toISOString(),
            level: "info",
            verbosity: "normal",
            component: "storage.filesystem",
            event: "generated_image_output_deleted",
            message: "Deleted ComfyUI output after persistence.",
          });
        }
        await options.logging?.log({
          timestamp: new Date().toISOString(),
          level: "info",
          verbosity: "normal",
          component: "storage.filesystem",
          event: "generated_image_persist_succeeded",
          message:
            "Persisted generated image into workspace-scoped artifact storage.",
        });

        return {
          artifactId,
          storageKey,
          mediaType: "image/png",
          sizeBytes: destinationStats.size,
          checksum,
          originalFileName: output.fileName,
        };
      } catch (error) {
        if (destinationPath) {
          await rm(destinationPath, { force: true }).catch(() => undefined);
        }
        throw toSafeGeneratedImageError(error);
      }
    },
  };
}

async function copyGeneratedImageBounded(
  sourcePath: string,
  destinationPath: string,
  maximumBytes: number,
): Promise<{ sizeBytes: number; checksumValue: string }> {
  const sourceStats = await lstat(sourcePath);
  if (sourceStats.isSymbolicLink() || !sourceStats.isFile()) {
    throw safeFailure("Generated image source is not a regular file.");
  }
  if (sourceStats.size > maximumBytes) {
    throw safeFailure("Generated image exceeded the configured byte limit.");
  }
  const checksum = createHash("sha256");
  let sizeBytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length;
      if (sizeBytes > maximumBytes) {
        callback(
          safeFailure("Generated image exceeded the configured byte limit."),
        );
        return;
      }
      checksum.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      createReadStream(sourcePath),
      limiter,
      createWriteStream(destinationPath, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    await rm(destinationPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return { sizeBytes, checksumValue: checksum.digest("hex") };
}

async function writeInlineBase64Bounded(
  destinationPath: string,
  contentBase64: string,
  maximumBytes: number,
): Promise<{ sizeBytes: number; checksumValue: string }> {
  if (
    contentBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)
  ) {
    throw safeFailure("Generated image inline content is invalid.");
  }
  const padding = contentBase64.endsWith("==")
    ? 2
    : contentBase64.endsWith("=")
      ? 1
      : 0;
  const estimatedBytes = (contentBase64.length / 4) * 3 - padding;
  if (estimatedBytes > maximumBytes) {
    throw safeFailure("Generated image exceeded the configured byte limit.");
  }
  const checksum = createHash("sha256");
  let sizeBytes = 0;
  const handle = await open(destinationPath, "wx", 0o600);
  try {
    for (let offset = 0; offset < contentBase64.length; offset += 65_536) {
      const bytes = Buffer.from(
        contentBase64.slice(offset, offset + 65_536),
        "base64",
      );
      sizeBytes += bytes.length;
      if (sizeBytes > maximumBytes) {
        throw safeFailure(
          "Generated image exceeded the configured byte limit.",
        );
      }
      checksum.update(bytes);
      await handle.write(bytes);
    }
  } catch (error) {
    await handle.close();
    await rm(destinationPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return { sizeBytes, checksumValue: checksum.digest("hex") };
}

function resolveContainedOutputPath(
  outputRoot: string,
  subfolder: string | undefined,
  fileName: string,
): string {
  const sourcePath = path.resolve(outputRoot, subfolder ?? "", fileName);
  const relativeOutput = path.relative(outputRoot, sourcePath);
  if (relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput))
    throw safeFailure("Generated image output path is invalid.");
  return sourcePath;
}

function sanitizeFileName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    ?.trim();
  if (!normalized) return undefined;
  const stripped = normalized
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!stripped) return undefined;
  if (/\.[a-zA-Z0-9]+$/.test(stripped)) return stripped;
  return `${stripped}.png`;
}

async function reserveGeneratedImageStorageKey(
  storageRoot: string,
  workspaceId: string,
  desiredFileName: string,
  organizationContextProvider?: OrganizationRequestContextProviderPort,
): Promise<string> {
  const parsed = path.parse(desiredFileName);
  const ext = parsed.ext || ".png";
  const base = parsed.name || "generated-image";
  let next = 0;
  while (next < 10_000) {
    const candidate =
      next === 0 ? `${base}${ext}` : `${base}-${next + 1}${ext}`;
    const storageKey = normalizeStorageArtifactKey(
      `workspaces/${createWorkspaceId(workspaceId)}/generated/images/${candidate}`,
    );
    try {
      await access(
        path.join(
          storageRoot,
          resolveOrganizationStorageKey(
            storageKey,
            organizationContextProvider,
          ),
        ),
        constants.F_OK,
      );
      next += 1;
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code === "ENOENT") {
        return storageKey;
      }
      throw error;
    }
  }
  throw safeFailure("Unable to reserve generated image file name.");
}
