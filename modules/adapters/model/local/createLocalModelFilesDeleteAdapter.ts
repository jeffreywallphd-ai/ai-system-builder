import { lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";

import type { ModelLocalFilesDeletePort } from "../../../application/ports/model";

export interface CreateLocalModelFilesDeleteAdapterOptions {
  approvedRoots: () => Promise<readonly string[]>;
}

function isStrictlyInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0
    && !relative.startsWith("..")
    && !path.isAbsolute(relative);
}

interface CanonicalEntry {
  path: string;
  kind: "directory" | "file";
}

async function canonicalEntry(candidate: string): Promise<CanonicalEntry | undefined> {
  try {
    const stats = await lstat(candidate);
    if (stats.isSymbolicLink()) {
      throw new TypeError("Local model deletion does not follow links.");
    }
    if (!stats.isDirectory() && !stats.isFile()) {
      throw new TypeError("Local model deletion supports only files and directories.");
    }
    return {
      path: await realpath(candidate),
      kind: stats.isDirectory() ? "directory" : "file",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export function createLocalModelFilesDeleteAdapter(
  options: CreateLocalModelFilesDeleteAdapterOptions,
): ModelLocalFilesDeletePort {
  return {
    async deleteLocalModelFiles({ localPath, relativeFilePath }) {
      if (!path.isAbsolute(localPath)) {
        throw new TypeError("Local model deletion requires an absolute path.");
      }
      const localEntry = await canonicalEntry(localPath);
      if (!localEntry) {
        return { deleted: false };
      }

      let deletionEntry = localEntry;
      if (relativeFilePath !== undefined) {
        if (
          localEntry.kind !== "directory"
          || !relativeFilePath.trim()
          || path.isAbsolute(relativeFilePath)
        ) {
          throw new TypeError("Local model file selection is invalid.");
        }
        const requestedFile = path.resolve(localEntry.path, relativeFilePath);
        if (!isStrictlyInside(localEntry.path, requestedFile)) {
          throw new TypeError("Local model file selection escaped its model directory.");
        }
        const fileEntry = await canonicalEntry(requestedFile);
        if (!fileEntry) {
          return { deleted: false };
        }
        deletionEntry = fileEntry;
      }

      for (const configuredRoot of await options.approvedRoots()) {
        if (!path.isAbsolute(configuredRoot)) continue;
        const rootEntry = await canonicalEntry(configuredRoot);
        if (!rootEntry || rootEntry.kind !== "directory") continue;
        const root = rootEntry.path;
        if (!isStrictlyInside(root, deletionEntry.path)) continue;

        const relativeSegments = path.relative(root, deletionEntry.path)
          .split(path.sep)
          .filter(Boolean);
        const repositorySegmentIndex = relativeFilePath === undefined && deletionEntry.kind === "directory"
          ? relativeSegments.findIndex((segment) => segment.startsWith("models--"))
          : -1;
        const requestedTarget = repositorySegmentIndex >= 0
          ? path.join(root, ...relativeSegments.slice(0, repositorySegmentIndex + 1))
          : deletionEntry.path;
        const targetEntry = await canonicalEntry(requestedTarget);
        if (!targetEntry || !isStrictlyInside(root, targetEntry.path)) {
          throw new TypeError("Local model deletion escaped the approved cache root.");
        }

        await rm(targetEntry.path, {
          recursive: targetEntry.kind === "directory",
          force: true,
        });
        return { deleted: true };
      }

      throw new TypeError("Local model files are outside the approved cache roots.");
    },
  };
}
