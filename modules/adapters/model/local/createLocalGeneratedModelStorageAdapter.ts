import {
  cp,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import path, { join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  GeneratedModelStoragePort,
  StoreGeneratedModelRequest,
} from "../../../application/ports/model";

export interface CreateLocalGeneratedModelStorageAdapterOptions {
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  maximumSourceBytes?: number;
  maximumSourceFiles?: number;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function sanitizeModelIdSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "generated-model";
}

function toCacheRepositoryId(request: StoreGeneratedModelRequest): string {
  const repository = normalizeOptionalText(request.repository);
  if (repository) {
    if (
      repository.length > 193 ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(
        repository,
      )
    ) {
      throw new TypeError(
        "Generated model repository must use canonical owner/model syntax.",
      );
    }
    return repository;
  }

  return `generated/${sanitizeModelIdSegment(request.outputModelName)}`;
}

function toHuggingFaceCacheDirectoryName(modelId: string): string {
  return `models--${modelId.replaceAll("/", "--")}`;
}

function resolveHuggingFaceHubCacheRoot(
  env: NodeJS.ProcessEnv,
  homeDirectory: string,
): string {
  for (const variableName of [
    "HF_HUB_CACHE",
    "HUGGINGFACE_HUB_CACHE",
    "TRANSFORMERS_CACHE",
  ] as const) {
    const configured = normalizeOptionalText(env[variableName]);
    if (configured) {
      return configured;
    }
  }

  const hfHome = normalizeOptionalText(env.HF_HOME);
  if (hfHome) {
    return join(hfHome, "hub");
  }

  return join(homeDirectory, ".cache", "huggingface", "hub");
}

export function resolveLocalGeneratedModelStorageRoot(
  options: CreateLocalGeneratedModelStorageAdapterOptions = {},
): string {
  return resolveHuggingFaceHubCacheRoot(
    options.env ?? process.env,
    options.homeDirectory ?? homedir(),
  );
}

function sanitizeSnapshotSegment(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length > 80 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(normalized) ||
    normalized === "." ||
    normalized === ".."
  ) {
    throw new TypeError("Generated model run identifier is invalid.");
  }
  return normalized;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function ensureContainedDirectory(
  rootDirectory: string,
  segments: readonly string[],
): Promise<{ root: string; directory: string }> {
  await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
  const rootStats = await lstat(rootDirectory);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new TypeError("Generated model cache root must be a real directory.");
  }
  const root = await realpath(rootDirectory);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let currentStats = await lstat(current).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (!currentStats) {
      await mkdir(current, { mode: 0o700 });
      currentStats = await lstat(current);
    }
    if (currentStats.isSymbolicLink() || !currentStats.isDirectory()) {
      throw new TypeError("Generated model cache path cannot traverse a link.");
    }
    current = await realpath(current);
    if (!isInside(root, current)) {
      throw new TypeError(
        "Generated model target escaped the host-owned cache root.",
      );
    }
  }
  return { root, directory: current };
}

async function assertSafeSourceTree(
  sourceDirectory: string,
  maximumFiles: number,
  maximumBytes: number,
): Promise<void> {
  const sourceRoot = await realpath(sourceDirectory);
  const rootStats = await lstat(sourceRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new TypeError("Generated model source must be a real directory.");
  }
  let fileCount = 0;
  let totalBytes = 0;
  const pending = [sourceRoot];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absoluteEntry = path.join(directory, entry.name);
      const entryStats = await lstat(absoluteEntry);
      if (entryStats.isSymbolicLink()) {
        throw new TypeError("Generated model source cannot contain links.");
      }
      const canonicalEntry = await realpath(absoluteEntry);
      if (!isInside(sourceRoot, canonicalEntry)) {
        throw new TypeError(
          "Generated model source escapes its approved directory.",
        );
      }
      if (entryStats.isDirectory()) {
        pending.push(canonicalEntry);
      } else if (entryStats.isFile()) {
        fileCount += 1;
        totalBytes += entryStats.size;
        if (fileCount > maximumFiles || totalBytes > maximumBytes) {
          throw new TypeError("Generated model source exceeds storage limits.");
        }
      } else {
        throw new TypeError(
          "Generated model source contains an unsupported entry.",
        );
      }
    }
  }
}

export function createLocalGeneratedModelStorageAdapter(
  options: CreateLocalGeneratedModelStorageAdapterOptions = {},
): GeneratedModelStoragePort {
  const cacheRoot = path.resolve(
    resolveLocalGeneratedModelStorageRoot(options),
  );
  const maximumSourceBytes = Math.min(
    Math.max(options.maximumSourceBytes ?? 20 * 1024 * 1024 * 1024, 1),
    100 * 1024 * 1024 * 1024,
  );
  const maximumSourceFiles = Math.min(
    Math.max(options.maximumSourceFiles ?? 100_000, 1),
    1_000_000,
  );

  return {
    async storeGeneratedModel(request) {
      const modelId = toCacheRepositoryId(request);
      const repositoryDirectoryName = toHuggingFaceCacheDirectoryName(modelId);
      let targetDirectory = path.resolve(
        cacheRoot,
        repositoryDirectoryName,
        "snapshots",
        sanitizeSnapshotSegment(request.runId),
      );
      if (!isInside(cacheRoot, targetDirectory)) {
        throw new TypeError(
          "Generated model target escaped the host-owned cache root.",
        );
      }
      await assertSafeSourceTree(
        request.sourceDirectory,
        maximumSourceFiles,
        maximumSourceBytes,
      );
      const contained = await ensureContainedDirectory(cacheRoot, [
        repositoryDirectoryName,
        "snapshots",
      ]);
      const snapshotsRoot = contained.directory;
      targetDirectory = path.join(
        snapshotsRoot,
        sanitizeSnapshotSegment(request.runId),
      );
      const temporaryDirectory = path.join(
        snapshotsRoot,
        `.stage-${randomUUID()}`,
      );
      try {
        await cp(request.sourceDirectory, temporaryDirectory, {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
        const existing = await lstat(targetDirectory).catch(() => undefined);
        if (existing?.isSymbolicLink()) {
          throw new TypeError("Generated model target cannot replace a link.");
        }
        await rm(targetDirectory, { recursive: true, force: true });
        await rename(temporaryDirectory, targetDirectory);
      } catch (error) {
        await rm(temporaryDirectory, { recursive: true, force: true }).catch(
          () => undefined,
        );
        throw error;
      }

      return {
        localPath: targetDirectory,
        modelId,
      };
    },
  };
}
