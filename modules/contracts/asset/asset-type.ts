export const ASSET_TYPES = [
  "ui-component",
  "page",
  "tool",
  "workflow",
  "workflow-step",
  "schema",
  "prompt-template",
  "data-source",
  "runtime-binding",
  "adapter-binding",
  "model",
  "dataset",
  "image",
  "document",
  "feature",
  "subsystem",
  "system",
  "policy",
  "test",
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export function isAssetType(value: string): value is AssetType {
  return ASSET_TYPES.includes(value as AssetType);
}

export function normalizeAssetType(value: string): AssetType {
  const normalized = value.trim().toLowerCase();

  if (!isAssetType(normalized)) {
    throw new Error(
      `Asset type must be one of ${ASSET_TYPES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
