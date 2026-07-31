export const ASSET_MUTATION_OPERATIONS = [
  "asset.register-resource-backed-view",
  "asset.finalize-generated-output",
  "asset.import-external-repository-object",
  "asset.localize-external-repository-object",
] as const;

export type AssetMutationOperation =
  (typeof ASSET_MUTATION_OPERATIONS)[number];

export function isAssetMutationOperation(
  value: string,
): value is AssetMutationOperation {
  return ASSET_MUTATION_OPERATIONS.includes(value as AssetMutationOperation);
}

export function assertAssetMutationOperation(
  value: string,
): asserts value is AssetMutationOperation {
  if (!isAssetMutationOperation(value)) {
    throw new Error(
      `Asset mutation operation must be one of ${ASSET_MUTATION_OPERATIONS.join(", ")}. Received "${value}".`,
    );
  }
}
