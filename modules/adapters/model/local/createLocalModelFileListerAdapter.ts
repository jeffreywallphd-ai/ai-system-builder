import path from "node:path";
import { lstat, readdir, realpath, stat } from "node:fs/promises";

import { MAX_LIST_MODEL_FILES } from "../../../contracts/model";
import type { ModelFileListerPort } from "../../../application/ports/model";

const MAX_ENUMERATED_ENTRIES = 2_000;
const MAX_DIRECTORY_DEPTH = 16;

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isSafeSegment(value: string): boolean {
  return value.length > 0
    && value !== "."
    && value !== ".."
    && !/[\\/\u0000-\u001f\u007f]/.test(value);
}

export function createLocalModelFileListerAdapter(options: {
  allowedRootDirectories: readonly string[];
}): ModelFileListerPort {
  return {
    async listFiles(localPath) {
      if (!path.isAbsolute(localPath)) {
        throw new Error("Model file listing requires an absolute stored path.");
      }

      const allowedRoots = (
        await Promise.all(options.allowedRootDirectories.map(async (root) => {
          try {
            const canonical = await realpath(path.resolve(root));
            return (await stat(canonical)).isDirectory() ? canonical : undefined;
          } catch {
            return undefined;
          }
        }))
      ).filter((root): root is string => Boolean(root));
      const modelRoot = await realpath(path.resolve(localPath));
      if (!allowedRoots.some((root) => isInside(root, modelRoot))) {
        throw new Error("Stored model path is outside the configured model roots.");
      }
      if (!(await stat(modelRoot)).isDirectory()) {
        throw new Error("Stored model path is not a directory.");
      }

      const files: Array<{ relativePath: string; sizeBytes: number }> = [];
      const pending: Array<{ directory: string; relativeSegments: string[] }> = [
        { directory: modelRoot, relativeSegments: [] },
      ];
      let entriesVisited = 0;
      let truncated = false;

      while (pending.length > 0 && !truncated) {
        const current = pending.pop()!;
        const entries = await readdir(current.directory, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
          entriesVisited += 1;
          if (entriesVisited > MAX_ENUMERATED_ENTRIES || files.length >= MAX_LIST_MODEL_FILES) {
            truncated = true;
            break;
          }
          if (!isSafeSegment(entry.name)) {
            throw new Error("Model directory contains an unsafe file name.");
          }
          const relativeSegments = [...current.relativeSegments, entry.name];
          const relativePath = relativeSegments.join("/");
          if (relativeSegments.length > MAX_DIRECTORY_DEPTH || relativePath.length > 1_024) {
            truncated = true;
            continue;
          }
          const absoluteEntry = path.join(current.directory, entry.name);
          const entryStats = await lstat(absoluteEntry);
          if (entryStats.isSymbolicLink()) {
            const target = await realpath(absoluteEntry);
            if (!allowedRoots.some((root) => isInside(root, target))) {
              throw new Error("Model directory contains a link outside configured model roots.");
            }
            const targetStats = await stat(target);
            if (targetStats.isFile()) {
              files.push({ relativePath, sizeBytes: targetStats.size });
            }
            continue;
          }
          if (entryStats.isDirectory()) {
            const canonicalDirectory = await realpath(absoluteEntry);
            if (!isInside(modelRoot, canonicalDirectory)) {
              throw new Error("Model directory traversal escaped its stored root.");
            }
            pending.push({ directory: canonicalDirectory, relativeSegments });
          } else if (entryStats.isFile()) {
            const canonicalFile = await realpath(absoluteEntry);
            if (!isInside(modelRoot, canonicalFile)) {
              throw new Error("Model file escaped its stored root.");
            }
            files.push({ relativePath, sizeBytes: entryStats.size });
          }
        }
      }

      return {
        files: files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
        truncated,
      };
    },
  };
}
