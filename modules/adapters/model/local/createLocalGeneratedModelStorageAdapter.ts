import { cp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { GeneratedModelStoragePort, StoreGeneratedModelRequest } from "../../../application/ports/model";

export interface CreateLocalGeneratedModelStorageAdapterOptions {
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
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
    return repository;
  }

  return `generated/${sanitizeModelIdSegment(request.outputModelName)}`;
}

function toHuggingFaceCacheDirectoryName(modelId: string): string {
  return `models--${modelId.replaceAll("/", "--")}`;
}

function resolveHuggingFaceHubCacheRoot(env: NodeJS.ProcessEnv, homeDirectory: string): string {
  for (const variableName of ["HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE", "TRANSFORMERS_CACHE"] as const) {
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

function sanitizeSnapshotSegment(value: string): string {
  return sanitizeModelIdSegment(value).slice(0, 80) || `generated-${Date.now().toString(36)}`;
}

export function createLocalGeneratedModelStorageAdapter(
  options: CreateLocalGeneratedModelStorageAdapterOptions = {},
): GeneratedModelStoragePort {
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();

  return {
    async storeGeneratedModel(request) {
      const modelId = toCacheRepositoryId(request);
      const cacheRoot = resolveHuggingFaceHubCacheRoot(env, homeDirectory);
      const targetDirectory = join(
        cacheRoot,
        toHuggingFaceCacheDirectoryName(modelId),
        "snapshots",
        sanitizeSnapshotSegment(request.runId),
      );

      await rm(targetDirectory, { recursive: true, force: true });
      await mkdir(targetDirectory, { recursive: true });
      await cp(request.sourceDirectory, targetDirectory, { recursive: true });

      return {
        localPath: targetDirectory,
        modelId,
      };
    },
  };
}
