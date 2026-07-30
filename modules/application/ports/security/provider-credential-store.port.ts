import type {
  ProviderCredentialProvider,
  ProviderCredentialRecord,
} from "../../../contracts/security";
import type { OrganizationId } from "../../../contracts/organization";

export interface ProviderCredentialStorePort {
  readProviderCredential(request: {
    organizationId: OrganizationId;
    provider: ProviderCredentialProvider;
  }): Promise<ProviderCredentialRecord | undefined>;

  writeProviderCredential(record: ProviderCredentialRecord): Promise<void>;

  deleteProviderCredential(request: {
    organizationId: OrganizationId;
    provider: ProviderCredentialProvider;
  }): Promise<void>;
}
