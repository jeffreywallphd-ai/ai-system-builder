export const ASSET_MUTATION_INITIATORS = [
  "human",
  "ai-assisted",
  "system",
] as const;

export type AssetMutationInitiator =
  (typeof ASSET_MUTATION_INITIATORS)[number];

export interface AssetMutationActor {
  readonly initiatedBy: AssetMutationInitiator;
  readonly actorRef?: string;
  readonly actorDisplayName?: string;
  readonly automationSafe?: boolean;
  readonly thinClientSafe?: boolean;
}

export function isAssetMutationInitiator(
  value: string,
): value is AssetMutationInitiator {
  return ASSET_MUTATION_INITIATORS.includes(value as AssetMutationInitiator);
}
