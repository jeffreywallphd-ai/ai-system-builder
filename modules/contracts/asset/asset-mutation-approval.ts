export const ASSET_MUTATION_CONFIRMATION_KINDS = [
  "register-resource-backed-view",
  "finalize-generated-output",
  "import-external-object",
  "localize-external-object",
  "lifecycle-transition",
] as const;

export type AssetMutationConfirmationKind =
  (typeof ASSET_MUTATION_CONFIRMATION_KINDS)[number];

export interface AssetMutationApproval {
  readonly userConfirmed: boolean;
  readonly confirmationKind: AssetMutationConfirmationKind;
  readonly confirmationTextVersion?: string;
  readonly allowNetworkAccess?: boolean;
  readonly allowFilesystemWrite?: boolean;
  readonly allowCredentialUse?: boolean;
  readonly allowPartialCompletion?: boolean;
  readonly acknowledgedRisks?: readonly string[];
}

export function isAssetMutationConfirmationKind(
  value: string,
): value is AssetMutationConfirmationKind {
  return ASSET_MUTATION_CONFIRMATION_KINDS.includes(
    value as AssetMutationConfirmationKind,
  );
}
