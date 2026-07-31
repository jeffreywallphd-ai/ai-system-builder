import { createTransportOperation } from "../transport";

export const API_ASSET_STUDIO_OPERATIONS = {
  start: createTransportOperation("asset-studio", "start"),
  propose: createTransportOperation("asset-studio", "propose"),
  review: createTransportOperation("asset-studio", "review"),
  read: createTransportOperation("asset-studio", "read"),
  list: createTransportOperation("asset-studio", "list"),
  createAssetDraft: createTransportOperation(
    "asset-studio",
    "create-asset-draft",
  ),
  updateAssetDraft: createTransportOperation(
    "asset-studio",
    "update-asset-draft",
  ),
  readAssetDraft: createTransportOperation("asset-studio", "read-asset-draft"),
  listAssetDrafts: createTransportOperation(
    "asset-studio",
    "list-asset-drafts",
  ),
  reviewAssetDraft: createTransportOperation(
    "asset-studio",
    "review-asset-draft",
  ),
  publishAssetDraft: createTransportOperation(
    "asset-studio",
    "publish-asset-draft",
  ),
  abandonAssetDraft: createTransportOperation(
    "asset-studio",
    "abandon-asset-draft",
  ),
} as const;
