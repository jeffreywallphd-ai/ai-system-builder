export const ASSET_RESOURCE_KINDS = [
  "artifact",
  "storage-object",
  "artifact-repository-object",
  "external-repository-object",
  "generated-output",
  "preview",
  "image",
  "dataset",
  "model",
  "document",
  "file",
  "url-reference",
  "custom",
] as const;

export type AssetResourceKind = (typeof ASSET_RESOURCE_KINDS)[number];

export function isAssetResourceKind(value: string): value is AssetResourceKind {
  return ASSET_RESOURCE_KINDS.includes(value as AssetResourceKind);
}

export function normalizeAssetResourceKind(value: string): AssetResourceKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetResourceKind(normalized)) {
    throw new Error(
      `Asset resource kind must be one of ${ASSET_RESOURCE_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
