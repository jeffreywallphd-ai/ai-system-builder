const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;

export type AssetImplementationDraftId = string & {
  readonly __assetImplementationDraftIdBrand: unique symbol;
};
export type AssetSourceSnapshotId = string & {
  readonly __assetSourceSnapshotIdBrand: unique symbol;
};
export type AssetImplementationBuildId = string & {
  readonly __assetImplementationBuildIdBrand: unique symbol;
};
export type AssetImplementationReleaseId = string & {
  readonly __assetImplementationReleaseIdBrand: unique symbol;
};
export type AssetImplementationFacetId = string & {
  readonly __assetImplementationFacetIdBrand: unique symbol;
};
export type AssetImplementationBindingId = string & {
  readonly __assetImplementationBindingIdBrand: unique symbol;
};
export type AssetImplementationRevocationId = string & {
  readonly __assetImplementationRevocationIdBrand: unique symbol;
};
export type AssetImplementationArtifactId = string & {
  readonly __assetImplementationArtifactIdBrand: unique symbol;
};

function normalizeId<T extends string>(value: string, label: string): T {
  const normalized = value.trim();
  if (!SAFE_ID_PATTERN.test(normalized) || normalized.includes("..")) {
    const error = new Error(`${label} must be a safe non-path identifier.`);
    error.stack = undefined;
    throw error;
  }
  return normalized as T;
}

export const normalizeAssetImplementationDraftId = (value: string) =>
  normalizeId<AssetImplementationDraftId>(
    value,
    "Asset implementation draft id",
  );
export const normalizeAssetSourceSnapshotId = (value: string) =>
  normalizeId<AssetSourceSnapshotId>(value, "Asset source snapshot id");
export const normalizeAssetImplementationBuildId = (value: string) =>
  normalizeId<AssetImplementationBuildId>(
    value,
    "Asset implementation build id",
  );
export const normalizeAssetImplementationReleaseId = (value: string) =>
  normalizeId<AssetImplementationReleaseId>(
    value,
    "Asset implementation release id",
  );
export const normalizeAssetImplementationFacetId = (value: string) =>
  normalizeId<AssetImplementationFacetId>(
    value,
    "Asset implementation facet id",
  );
export const normalizeAssetImplementationBindingId = (value: string) =>
  normalizeId<AssetImplementationBindingId>(
    value,
    "Asset implementation binding id",
  );
export const normalizeAssetImplementationRevocationId = (value: string) =>
  normalizeId<AssetImplementationRevocationId>(
    value,
    "Asset implementation revocation id",
  );
export const normalizeAssetImplementationArtifactId = (value: string) =>
  normalizeId<AssetImplementationArtifactId>(
    value,
    "Asset implementation artifact id",
  );
