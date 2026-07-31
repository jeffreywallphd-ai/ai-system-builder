import type { AssetMetadata } from "./asset-metadata";
import type { AssetReference } from "./asset-reference";

export const ASSET_RESOURCE_PREVIEW_KINDS = [
  "thumbnail",
  "text-summary",
  "metadata-summary",
  "table-sample",
  "image-preview",
  "document-preview",
  "model-card",
  "dataset-sample",
  "custom",
] as const;

export type AssetResourcePreviewKind =
  (typeof ASSET_RESOURCE_PREVIEW_KINDS)[number];

export interface AssetResourcePreviewReference {
  readonly previewId: string;
  readonly previewKind: AssetResourcePreviewKind;
  readonly assetRef?: AssetReference;
  readonly resourceBackingRef?: AssetReference;
  readonly contentType?: string;
  readonly summary?: string;
  readonly metadata?: AssetMetadata;
}

export function isAssetResourcePreviewKind(
  value: string,
): value is AssetResourcePreviewKind {
  return ASSET_RESOURCE_PREVIEW_KINDS.includes(value as AssetResourcePreviewKind);
}

export function normalizeAssetResourcePreviewKind(
  value: string,
): AssetResourcePreviewKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetResourcePreviewKind(normalized)) {
    throw new Error(
      `Asset resource preview kind must be one of ${ASSET_RESOURCE_PREVIEW_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
