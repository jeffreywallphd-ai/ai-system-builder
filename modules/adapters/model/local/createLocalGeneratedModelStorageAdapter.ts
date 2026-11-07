import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import path, { join } from "node:path";

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

const MAXIMUM_SOURCE_DEPTH = 64;

async function walkGeneratedModelTree(
  sourceDirectory: string,
  maximumFiles: number,
  maximumBytes: number,
  destination?: string,
): Promise<void> {
  const requestedRootStats = await lstat(sourceDirectory);
  if (requestedRootStats.isSymbolicLink() || !requestedRootStats.isDirectory()) {
    throw new TypeError("Generated model source must be a real directory.");
  }
  const sourceRoot = await realpath(sourceDirectory);
  const rootStats = await lstat(sourceRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new TypeError("Generated model source must be a real directory.");
  }
  let fileCount = 0;
  let directoryCount = 0;
  let totalBytes = 0;
  async function visit(directory: string, depth: number, destinationDirectory?: string): Promise<void> {
    for await (const entry of await opendir(directory)) {
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
      const target = destinationDirectory === undefined ? undefined : path.join(destinationDirectory, entry.name);
      if (entryStats.isDirectory()) {
        directoryCount += 1;
        if (directoryCount > maximumFiles || depth === MAXIMUM_SOURCE_DEPTH) {
          throw new TypeError("Generated model source exceeds storage limits.");
        }
        if (target !== undefined) await mkdir(target, { mode: 0o700 });
        await visit(canonicalEntry, depth + 1, target);
      } else if (entryStats.isFile()) {
        fileCount += 1;
        totalBytes += entryStats.size;
        if (fileCount > maximumFiles || totalBytes > maximumBytes) {
          throw new TypeError("Generated model source exceeds storage limits.");
        }
        if (target !== undefined) {
          await cp(absoluteEntry, target, { errorOnExist: true, force: false });
        }
      } else {
        throw new TypeError(
          "Generated model source contains an unsupported entry.",
        );
      }
    }
  }
  await visit(sourceRoot, 0, destination);
}

async function assertTargetAbsent(targetDirectory: string): Promise<void> {
  try {
    await lstat(targetDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new TypeError("Generated model target already exists; retained content cannot be replaced.");
}

export function createLocalGeneratedModelStorageAdapter(
  options: CreateLocalGeneratedModelStorageAdapterOptions = {},
): GeneratedModelStoragePort {
  const cacheRoot = path.resolve(
    resolveLocalGeneratedModelStorageRoot(options),
  );
  if ((options.maximumSourceBytes !== undefined && !Number.isFinite(options.maximumSourceBytes))
    || (options.maximumSourceFiles !== undefined && !Number.isFinite(options.maximumSourceFiles))) {
    throw new TypeError("Generated model storage limits must be finite.");
  }
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
      await walkGeneratedModelTree(
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
      await assertTargetAbsent(targetDirectory);
      // Exclusive creation owns this staging leaf, not an existing cache entry.
      const temporaryDirectory = await mkdtemp(path.join(snapshotsRoot, ".stage-"));
      const stagedIdentity = await lstat(temporaryDirectory, { bigint: true });
      try {
        await walkGeneratedModelTree(request.sourceDirectory, maximumSourceFiles, maximumSourceBytes, temporaryDirectory);
        const beforePublish = await lstat(temporaryDirectory, { bigint: true });
        if (!beforePublish.isDirectory() || beforePublish.isSymbolicLink()
          || stagedIdentity.ino === 0n || beforePublish.dev !== stagedIdentity.dev || beforePublish.ino !== stagedIdentity.ino
          || await realpath(temporaryDirectory) !== temporaryDirectory) {
          throw new TypeError("Generated model staging identity is unavailable.");
        }
        await walkGeneratedModelTree(temporaryDirectory, maximumSourceFiles, maximumSourceBytes);
        await assertTargetAbsent(targetDirectory);
        await rename(temporaryDirectory, targetDirectory);
      } catch (error) {
        // Cooperative identity check only; native parent/race protection is a
        // separate capability. Unknown/substituted staging must be retained.
        const current = await lstat(temporaryDirectory, { bigint: true }).catch(() => undefined);
        const canonicalStage = await realpath(temporaryDirectory).catch(() => undefined);
        if (current?.isDirectory() && !current.isSymbolicLink()
          && canonicalStage === temporaryDirectory && isInside(snapshotsRoot, canonicalStage)
          && stagedIdentity.ino !== 0n && current.dev === stagedIdentity.dev && current.ino === stagedIdentity.ino) {
          await rm(temporaryDirectory, { recursive: true, force: false }).catch(() => undefined);
        }
        throw error;
      }

      return {
        localPath: targetDirectory,
        modelId,
      };
    },
  };
}
