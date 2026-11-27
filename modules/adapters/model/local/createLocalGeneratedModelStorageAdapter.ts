import {createHash} from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { homedir } from "node:os";
import path, { join } from "node:path";
import {createReviewedGeneratedModelStorageFactory, type ReviewedGeneratedModelCopyHooks,
  type ReviewedGeneratedModelStorageOptions} from "./createReviewedGeneratedModelStorageSession";

import type {
  GeneratedModelStoragePort,
  StoreGeneratedModelRequest,
} from "../../../application/ports/model";

export interface CreateLocalGeneratedModelStorageAdapterOptions {
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  maximumSourceBytes?: number;
  maximumSourceFiles?: number;
  /** Private opt-in only. Does not activate Save or register a Model. */
  reviewedStorage?: ReviewedGeneratedModelStorageOptions;
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
const COPY_BUFFER_BYTES = 256 * 1024;

function isSameFileSnapshot(expected: BigIntStats, actual: BigIntStats): boolean {
  return actual.isFile() && expected.ino !== 0n
    && actual.dev === expected.dev && actual.ino === expected.ino
    && actual.size === expected.size && actual.nlink === expected.nlink
    && actual.mtimeNs === expected.mtimeNs && actual.ctimeNs === expected.ctimeNs;
}

async function stageGeneratedModelFile(
  source: string,
  canonicalSource: string,
  inspected: BigIntStats,
  target: string,
  hooks?: ReviewedGeneratedModelCopyHooks,
): Promise<void> {
  const changedSource = "Generated model source changed while being staged.";
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const effect = <T>(action: () => Promise<T>): Promise<T> => hooks ? hooks.effect(action) : action();
  if (hooks) await hooks.beforeEffect();
  hooks?.check();
  const input = await effect(() => open(source, constants.O_RDONLY | noFollow | (constants.O_NONBLOCK ?? 0)));
  hooks?.opened(input);
  try {
    hooks?.check();
    if (!isSameFileSnapshot(inspected, await effect(() => input.stat({ bigint: true })))) {
      throw new TypeError(changedSource);
    }
    if (hooks) await hooks.beforeEffect();
    hooks?.check();
    const output = await effect(() => open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow, 0o600));
    hooks?.opened(output);
    try {
      hooks?.check();
      // The walk already checked the size against the total byte limit.
      let remaining = Number(inspected.size);
      const buffer = Buffer.allocUnsafe(Math.min(remaining, hooks ? 1024 ** 2 : COPY_BUFFER_BYTES));
      const hash = hooks ? createHash("sha256") : undefined;
      while (remaining > 0) {
        if (hooks) await hooks.beforeEffect();
        hooks?.check();
        const requested = Math.min(remaining, buffer.length);
        const { bytesRead } = await effect(() => input.read(buffer, 0, requested, null));
        hooks?.check();
        if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > requested) throw new TypeError(changedSource);
        hash?.update(buffer.subarray(0, bytesRead));
        let offset = 0;
        while (offset < bytesRead) {
          if (hooks) await hooks.beforeEffect();
          hooks?.check();
          const { bytesWritten } = await effect(() => output.write(buffer, offset, bytesRead - offset, null));
          hooks?.check();
          if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > bytesRead - offset)
            throw new Error("Generated model staging write made no progress.");
          offset += bytesWritten;
        }
        remaining -= bytesRead;
      }
      if (hooks) {
        if ("sha256:" + hash!.digest("hex") !== hooks.expectedSha256) throw new TypeError(changedSource);
        await hooks.beforeEffect(); hooks.check(); await effect(() => output.sync()); hooks.check();
      }
    } finally {
      // Remember even a partial fresh file, but never let a failed observation
      // suppress the original close. Closing does not need renewed write consent.
      try {if (hooks) hooks.remember(target, await effect(() => output.stat({bigint: true})));}
      finally {await effect(() => output.close()); hooks?.closed(output);}
    }
    if (hooks) await hooks.beforeEffect();
    hooks?.check();
    if (path.relative(await effect(() => realpath(source)), canonicalSource) !== ""
      || !isSameFileSnapshot(inspected, await effect(() => lstat(source, { bigint: true })))
      || !isSameFileSnapshot(inspected, await effect(() => input.stat({ bigint: true })))) {
      throw new TypeError(changedSource);
    }
    hooks?.check();
  } finally {
    await effect(() => input.close()); hooks?.closed(input);
  }
}

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
  let totalBytes = 0n;
  const byteLimit = BigInt(Math.floor(maximumBytes));
  async function visit(directory: string, depth: number, destinationDirectory?: string): Promise<void> {
    for await (const entry of await opendir(directory)) {
      const absoluteEntry = path.join(directory, entry.name);
      const entryStats = await lstat(absoluteEntry, { bigint: true });
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
        if (fileCount > maximumFiles || totalBytes > byteLimit) {
          throw new TypeError("Generated model source exceeds storage limits.");
        }
        if (target !== undefined) {
          await stageGeneratedModelFile(absoluteEntry, canonicalEntry, entryStats, target);
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
  const createReviewedSession = options.reviewedStorage === undefined ? undefined
    : createReviewedGeneratedModelStorageFactory(options.reviewedStorage, stageGeneratedModelFile);

  return {
    ...(createReviewedSession ? {createReviewedSession} : {}),
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
