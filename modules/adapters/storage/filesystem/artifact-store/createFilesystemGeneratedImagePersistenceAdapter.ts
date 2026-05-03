import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { LoggingPort } from "../../../../application/ports/logging";
import type { GeneratedImagePersistencePort } from "../../../../application/ports/image";
import type { ArtifactCatalogAppendPort } from "../../../../application/ports/artifact-catalog";
import { resolveArtifactFamily } from "../../../../application/shared/artifact-family-classifier";

function sanitizeSegment(value: string): string {
  const segment = value.replace(/[^a-zA-Z0-9._-]/g, "_").trim();
  if (!segment || segment === "." || segment === "..") throw new Error("Invalid ComfyUI output path segment.");
  return segment;
}

export function createFilesystemGeneratedImagePersistenceAdapter(options: {
  comfyUiOutputRoot: string;
  artifactStorageRoot: string;
  logging?: LoggingPort;
  artifactCatalogAppend?: ArtifactCatalogAppendPort;
  now?: () => string;
}): GeneratedImagePersistencePort {
  const outputRoot = path.resolve(options.comfyUiOutputRoot);
  const storageRoot = path.resolve(options.artifactStorageRoot);
  const now = options.now ?? (() => new Date().toISOString());
  return {
    async persistGeneratedImage({ output, assetId }) {
      const safeSub = output.subfolder ? sanitizeSegment(output.subfolder) : "";
      const safeFile = sanitizeSegment(output.fileName);
      const source = path.resolve(outputRoot, safeSub, safeFile);
      const rel = path.relative(outputRoot, source);
      if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("ComfyUI output path traversal rejected.");

      const targetDir = path.join(storageRoot, "generated", "images", sanitizeSegment(assetId));
      await mkdir(targetDir, { recursive: true });
      const artifactId = path.posix.join("generated", "images", sanitizeSegment(assetId), safeFile);
      const target = path.join(targetDir, safeFile);
      try {
        await rename(source, target);
      } catch (error) {
        const e = error as NodeJS.ErrnoException;
        if (e.code !== "EXDEV") throw error;
        await options.logging?.log({ timestamp: new Date().toISOString(), level: "warn", verbosity: "normal", component: "storage.filesystem", event: "generated_image_move_fallback", message: "Cross-device rename failed, using copy-delete fallback." });
        await copyFile(source, target);
        await rm(source);
      }
      if (options.artifactCatalogAppend) {
        const [targetStats, targetBytes] = await Promise.all([stat(target), readFile(target)]);
        const checksum = createHash("sha256").update(targetBytes).digest("hex");
        const appendResult = await options.artifactCatalogAppend.appendArtifactCatalogRecord({
          record: {
            storageKey: artifactId,
            artifactFamily: resolveArtifactFamily({
              mediaType: "image/png",
              extension: path.extname(safeFile).replace(/^\./, ""),
              fileName: safeFile,
            }),
            mediaType: "image/png",
            sizeBytes: targetStats.size,
            sourceKind: "generated",
            originalName: output.fileName,
            createdAt: now(),
            checksum: { algorithm: "sha256", value: checksum },
          },
        });
        if (appendResult.ok === false) {
          throw new Error(`Failed to register generated image artifact: ${appendResult.error.message}`);
        }
      }
      return { artifactId, originalFileName: output.fileName };
    },
  };
}
