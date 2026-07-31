import type { OrganizationId } from "../organization";

export const PROVIDER_CREDENTIAL_PROVIDERS = ["huggingface"] as const;

export type ProviderCredentialProvider =
  (typeof PROVIDER_CREDENTIAL_PROVIDERS)[number];

export interface ProviderCredentialRecord {
  readonly organizationId: OrganizationId;
  readonly provider: ProviderCredentialProvider;
  readonly secret: string;
  readonly updatedAt: string;
}

export interface ProviderCredentialStatus {
  readonly configured: boolean;
  readonly maskedToken?: string;
}

