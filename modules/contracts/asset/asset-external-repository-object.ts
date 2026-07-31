import type { AssetMetadata } from "./asset-metadata";

export const ASSET_EXTERNAL_REPOSITORY_PROVIDERS = [
  "huggingface",
  "local",
  "github",
  "http",
  "custom",
] as const;

export type AssetExternalRepositoryProvider =
  (typeof ASSET_EXTERNAL_REPOSITORY_PROVIDERS)[number];

export const ASSET_EXTERNAL_REPOSITORY_OBJECT_KINDS = [
  "repository",
  "file",
  "directory",
  "model",
  "dataset",
  "artifact",
  "preview",
  "custom",
] as const;

export type AssetExternalRepositoryObjectKind =
  (typeof ASSET_EXTERNAL_REPOSITORY_OBJECT_KINDS)[number];

export interface AssetExternalRepositoryObjectReference {
  readonly provider: AssetExternalRepositoryProvider;
  readonly repositoryId: string;
  readonly revision?: string;
  /** Provider object metadata only; not a canonical Asset Kernel id. */
  readonly objectPath?: string;
  readonly objectKind?: AssetExternalRepositoryObjectKind;
  readonly contentType?: string;
  readonly metadata?: AssetMetadata;
}

export function isAssetExternalRepositoryProvider(
  value: string,
): value is AssetExternalRepositoryProvider {
  return ASSET_EXTERNAL_REPOSITORY_PROVIDERS.includes(
    value as AssetExternalRepositoryProvider,
  );
}

export function normalizeAssetExternalRepositoryProvider(
  value: string,
): AssetExternalRepositoryProvider {
  const normalized = value.trim().toLowerCase();

  if (!isAssetExternalRepositoryProvider(normalized)) {
    throw new Error(
      `Asset external repository provider must be one of ${ASSET_EXTERNAL_REPOSITORY_PROVIDERS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}

export function isAssetExternalRepositoryObjectKind(
  value: string,
): value is AssetExternalRepositoryObjectKind {
  return ASSET_EXTERNAL_REPOSITORY_OBJECT_KINDS.includes(
    value as AssetExternalRepositoryObjectKind,
  );
}

export function normalizeAssetExternalRepositoryObjectKind(
  value: string,
): AssetExternalRepositoryObjectKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetExternalRepositoryObjectKind(normalized)) {
    throw new Error(
      `Asset external repository object kind must be one of ${ASSET_EXTERNAL_REPOSITORY_OBJECT_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
