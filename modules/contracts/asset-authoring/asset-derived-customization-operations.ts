import { createTransportOperation } from "../transport";

export const ASSET_DERIVED_CUSTOMIZATION_OPERATIONS = {
  listTargets: createTransportOperation("asset-authoring", "list-customization-targets"),
  readTarget: createTransportOperation("asset-authoring", "read-customization-target"),
  create: createTransportOperation("asset-authoring", "create-derived-customization"),
  update: createTransportOperation("asset-authoring", "update-derived-customization"),
  review: createTransportOperation("asset-authoring", "review-derived-customization"),
  publish: createTransportOperation("asset-authoring", "publish-derived-customization"),
  abandon: createTransportOperation("asset-authoring", "abandon-derived-customization"),
  list: createTransportOperation("asset-authoring", "list-derived-customizations"),
  read: createTransportOperation("asset-authoring", "read-derived-customization"),
} as const;

export type AssetDerivedCustomizationOperationKey = keyof typeof ASSET_DERIVED_CUSTOMIZATION_OPERATIONS;
